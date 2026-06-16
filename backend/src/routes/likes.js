import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
const r = Router();

// POST /api/likes/:trackId  -> toggle like
r.post("/:trackId", requireAuth, async (req, res) => {
  const { trackId } = req.params;
  try {
    const track = await prisma.track.findUnique({ where: { id: trackId }, select: { id: true } });
    if (!track) return res.status(404).json({ error: "track not found" });
    const existing = await prisma.like.findUnique({ where: { userId_trackId: { userId: req.user.id, trackId } } });
    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
    } else {
      await prisma.like.create({ data: { userId: req.user.id, trackId } });
    }
    const count = await prisma.like.count({ where: { trackId } });
    res.json({ liked: !existing, count });
  } catch (e) {
    res.status(500).json({ error: "could not toggle like", detail: String(e.message || e) });
  }
});

export default r;
