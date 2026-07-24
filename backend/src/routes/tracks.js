import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { submitSetPrice, submitBatchSetPrice, onChainPrice } from "../chain.js";

const r = Router();

// --- collection trait rarity ---------------------------------------------
// OpenSea-style: for each (trait_type, value) in a creator's collection, how
// many items share it. Computed once per artist via a grouped jsonb query and
// cached for 5 min (a 9k-item collection groups in ms, but this avoids doing it
// on every item view).
const traitCache = new Map(); // artistId -> { at, total, map: {trait_type: {value: count}} }
async function traitDistribution(artistId) {
  const hit = traitCache.get(artistId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT elem->>'trait_type' AS tt, elem->>'value' AS val, COUNT(*)::int AS cnt
     FROM "Track", jsonb_array_elements(attributes) elem
     WHERE "artistId" = $1 AND attributes IS NOT NULL AND flagged = false
     GROUP BY 1, 2`,
    artistId,
  );
  const total = await prisma.track.count({ where: { artistId, flagged: false, attributes: { not: null } } });
  const map = {};
  for (const row of rows) { (map[row.tt] ||= {})[row.val] = Number(row.cnt); }
  const entry = { at: Date.now(), total, map };
  traitCache.set(artistId, entry);
  return entry;
}

// Attach OpenSea-style rarity (count + % of collection) to each attribute.
async function withTraitRarity(attributes, artistId) {
  if (!Array.isArray(attributes) || !attributes.length) return attributes || null;
  const dist = await traitDistribution(artistId);
  return attributes.map((a) => {
    const cnt = dist.map[a.trait_type]?.[a.value] ?? null;
    return { ...a, count: cnt, pct: cnt && dist.total ? Number(((100 * cnt) / dist.total).toFixed(2)) : null };
  });
}

// Display shape for an artist that may be a custodial (wallet-less) creator:
// no address, so fall back to the creator id for profile links and derive a
// handle from handle -> email prefix -> short address/id.
export function artistShape(a) {
  const key = a.address || a.id;
  const handle = a.handle || (a.email ? a.email.split("@")[0] : (a.address ? a.address.slice(0, 6) + "…" : "Creator"));
  return { id: a.id, handle, address: key, avatarSeed: a.avatarSeed, custodial: a.custodial };
}

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
  custodial: t.custodial,
  mintStatus: t.mintStatus,
  rarity: t.rarity,
  artist: artistShape(t.artist),
  likes: t._count?.likes ?? 0,
  liked: userId ? t.likes?.some((l) => l.userId === userId) : false,
  txHash: t.txHash,
  createdAt: t.createdAt,
});

// GET /api/tracks?hot=true&genre=HOUSE&limit=10
r.get("/", optionalAuth, async (req, res) => {
  const { hot, genre, limit, q, rarity, artist, skip, collection } = req.query;
  // hide moderated tracks + users and failed publishes; show live tracks plus ones
  // still finalizing in the background (publishing/minting) so a fresh publish
  // appears on the marketplace instantly (buying is gated until it's on-chain).
  const where = { flagged: false, artist: { flagged: false }, mintStatus: { in: ["active", "minting", "publishing"] } };
  if (hot === "true") where.hot = true;
  if (genre) where.genre = String(genre).toUpperCase();
  if (rarity) where.rarity = String(rarity).toUpperCase();          // COMMON | RARE | ULTRA RARE
  if (artist) where.artistId = String(artist);                       // scope to one creator
  if (collection) where.collectionId = String(collection);          // scope to one collection
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
    take: Math.min(limit ? Number(limit) : 50, 100),                 // cap page size
    skip: skip ? Number(skip) : 0,                                    // pagination offset
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
    where: { flagged: false, artist: { flagged: false }, mintStatus: { in: ["active", "minting", "publishing"] } },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });

  // Freshly-minted tracks get a spot at the top of TRENDING so new creators get
  // immediate visibility. A track counts as "new" for TRENDING_NEW_HOURS (default
  // 24h) after it's created; within that band the newest sits highest. After the
  // window it drops into the normal volume -> sales -> likes ranking.
  const newMs = Number(process.env.TRENDING_NEW_HOURS || 24) * 3600e3;
  const now = Date.now();

  const ranked = tracks
    .map((t) => {
      const a = agg.get(t.id) || { volume: 0n, count: 0 };
      const isNew = now - new Date(t.createdAt).getTime() < newMs;
      return { t, volume: a.volume, count: a.count, isNew };
    })
    .sort((x, y) => {
      if (x.isNew !== y.isNew) return x.isNew ? -1 : 1;                        // fresh mints first
      if (x.isNew && y.isNew)                                                   // newest first within the fresh band
        return new Date(y.t.createdAt).getTime() - new Date(x.t.createdAt).getTime();
      if (x.volume !== y.volume) return x.volume > y.volume ? -1 : 1;
      if (x.count !== y.count) return y.count - x.count;
      return (y.t._count?.likes ?? 0) - (x.t._count?.likes ?? 0);
    })
    .slice(0, Number(req.query.limit) || 10)
    .map(({ t, volume, count, isNew }) => ({
      ...shape(t, req.user?.id),
      windowVolumeWei: volume.toString(),
      windowSales: count,
      isNew,
    }));
  res.json(ranked);
});

// GET /api/tracks/mine  -> the logged-in user's own created/minted tracks
// (any auth method — email, Google, or wallet). Unlike the public list this
// includes tracks still confirming on-chain (mintStatus "minting") and failed
// ones, so a creator always sees everything they've minted. Must be registered
// before /:id or "mine" is parsed as a track id.
// GET /api/tracks/rarities?artist=<id>  -> [{rarity, count}] for filter chips.
// Registered before /:id so "rarities" isn't parsed as a track id.
r.get("/rarities", async (req, res) => {
  const where = { flagged: false, artist: { flagged: false }, mintStatus: { in: ["active", "minting", "publishing"] }, rarity: { not: null } };
  if (req.query.artist) where.artistId = String(req.query.artist);
  if (req.query.collection) where.collectionId = String(req.query.collection);
  const groups = await prisma.track.groupBy({ by: ["rarity"], where, _count: { rarity: true } });
  res.json(groups.map((g) => ({ rarity: g.rarity, count: g._count.rarity })).sort((a, b) => b.count - a.count));
});

r.get("/mine", requireAuth, async (req, res) => {
  const tracks = await prisma.track.findMany({
    where: { artistId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: { artist: true, _count: { select: { likes: true } }, likes: { where: { userId: req.user.id } } },
  });
  res.json(tracks.map((t) => shape(t, req.user.id)));
});

r.get("/:id", optionalAuth, async (req, res) => {
  const t = await prisma.track.findUnique({
    where: { id: req.params.id },
    include: { artist: true, _count: { select: { likes: true } }, likes: req.user ? { where: { userId: req.user.id } } : false },
  });
  if (!t) return res.status(404).json({ error: "not found" });
  // detail view carries the full trait list with collection rarity (OpenSea-style)
  const attributes = await withTraitRarity(t.attributes, t.artistId).catch(() => t.attributes || null);
  res.json({ ...shape(t, req.user?.id), attributes, externalUrl: t.externalUrl });
});

// PATCH /api/tracks/:id  -> creator self-edits their own track's details.
// Only the artist (owner) may edit. Editable: title, genre, price, cover image,
// rarity, external link. Chain-anchored fields (tokenId, supply, minted, txHash)
// are intentionally NOT editable here.
r.patch("/:id", requireAuth, async (req, res) => {
  const t = await prisma.track.findUnique({ where: { id: req.params.id }, select: { artistId: true, chainTokenId: true, priceWei: true } });
  if (!t) return res.status(404).json({ error: "not found" });
  if (t.artistId !== req.user.id) return res.status(403).json({ error: "you can only edit your own tracks" });

  const b = req.body || {};
  const data = {};
  if (b.title !== undefined) {
    const title = String(b.title).trim();
    if (!title) return res.status(400).json({ error: "title cannot be empty" });
    data.title = title.slice(0, 120);
  }
  if (b.genre !== undefined) data.genre = String(b.genre).toUpperCase().trim().slice(0, 40) || "MUSIC";
  if (b.rarity !== undefined) data.rarity = b.rarity ? String(b.rarity).toUpperCase().trim().slice(0, 40) : null;
  if (b.coverUrl !== undefined) data.coverUrl = String(b.coverUrl).trim() || null;
  if (b.externalUrl !== undefined) data.externalUrl = String(b.externalUrl).trim() || null;
  // price: accept ETH (human-friendly) and store as wei string. priceWei also accepted.
  if (b.priceEth !== undefined) {
    const eth = Number(b.priceEth);
    if (!Number.isFinite(eth) || eth < 0) return res.status(400).json({ error: "price must be a non-negative number" });
    data.priceWei = BigInt(Math.round(eth * 1e18)).toString();
  } else if (b.priceWei !== undefined) {
    if (!/^\d+$/.test(String(b.priceWei))) return res.status(400).json({ error: "priceWei must be an integer string" });
    data.priceWei = String(b.priceWei);
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "no editable fields provided" });

  // A price change must land ON-CHAIN first: the contract decides what a buyer
  // actually pays, so writing only the DB would show one price and charge another.
  if (data.priceWei && data.priceWei !== t.priceWei && t.chainTokenId != null) {
    const r = await submitSetPrice(t.chainTokenId, data.priceWei);
    if (!r.ok) return res.status(502).json({ error: `could not update the on-chain price: ${r.reason}` });
    data.txHash = r.hash;
  }

  const updated = await prisma.track.update({
    where: { id: req.params.id }, data,
    include: { artist: true, _count: { select: { likes: true } } },
  });
  res.json({ ...shape(updated, req.user.id), externalUrl: updated.externalUrl });
});

// POST /api/tracks/reprice  -> bulk re-price the caller's tracks, on-chain + DB.
// Body: { collectionId?, byRarity?: { COMMON: 0.01, ... }, priceEth?: 0.05 }
//   byRarity -> per-tier prices; priceEth -> one flat price for every match.
// Scoped to tracks the caller owns. Pushes batchSetPrice on-chain in chunks so
// the contract and the UI can never disagree about what a buyer pays.
r.post("/reprice", requireAuth, async (req, res) => {
  const { collectionId, byRarity, priceEth } = req.body || {};
  const where = { artistId: req.user.id };
  if (collectionId) where.collectionId = String(collectionId);

  const rows = await prisma.track.findMany({ where, select: { id: true, rarity: true, chainTokenId: true } });
  if (!rows.length) return res.status(404).json({ error: "no tracks matched" });

  const toWei = (eth) => {
    const n = Number(eth);
    if (!Number.isFinite(n) || n < 0) return null;
    return (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString();
  };

  // resolve a target price per track
  const targets = [];
  for (const t of rows) {
    let eth = null;
    if (byRarity && typeof byRarity === "object") eth = byRarity[String(t.rarity || "").toUpperCase()];
    if (eth === undefined || eth === null) eth = priceEth;
    if (eth === undefined || eth === null || eth === "") continue;   // untouched tier
    const wei = toWei(eth);
    if (wei === null) return res.status(400).json({ error: `invalid price for ${t.rarity || "track"}` });
    targets.push({ ...t, wei });
  }
  if (!targets.length) return res.status(400).json({ error: "no prices supplied" });

  // on-chain first, in chunks (only tracks that are actually minted)
  const onChain = targets.filter((t) => t.chainTokenId != null);
  const txs = [];
  const CHUNK = 150;
  for (let i = 0; i < onChain.length; i += CHUNK) {
    const part = onChain.slice(i, i + CHUNK);
    const r = await submitBatchSetPrice(part.map((x) => x.chainTokenId), part.map((x) => x.wei));
    if (!r.ok) return res.status(502).json({ error: `on-chain re-price failed: ${r.reason}`, appliedTxs: txs });
    txs.push(r.hash);
  }

  // then mirror into the DB
  let updated = 0;
  for (const t of targets) {
    await prisma.track.update({ where: { id: t.id }, data: { priceWei: t.wei } });
    updated++;
  }
  res.json({ updated, onChain: onChain.length, txs });
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
