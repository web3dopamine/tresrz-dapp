import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";

const r = Router();

const shape = (t, userId) => ({
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

// GET /api/tracks?hot=true&genre=HOUSE&limit=10
r.get("/", optionalAuth, async (req, res) => {
  const { hot, genre, limit } = req.query;
  const where = {};
  if (hot === "true") where.hot = true;
  if (genre) where.genre = String(genre).toUpperCase();
  const tracks = await prisma.track.findMany({
    where,
    take: limit ? Number(limit) : 50,
    orderBy: { createdAt: "desc" },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });
  res.json(tracks.map((t) => shape(t, req.user?.id)));
});

r.get("/:id", optionalAuth, async (req, res) => {
  const t = await prisma.track.findUnique({
    where: { id: req.params.id },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(shape(t, req.user?.id));
});

// POST /api/tracks  (after on-chain mint, persist metadata)
r.post("/", requireAuth, async (req, res) => {
  const { title, genre, maxSupply, priceWei, coverSeed, audioUrl, chainTokenId, txHash } = req.body;
  if (!title || !genre || !maxSupply) return res.status(400).json({ error: "missing fields" });
  const track = await prisma.track.create({
    data: {
      title, genre: String(genre).toUpperCase(),
      maxSupply: Number(maxSupply), priceWei: String(priceWei || "0"),
      coverSeed: Number(coverSeed) || Math.floor(Math.random() * 9999),
      audioUrl: audioUrl || null, chainTokenId: chainTokenId ?? null, txHash: txHash || null,
      artistId: req.user.id,
    },
    include: { artist: true, _count: { select: { likes: true } } },
  });
  res.status(201).json(shape(track, req.user.id));
});

export default r;
