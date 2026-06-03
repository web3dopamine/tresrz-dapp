import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
const r = Router();

// POST /api/sales  -> record a confirmed primary purchase
r.post("/", requireAuth, async (req, res) => {
  const { trackId, qty, priceWei, txHash } = req.body;
  if (!trackId || !qty || !txHash) return res.status(400).json({ error: "missing fields" });
  try {
    const sale = await prisma.$transaction(async (tx) => {
      const s = await tx.sale.create({ data: { trackId, buyerId: req.user.id, qty: Number(qty), priceWei: String(priceWei || "0"), txHash } });
      await tx.track.update({ where: { id: trackId }, data: { minted: { increment: Number(qty) } } });
      return s;
    });
    res.status(201).json(sale);
  } catch (e) {
    res.status(409).json({ error: "duplicate or invalid sale", detail: String(e.message || e) });
  }
});

export default r;
