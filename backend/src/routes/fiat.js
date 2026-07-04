import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { optionalAuth } from "../middleware/auth.js";
import { buyAndDeliver, deliveryConfigured } from "../chain.js";
import { usdPerEth } from "./rate.js";

// Stripe card checkout for primary purchases (US customers pay USD; the
// platform delivery wallet buys the editions on-chain and forwards them).
// Enabled only when STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set AND the
// delivery wallet is configured — otherwise /status reports disabled and the
// frontend hides the card button.
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const SITE = (process.env.PUBLIC_SITE_URL || "http://localhost:31337").replace(/\/$/, "");
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

export const fiatEnabled = () => !!(stripe && WEBHOOK_SECRET && deliveryConfigured);

const r = Router();

r.get("/status", (_req, res) => res.json({ enabled: fiatEnabled() }));

// POST /api/fiat/checkout { trackId, qty, deliveryAddress? } -> { url }
// Card buyers don't need a connected wallet or SIWE session — they only need
// a delivery address. Signed-in users default to their own wallet.
r.post("/checkout", optionalAuth, async (req, res) => {
  if (!fiatEnabled()) return res.status(503).json({ error: "card payments not configured" });
  const { trackId, qty, deliveryAddress } = req.body || {};
  const q = Number(qty) || 1;
  if (typeof trackId !== "string" || !trackId) return res.status(400).json({ error: "trackId required" });
  if (!Number.isInteger(q) || q < 1 || q > 100) return res.status(400).json({ error: "qty must be 1..100" });
  const to = String(deliveryAddress || req.user?.address || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return res.status(400).json({ error: "valid delivery wallet address required" });

  const track = await prisma.track.findUnique({ where: { id: trackId }, include: { artist: true } });
  if (!track) return res.status(404).json({ error: "track not found" });
  if (track.chainTokenId == null) return res.status(400).json({ error: "track is not on-chain" });
  if (track.maxSupply - track.minted < q) return res.status(400).json({ error: "not enough editions left" });

  const rate = await usdPerEth();
  if (!rate) return res.status(503).json({ error: "USD rate unavailable, try again shortly" });
  const ethEach = Number(BigInt(track.priceWei)) / 1e18;
  // Stripe minimum charge is $0.50; round up to the cent
  const centsEach = Math.max(50, Math.ceil(ethEach * rate * 100));

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        quantity: q,
        price_data: {
          currency: "usd",
          unit_amount: centsEach,
          product_data: {
            name: `${track.title} — limited edition`,
            description: `Music NFT by ${track.artist.handle || track.artist.address.slice(0, 8)} · delivered on-chain to ${to}`,
          },
        },
      }],
      metadata: {
        trackId: track.id,
        chainTokenId: String(track.chainTokenId),
        buyer: to,
        qty: String(q),
        unitPriceWei: track.priceWei,
      },
      success_url: `${SITE}/track/${track.id}?fiat=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/track/${track.id}?fiat=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(502).json({ error: "could not create checkout session", detail: String(e.message || e) });
  }
});

// Webhook (mounted with express.raw BEFORE the global JSON parser — Stripe
// signature verification needs the untouched body).
export async function fiatWebhook(req, res) {
  if (!fiatEnabled()) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ error: `webhook signature verification failed: ${e.message}` });
  }
  if (event.type !== "checkout.session.completed") return res.json({ received: true });

  const s = event.data.object;
  const { trackId, chainTokenId, buyer, qty, unitPriceWei } = s.metadata || {};
  if (!trackId || !buyer || !qty) return res.status(400).json({ error: "missing metadata" });

  // idempotency: each Stripe session fulfils exactly once
  const existing = await prisma.sale.findFirst({ where: { stripeSessionId: s.id } });
  if (existing) return res.json({ received: true, already: true });

  const delivery = await buyAndDeliver({
    tokenId: Number(chainTokenId),
    qty: Number(qty),
    unitPriceWei,
    to: buyer,
  });
  if (!delivery.ok) {
    // Respond 500 so Stripe retries the webhook (transient RPC issues heal on retry)
    console.error("fiat delivery failed:", s.id, delivery.reason);
    return res.status(500).json({ error: "delivery failed", reason: delivery.reason });
  }

  try {
    const user = await prisma.user.upsert({ where: { address: buyer }, update: {}, create: { address: buyer } });
    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: {
          trackId,
          buyerId: user.id,
          kind: "fiat_primary",
          qty: Number(qty),
          priceWei: delivery.paidWei,
          txHash: delivery.transferTx,
          stripeSessionId: s.id,
        },
      });
      await tx.track.update({ where: { id: trackId }, data: { minted: { increment: Number(qty) } } });
    });
  } catch (e) {
    // Delivery succeeded on-chain; a record hiccup must not make Stripe retry
    // (that would double-deliver). Log and accept.
    console.error("fiat sale record failed after delivery:", s.id, e.message);
  }
  res.json({ received: true });
}

export default r;
