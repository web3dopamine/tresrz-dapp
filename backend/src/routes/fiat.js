import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { optionalAuth } from "../middleware/auth.js";
import {
  submitBuy, waitReceipt, transferEditions, editionsLeft, deliveryBalanceOf, deliveryConfigured,
} from "../chain.js";
import { usdPerEth } from "./rate.js";
import { creditEarningsTx, artistShareWei } from "./creator.js";

// Stripe card checkout for primary NFT purchases (US customers pay USD).
//
// Correctness model (hardened after adversarial review):
//   - The webhook's FIRST action is to CREATE a FiatOrder(status=processing).
//     Its unique stripeSessionId is the atomic idempotency lock: a concurrent
//     Stripe retry that loses the create returns 200 without touching funds.
//   - The on-chain buy is submit-then-persist-hash-then-wait, so a retry
//     re-checks the SAME tx instead of double-buying.
//   - Track.minted is incremented exactly once, guarded by mintedCounted.
//   - A reverted buy (oversell/sold-out) refunds the card and marks refunded.
//   - `delivering` carries a timestamp and is self-healing: the reconciler
//     (startFiatReconciler) retries stale transfers after re-checking on-chain
//     state, so no paid order is ever permanently trapped.
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const SITE = (process.env.PUBLIC_SITE_URL || "http://localhost:31337").replace(/\/$/, "");
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;
const STALE_DELIVERING_MS = 3 * 60 * 1000; // a delivering order older than this is retryable

export const fiatEnabled = () => !!(stripe && WEBHOOK_SECRET && deliveryConfigured);

const r = Router();
const isRevert = (reason) => /revert|sold out|exceeds|inactive|insufficient|not active|supply/i.test(String(reason || ""));

r.get("/status", (_req, res) => res.json({ enabled: fiatEnabled() }));

// POST /api/fiat/checkout { trackId, qty, deliveryAddress? } -> { url }
// deliveryAddress OPTIONAL: signed-in users default to their wallet; guests
// without one pay and claim afterwards.
r.post("/checkout", optionalAuth, async (req, res) => {
  if (!fiatEnabled()) return res.status(503).json({ error: "card payments not configured" });
  const { trackId, qty, deliveryAddress } = req.body || {};
  const q = Number(qty) || 1;
  if (typeof trackId !== "string" || !trackId) return res.status(400).json({ error: "trackId required" });
  if (!Number.isInteger(q) || q < 1 || q > 100) return res.status(400).json({ error: "qty must be 1..100" });
  const to = String(deliveryAddress || req.user?.address || "").trim();
  if (to && !/^0x[0-9a-fA-F]{40}$/.test(to)) return res.status(400).json({ error: "delivery address must be a 0x wallet address" });

  const track = await prisma.track.findUnique({ where: { id: trackId }, include: { artist: true } });
  if (!track) return res.status(404).json({ error: "track not found" });
  if (track.chainTokenId == null) return res.status(400).json({ error: "track is not on-chain" });
  // supply check uses on-chain truth when available (DB minted can lag)
  const left = await editionsLeft(track.chainTokenId);
  const remaining = left != null ? Number(left) : track.maxSupply - track.minted;
  if (remaining < q) return res.status(400).json({ error: "not enough editions left" });

  const rate = await usdPerEth();
  if (!rate) return res.status(503).json({ error: "USD rate unavailable, try again shortly" });
  const ethEach = Number(BigInt(track.priceWei)) / 1e18;
  const centsEach = Math.max(50, Math.ceil(ethEach * rate * 100)); // Stripe min $0.50

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
            description: to
              ? `Music NFT by ${track.artist.handle || track.artist.address.slice(0, 8)} · delivered on-chain to ${to}`
              : `Music NFT by ${track.artist.handle || track.artist.address.slice(0, 8)} · claim to your wallet after payment`,
          },
        },
      }],
      metadata: {
        trackId: track.id,
        chainTokenId: String(track.chainTokenId),
        buyer: to, // "" = guest -> hold & claim
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

// ---- fulfilment state machine (webhook + reconciler both call these) ----

// Move a processing order forward: ensure the on-chain buy is submitted &
// confirmed, count minted once, then (direct) auto-deliver. Idempotent.
async function advanceBuy(order) {
  // 1) ensure a buy tx exists (submit once, persist hash before awaiting)
  if (!order.buyTx) {
    const sub = await submitBuy({ tokenId: order.chainTokenId, qty: order.qty, unitPriceWei: order.unitPriceWei });
    if (!sub.ok) {
      // couldn't even submit. If on-chain supply is exhausted -> permanent -> refund.
      const left = await editionsLeft(order.chainTokenId);
      if (left != null && Number(left) < order.qty) return refundOrder(order, "sold out before fulfilment");
      await prisma.fiatOrder.update({ where: { id: order.id }, data: { attempts: { increment: 1 }, lastError: sub.reason?.slice(0, 300) } });
      return { done: false }; // transient — reconciler retries
    }
    order = await prisma.fiatOrder.update({ where: { id: order.id }, data: { buyTx: sub.hash, paidWei: sub.paidWei } });
  }
  // 2) await the buy receipt (re-checks the same tx on every retry)
  const rc = await waitReceipt(order.buyTx);
  if (rc.status === "reverted") return refundOrder(order, "on-chain buy reverted (likely sold out)");
  if (!rc.ok) { // pending — try again later
    await prisma.fiatOrder.update({ where: { id: order.id }, data: { attempts: { increment: 1 }, lastError: "buy tx pending" } });
    return { done: false };
  }
  // 3) buy confirmed — count minted exactly once, move to held
  if (!order.mintedCounted) {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.fiatOrder.updateMany({ where: { id: order.id, mintedCounted: false }, data: { mintedCounted: true, status: "held" } });
      if (locked.count === 1) await tx.track.update({ where: { id: order.trackId }, data: { minted: { increment: order.qty } } });
    });
    order = await prisma.fiatOrder.findUnique({ where: { id: order.id } });
  } else if (order.status === "processing") {
    order = await prisma.fiatOrder.update({ where: { id: order.id }, data: { status: "held" } });
  }
  // 4) direct delivery (buyer known) — auto-send now
  if (order.buyer) await deliverOrder(order, order.buyer);
  return { done: true };
}

