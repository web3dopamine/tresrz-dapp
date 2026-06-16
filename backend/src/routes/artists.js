import { Router } from "express";
import { prisma } from "../db.js";
import { optionalAuth } from "../middleware/auth.js";
const r = Router();

const shapeTrack = (t, userId) => ({
  id: t.id,
  chainTokenId: t.chainTokenId,
  title: t.title,
  genre: t.genre,
  coverSeed: t.coverSeed,
  audioUrl: t.audioUrl,
  priceWei: t.priceWei,
  maxSupply: t.maxSupply,
  minted: t.minted,
  left: t.maxSupply - t.minted,
  hot: t.hot,
  artist: { id: t.artist.id, handle: t.artist.handle || t.artist.address.slice(0, 6) + "…", address: t.artist.address, avatarSeed: t.artist.avatarSeed },
  likes: t._count?.likes ?? 0,
  liked: userId ? t.likes?.some((l) => l.userId === userId) : false,
});

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

// GET /api/artists/:key  -> one artist (by wallet address or id) with their tracks
r.get("/:key", optionalAuth, async (req, res) => {
  const { key } = req.params;
  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ address: { equals: key, mode: "insensitive" } }, { id: key }] },
      include: {
        tracks: {
          orderBy: { createdAt: "desc" },
          include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
        },
      },
    });
    if (!user) return res.status(404).json({ error: "artist not found" });
    const tracks = user.tracks.map((t) => shapeTrack(t, req.user?.id));
    res.json({
      id: user.id,
      handle: user.handle || user.address.slice(0, 6) + "…" + user.address.slice(-4),
      address: user.address,
      avatarSeed: user.avatarSeed,
      bio: user.bio,
      nftCount: tracks.length,
      totalLikes: tracks.reduce((s, t) => s + t.likes, 0),
      tracks,
    });
  } catch (e) {
    res.status(500).json({ error: "could not load artist", detail: String(e.message || e) });
  }
});

export default r;
