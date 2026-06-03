import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
const r = Router();

// POST /api/likes/:trackId  -> toggle like
r.post("/:trackId", requireAuth, async (req, res) => {
  const { trackId } = req.params;
  const existing = await prisma.like.findUnique({ where: { userId_trackId: { userId: req.user.id, trackId } } });
  if (existing) {
    await prisma.like.delete({ where: { id: existing.id } });
  } else {
    await prisma.like.create({ data: { userId: req.user.id, trackId } });
  }
  const count = await prisma.like.count({ where: { trackId } });
  res.json({ liked: !existing, count });
});

export default r;