// Transfer held editions to `to`, self-healing across crashes. Guards against
// double-delivery by checking the delivery wallet still holds them.
async function deliverOrder(order, to) {
  // acquire the delivering lock: held, or a STALE delivering we can retry
  const staleBefore = new Date(Date.now() - STALE_DELIVERING_MS);
  const locked = await prisma.fiatOrder.updateMany({
    where: { id: order.id, OR: [{ status: "held" }, { status: "delivering", deliveringAt: { lt: staleBefore } }] },
    data: { status: "delivering", deliveringAt: new Date() },
  });
  if (locked.count !== 1) return { done: false, reason: "not lockable (in progress or done)" };

  // if a prior attempt already moved the editions out, don't send again
  const held = await deliveryBalanceOf(order.chainTokenId);
  if (held < BigInt(order.qty) && order.deliverTx) {
    await finalizeDelivered(order, to, order.deliverTx);
    return { done: true };
  }

  const moved = await transferEditions({ tokenId: order.chainTokenId, qty: order.qty, to });
  if (!moved.ok) {
    await prisma.fiatOrder.update({ where: { id: order.id }, data: { status: "held", attempts: { increment: 1 }, lastError: moved.reason?.slice(0, 300) } });
    return { done: false, reason: moved.reason };
  }
  await finalizeDelivered(order, to, moved.transferTx);
  return { done: true, deliverTx: moved.transferTx };
}

async function finalizeDelivered(order, to, deliverTx) {
  const user = await prisma.user.upsert({ where: { address: to }, update: {}, create: { address: to } });
  await prisma.fiatOrder.update({
    where: { id: order.id },
    data: { status: "delivered", deliveredTo: to, deliverTx, deliveredAt: new Date() },
  });
  // record the sale + credit a custodial creator atomically (idempotent on the
  // unique txHash; a P2002 retry rolls back and won't double-credit). paidWei is
  // the on-chain ETH the delivery wallet spent — trustworthy for accounting.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sale.create({
        data: { trackId: order.trackId, buyerId: user.id, kind: "fiat_primary", qty: order.qty, priceWei: order.paidWei, txHash: deliverTx, stripeSessionId: order.stripeSessionId },
      });
      await creditEarningsTx(tx, order.trackId, artistShareWei(order.paidWei));
    });
  } catch (e) {
    if (e?.code !== "P2002") console.error("fiat sale record/credit failed:", order.stripeSessionId, e.message);
  }
}

async function refundOrder(order, reason) {
  try {
    if (stripe && order.paymentIntent) await stripe.refunds.create({ payment_intent: order.paymentIntent });
  } catch (e) { console.error("refund failed:", order.stripeSessionId, e.message); }
  await prisma.fiatOrder.update({ where: { id: order.id }, data: { status: "refunded", lastError: reason?.slice(0, 300) } });
  return { done: true, refunded: true };
}

