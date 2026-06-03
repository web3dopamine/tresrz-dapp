import { Router } from "express";
import { prisma } from "../db.js";
const r = Router();

// GET /api/artists  -> popular artists w/ track + like counts
r.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: { _count: { select: { tracks: true } }, tracks: { include: { _count: { select: { likes: true } } } } },
    take: 50,
  });
  const out = users
    .map((u) => ({
      id: u.id,
      handle: u.handle || u.address.slice(0, 6) + "…" + u.address.slice(-4),
      address: u.address,
      avatarSeed: u.avatarSeed,
      nftCount: u._count.tracks,
      likes: u.tracks.reduce((s, t) => s + t._count.likes, 0),
    }))
    .filter((u) => u.nftCount > 0)
    .sort((a, b) => b.likes - a.likes);
  res.json(out);
});

export default r;
