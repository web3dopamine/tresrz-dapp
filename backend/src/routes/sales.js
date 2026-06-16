import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPurchase, chainConfigured } from "../chain.js";
const r = Router();

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

  try {
    const sale = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.create({
        data: { trackId, buyerId: req.user.id, qty: q, priceWei: String(priceWei ?? v.paid ?? "0"), txHash },
      });
      await tx.track.update({ where: { id: trackId }, data: { minted: { increment: q } } });
      return s;
    });
    res.status(201).json(sale);
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "sale already recorded for this txHash" });
    res.status(500).json({ error: "could not record sale", detail: String(e.message || e) });
  }
});

export default r;