// GET /api/fiat/order?session_id=cs_... -> claim/delivery status for the buyer.
r.get("/order", async (req, res) => {
  const sid = String(req.query.session_id || "");
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sid)) return res.status(400).json({ error: "session_id required" });
  const order = await prisma.fiatOrder.findUnique({
    where: { stripeSessionId: sid },
    include: { track: { select: { id: true, title: true, coverSeed: true } } },
  });
  if (!order) return res.json({ status: "processing" }); // webhook may not have run yet
  // collapse internal states for the client
  const clientStatus =
    order.status === "held" ? "held"
    : order.status === "delivered" ? "delivered"
    : order.status === "refunded" ? "refunded"
    : "processing"; // processing | delivering both read as "processing" to the UI
  res.json({ status: clientStatus, qty: order.qty, track: order.track, deliveredTo: order.deliveredTo, deliverTx: order.deliverTx });
});

// POST /api/fiat/claim { sessionId, address } -> deliver held editions
r.post("/claim", async (req, res) => {
  const { sessionId, address } = req.body || {};
  const sid = String(sessionId || "");
  const to = String(address || "").trim();
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sid)) return res.status(400).json({ error: "sessionId required" });
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return res.status(400).json({ error: "valid 0x wallet address required" });

  const order = await prisma.fiatOrder.findUnique({ where: { stripeSessionId: sid } });
  if (!order) return res.status(404).json({ error: "order not found (payment may still be processing — retry in a minute)" });
  if (order.status === "delivered") return res.status(409).json({ error: "already claimed", deliveredTo: order.deliveredTo, deliverTx: order.deliverTx });
  if (order.status === "refunded") return res.status(409).json({ error: "order was refunded" });
  if (order.status === "processing") return res.status(425).json({ error: "still finalizing your purchase — retry in a moment" });

  const result = await deliverOrder(order, to);
  if (!result.done) return res.status(502).json({ error: "delivery in progress or failed, retry shortly", reason: result.reason });
  const fresh = await prisma.fiatOrder.findUnique({ where: { id: order.id } });
  res.json({ ok: true, deliverTx: fresh.deliverTx, deliveredTo: fresh.deliveredTo });
});

// Webhook (raw body, signature-verified; mounted before the JSON parser).
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
  if (!trackId || !qty || chainTokenId == null) return res.status(400).json({ error: "missing metadata" });

  // ATOMIC LOCK: create-or-detect. The unique stripeSessionId makes a
  // concurrent retry lose the create and return without touching funds.
  let order;
  try {
    order = await prisma.fiatOrder.create({
      data: {
        stripeSessionId: s.id,
        paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : null,
        trackId, chainTokenId: Number(chainTokenId), qty: Number(qty),
        unitPriceWei: String(unitPriceWei), buyer: buyer || null, status: "processing",
      },
    });
  } catch (e) {
    if (e?.code === "P2002") return res.json({ received: true, already: true });
    console.error("fiat order create failed:", s.id, e.message);
    return res.status(500).json({ error: "could not record order" }); // Stripe retries
  }

  const result = await advanceBuy(order).catch((e) => { console.error("advanceBuy threw:", s.id, e.message); return { done: false }; });
  // Not done (transient buy pending / submit failure) -> the reconciler will
  // finish it; we still 200 so Stripe stops retrying (the lock row owns it).
  res.json({ received: true, fulfilled: !!result.done });
}

// Background reconciler: heals orders stuck by crashes/timeouts. Every 30s it
// re-drives processing orders and retries stale `delivering` transfers.
let reconcilerTimer = null;
export function startFiatReconciler() {
  if (reconcilerTimer || !fiatEnabled()) return;
  const tick = async () => {
    try {
      const stale = new Date(Date.now() - STALE_DELIVERING_MS);
      const stuck = await prisma.fiatOrder.findMany({
        where: { OR: [{ status: "processing" }, { status: "delivering", deliveringAt: { lt: stale } }] },
        take: 20, orderBy: { createdAt: "asc" },
      });
      for (const o of stuck) {
        if (o.status === "processing") await advanceBuy(o).catch((e) => console.error("reconcile advanceBuy:", o.stripeSessionId, e.message));
        else if (o.buyer || o.deliveredTo) await deliverOrder(o, o.buyer || o.deliveredTo).catch((e) => console.error("reconcile deliver:", o.stripeSessionId, e.message));
        // a guest `delivering` with no target (crash after lock, before transfer) resets to held on next lock-expiry via deliverOrder's own where-clause when claimed again
      }
    } catch (e) {
      console.error("fiat reconciler tick failed:", e.message);
    }
  };
  reconcilerTimer = setInterval(tick, 30_000);
  reconcilerTimer.unref?.();
}

export default r;
