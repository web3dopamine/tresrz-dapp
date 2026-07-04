import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPurchase, verifySecondarySale, chainConfigured } from "../chain.js";
import { creditEarningsTx, artistShareWei } from "./creator.js";
const r = Router();

// GET /api/sales/history/:trackId  -> price history (primary + secondary) for a
// track, oldest first. Used by the track detail page's price chart.
r.get("/history/:trackId", async (req, res) => {
  const track = await prisma.track.findUnique({ where: { id: req.params.trackId }, select: { id: true } });
  if (!track) return res.status(404).json({ error: "track not found" });
  const sales = await prisma.sale.findMany({
    where: { trackId: track.id },
    orderBy: { createdAt: "asc" },
    include: { buyer: { select: { address: true } }, seller: { select: { address: true } } },
  });
  res.json(
    sales.map((s) => ({
      kind: s.kind,
      qty: s.qty,
      priceWei: s.priceWei,
      unitWei: s.qty > 0 ? (BigInt(s.priceWei) / BigInt(s.qty)).toString() : s.priceWei,
      txHash: s.txHash,
      buyer: s.buyer?.address || null,
      seller: s.seller?.address || null,
      at: s.createdAt,
    }))
  );
});

// POST /api/sales  -> record a confirmed primary purchase (verified on-chain)
r.post("/", requireAuth, async (req, res) => {
  const { trackId, qty, priceWei, txHash } = req.body || {};

  // --- input validation ---
  if (typeof trackId !== "string" || !trackId) return res.status(400).json({ error: "trackId required" });
  const q = Number(qty);
  if (!Number.isInteger(q) || q < 1 || q > 10000) return res.status(400).json({ error: "qty must be 1..10000" });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return res.status(400).json({ error: "valid txHash required" });
  if (priceWei !== undefined && !/^\d+$/.test(String(priceWei))) return res.status(400).json({ error: "priceWei must be a wei string" });

  // can't trust the client — we must verify on-chain
  if (!chainConfigured) return res.status(503).json({ error: "sale verification unavailable (chain not configured)" });

  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true, chainTokenId: true } });
  if (!track) return res.status(404).json({ error: "track not found" });
  if (track.chainTokenId == null) return res.status(400).json({ error: "track is not on-chain" });

  // --- on-chain verification: the receipt for txHash must contain a TrackPurchased
  //     event for this tokenId, with buyer == the authenticated wallet and matching qty ---
  const v = await verifyPurchase({
    txHash,
    expectedTokenId: track.chainTokenId,
    expectedBuyer: req.user.address,
    expectedQty: q,
  });
  if (!v.ok) return res.status(400).json({ error: "purchase not verified on-chain", reason: v.reason });

  // Accounting uses ONLY the on-chain-verified paid amount, never client input,
  // so a custodial creator can't inflate their balance via a forged priceWei.
  const verifiedPaid = String(v.paid ?? "0");
  try {
    const sale = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.create({
        data: { trackId, buyerId: req.user.id, qty: q, priceWei: verifiedPaid, txHash },
      });
      await tx.track.update({ where: { id: trackId }, data: { minted: { increment: q } } });
      // credit a custodial creator their verified share — atomic with the sale
      await creditEarningsTx(tx, trackId, artistShareWei(verifiedPaid));
      return s;
    });
    res.status(201).json(sale);
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "sale already recorded for this txHash" });
    res.status(500).json({ error: "could not record sale", detail: String(e.message || e) });
  }
});

// POST /api/sales/secondary  -> record a confirmed secondary-market sale
// (fixed-price listing buy or accepted offer), verified on-chain against the
// TresrzMarketplace Sale / OfferAccepted events. The authenticated wallet must
// be the buyer OR the seller of the event (a listing buy is recorded by the
// buyer; an accepted offer by the seller — the offer maker isn't online then).
// Does NOT touch `minted` (no new editions are created on resale).
r.post("/secondary", requireAuth, async (req, res) => {
  const { trackId, qty, txHash } = req.body || {};
  if (typeof trackId !== "string" || !trackId) return res.status(400).json({ error: "trackId required" });
  const q = Number(qty);
  if (!Number.isInteger(q) || q < 1 || q > 10000) return res.status(400).json({ error: "qty must be 1..10000" });
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return res.status(400).json({ error: "valid txHash required" });
  if (!chainConfigured) return res.status(503).json({ error: "sale verification unavailable (chain not configured)" });

  const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true, chainTokenId: true } });
  if (!track) return res.status(404).json({ error: "track not found" });
  if (track.chainTokenId == null) return res.status(400).json({ error: "track is not on-chain" });

  const v = await verifySecondarySale({
    txHash,
    expectedTokenId: track.chainTokenId,
    expectedParty: req.user.address,
    expectedQty: q,
  });
  if (!v.ok) return res.status(400).json({ error: "secondary sale not verified on-chain", reason: v.reason });

  try {
    // resolve (or create) buyer + seller users from the on-chain event — the
    // authenticated wallet is one of them, the counterparty may be unknown to us
    const [buyer, seller] = await Promise.all([
      prisma.user.upsert({ where: { address: v.buyer }, update: {}, create: { address: v.buyer } }),
      v.seller
        ? prisma.user.upsert({ where: { address: v.seller }, update: {}, create: { address: v.seller } })
        : Promise.resolve(null),
    ]);

    const sale = await prisma.sale.create({
      data: {
        trackId,
        buyerId: buyer.id,
        sellerId: seller?.id || null,
        kind: v.kind, // secondary_listing | secondary_offer
        qty: q,
        priceWei: String(v.paid ?? "0"),
        txHash,
      },
    });
    res.status(201).json(sale);
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "sale already recorded for this txHash" });
    res.status(500).json({ error: "could not record secondary sale", detail: String(e.message || e) });
  }
});

export default r;
