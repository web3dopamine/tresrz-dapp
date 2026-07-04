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
  audioUrl: t.audioUrl,        // public preview source
  coverUrl: t.coverUrl,
  metadataUri: t.metadataUri,
  mime: t.mime,
  hasFullAudio: !!(t.audioCid || t.audioUrl), // full track exists (gated via /api/stream)
  priceWei: t.priceWei,
  maxSupply: t.maxSupply,
  minted: t.minted,
  left: t.maxSupply - t.minted,
  hot: t.hot,
  flagged: t.flagged,
  artist: { id: t.artist.id, handle: t.artist.handle || t.artist.address.slice(0, 6) + "…", address: t.artist.address, avatarSeed: t.artist.avatarSeed },
  likes: t._count?.likes ?? 0,
  liked: userId ? t.likes?.some((l) => l.userId === userId) : false,
  txHash: t.txHash,
  createdAt: t.createdAt,
});

// GET /api/tracks?hot=true&genre=HOUSE&limit=10
r.get("/", optionalAuth, async (req, res) => {
  const { hot, genre, limit, q } = req.query;
  // hide moderated tracks — and tracks by moderated users — from public listings
  const where = { flagged: false, artist: { flagged: false } };
  if (hot === "true") where.hot = true;
  if (genre) where.genre = String(genre).toUpperCase();
  if (q) {
    // server-side search across title + artist handle/address
    where.OR = [
      { title: { contains: String(q), mode: "insensitive" } },
      { artist: { handle: { contains: String(q), mode: "insensitive" } } },
      { artist: { address: { contains: String(q), mode: "insensitive" } } },
    ];
  }
  const tracks = await prisma.track.findMany({
    where,
    take: limit ? Number(limit) : 50,
    orderBy: { createdAt: "desc" },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });
  res.json(tracks.map((t) => shape(t, req.user?.id)));
});

// GET /api/tracks/trending?window=1h|1d|7d|all  -> tracks ranked by sales
// volume inside the window (then sale count, then all-time likes). Each row
// carries windowVolumeWei + windowSales so the UI can show a VOLUME column.
// NOTE: must be registered before /:id or "trending" is parsed as a track id.
const WINDOWS = { "1h": 3600e3, "1d": 86400e3, "7d": 7 * 86400e3 };
r.get("/trending", optionalAuth, async (req, res) => {
  const win = String(req.query.window || "1d").toLowerCase();
  const ms = WINDOWS[win] ?? null; // anything else (e.g. "all") = no time filter
  const since = ms ? new Date(Date.now() - ms) : null;

  const sales = await prisma.sale.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    select: { trackId: true, qty: true, priceWei: true },
  });
  const agg = new Map(); // trackId -> { volume: bigint, count: number }
  for (const s of sales) {
    const a = agg.get(s.trackId) || { volume: 0n, count: 0 };
    try { a.volume += BigInt(s.priceWei); } catch {}
    a.count += s.qty;
    agg.set(s.trackId, a);
  }

  const tracks = await prisma.track.findMany({
    where: { flagged: false, artist: { flagged: false } },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });
  const ranked = tracks
    .map((t) => {
      const a = agg.get(t.id) || { volume: 0n, count: 0 };
      return { t, volume: a.volume, count: a.count };
    })
    .sort((x, y) => {
      if (x.volume !== y.volume) return x.volume > y.volume ? -1 : 1;
      if (x.count !== y.count) return y.count - x.count;
      return (y.t._count?.likes ?? 0) - (x.t._count?.likes ?? 0);
    })
    .slice(0, Number(req.query.limit) || 10)
    .map(({ t, volume, count }) => ({
      ...shape(t, req.user?.id),
      windowVolumeWei: volume.toString(),
      windowSales: count,
    }));
  res.json(ranked);
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
  const { title, genre, maxSupply, priceWei, coverSeed, audioUrl, audioCid, coverUrl, metadataUri, mime, chainTokenId, txHash } = req.body;
  if (!title || !genre || !maxSupply) return res.status(400).json({ error: "missing fields" });
  const supply = Number(maxSupply);
  if (!Number.isInteger(supply) || supply < 1) return res.status(400).json({ error: "maxSupply must be a positive integer" });
  try {
    const track = await prisma.track.create({
      data: {
        title: String(title).slice(0, 120), genre: String(genre).toUpperCase().slice(0, 40),
        maxSupply: supply, priceWei: String(priceWei || "0"),
        coverSeed: Number(coverSeed) || Math.floor(Math.random() * 9999),
        audioUrl: audioUrl || null,
        audioCid: audioCid || null,
        coverUrl: coverUrl || null,
        metadataUri: metadataUri || null,
        mime: mime || null,
        chainTokenId: chainTokenId === null || chainTokenId === undefined ? null : Number(chainTokenId),
        txHash: txHash || null,
        artistId: req.user.id,
      },
      include: { artist: true, _count: { select: { likes: true } } },
    });
    res.status(201).json(shape(track, req.user.id));
  } catch (e) {
    // P2002 = unique constraint (e.g. chainTokenId already persisted)
    if (e?.code === "P2002") return res.status(409).json({ error: "track already exists for this chainTokenId" });
    res.status(500).json({ error: "could not create track", detail: String(e.message || e) });
  }
});

export default r;
