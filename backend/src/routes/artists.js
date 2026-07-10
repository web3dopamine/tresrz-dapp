import { Router } from "express";
import { prisma } from "../db.js";
import { optionalAuth } from "../middleware/auth.js";
import { artistShape } from "./tracks.js";
const r = Router();

const displayHandle = (u) => u.handle || (u.email ? u.email.split("@")[0] : (u.address ? u.address.slice(0, 6) + "…" + u.address.slice(-4) : "Creator"));

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
  custodial: t.custodial,
  artist: artistShape(t.artist),
  likes: t._count?.likes ?? 0,
  liked: userId ? t.likes?.some((l) => l.userId === userId) : false,
  txHash: t.txHash,
  createdAt: t.createdAt,
});

// GET /api/artists  -> popular artists w/ track + like counts (flagged users
// are moderated out of public discovery)
r.get("/", async (_req, res) => {
  // Don't load every artist's tracks (a creator can have thousands) — use _count
  // plus a cheap per-artist like count instead.
  const users = await prisma.user.findMany({
    where: { flagged: false },
    include: { _count: { select: { tracks: true } } },
    take: 50,
  });
  const out = (await Promise.all(
    users.map(async (u) => ({
      id: u.id,
      handle: displayHandle(u),
      address: u.address || u.id, // custodial creators have no wallet — key by id
      avatarSeed: u.avatarSeed,
      nftCount: u._count.tracks,
      likes: u._count.tracks ? await prisma.like.count({ where: { track: { artistId: u.id } } }) : 0,
    })),
  ))
    .filter((u) => u.nftCount > 0)
    .sort((a, b) => b.likes - a.likes || b.nftCount - a.nftCount);
  res.json(out);
});

// GET /api/artists/:key  -> one artist (by wallet address or id) with their tracks
r.get("/:key", optionalAuth, async (req, res) => {
  const { key } = req.params;
  try {
    // Header only — DON'T load all tracks (a creator may have thousands). The
    // browsable grid is loaded/paginated/filtered via GET /api/tracks?artist=…
    const user = await prisma.user.findFirst({
      where: { OR: [{ address: { equals: key, mode: "insensitive" } }, { id: key }] },
      include: {
        _count: { select: { tracks: true } },
        tracks: {
          take: 24, orderBy: { createdAt: "desc" },
          include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
        },
      },
    });
    if (!user) return res.status(404).json({ error: "artist not found" });
    const tracks = user.tracks.map((t) => shapeTrack(t, req.user?.id));
    const totalLikes = user._count.tracks ? await prisma.like.count({ where: { track: { artistId: user.id } } }) : 0;
    res.json({
      id: user.id,
      handle: displayHandle(user),
      address: user.address || user.id,
      avatarSeed: user.avatarSeed,
      bio: user.bio,
      custodial: user.custodial,
      nftCount: user._count.tracks,
      totalLikes,
      tracks,   // first page only; use /api/tracks?artist=<id> for the rest
    });
  } catch (e) {
    res.status(500).json({ error: "could not load artist", detail: String(e.message || e) });
  }
});

export default r;
