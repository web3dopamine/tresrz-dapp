import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

// Named collections (OpenSea-style). One creator can own many. Tracks link to a
// collection via Track.collectionId; the collection name/description/owner live here.
const r = Router();

const handleOf = (u) => u.handle || (u.email ? u.email.split("@")[0] : (u.address ? u.address.slice(0, 6) + "…" : "Creator"));
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "collection";

async function stats(collectionId) {
  const where = { collectionId, flagged: false, mintStatus: { in: ["active", "minting", "publishing"] } };
  const itemCount = await prisma.track.count({ where: { collectionId, flagged: false } });
  const covers = await prisma.track.findMany({ where, select: { coverSeed: true, coverUrl: true }, take: 4, orderBy: { createdAt: "desc" } });
  let floorWei = null;
  try {
    const f = await prisma.$queryRawUnsafe(
      `SELECT MIN(CAST("priceWei" AS NUMERIC))::text AS floor FROM "Track" WHERE "collectionId"=$1 AND flagged=false AND "mintStatus" IN ('active','minting','publishing')`, collectionId);
    floorWei = f[0]?.floor || null;
  } catch {}
  return { itemCount, floorWei, covers };
}

// POST /api/collections  -> create a collection {name, description?}
r.post("/", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim() || null;
  if (!name || name.length > 80) return res.status(400).json({ error: "name required (<=80 chars)" });
  let base = slugify(name), slug = base, n = 1;
  while (await prisma.collection.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
  const c = await prisma.collection.create({ data: { name: name.slice(0, 80), description, slug, ownerId: req.user.id } });
  res.status(201).json({ id: c.id, name: c.name, slug: c.slug, description: c.description });
});

// GET /api/collections  -> all collections with stats (for the homepage grid)
r.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 50);
  const cols = await prisma.collection.findMany({
    where: { flagged: false }, include: { owner: true, _count: { select: { tracks: true } } },
    orderBy: { tracks: { _count: "desc" } }, take: limit,
  });
  const out = await Promise.all(cols.map(async (c) => ({
    id: c.id, name: c.name, slug: c.slug, description: c.description, coverUrl: c.coverUrl,
    owner: { id: c.owner.id, handle: handleOf(c.owner), avatarSeed: c.owner.avatarSeed, address: c.owner.address || c.owner.id },
    ...(await stats(c.id)),
  })));
  res.json(out);
});

// GET /api/collections/mine  -> the caller's own collections (for the publish picker)
r.get("/mine", requireAuth, async (req, res) => {
  const cols = await prisma.collection.findMany({
    where: { ownerId: req.user.id }, include: { _count: { select: { tracks: true } } }, orderBy: { createdAt: "desc" },
  });
  res.json(cols.map((c) => ({ id: c.id, name: c.name, slug: c.slug, itemCount: c._count.tracks })));
});

// PATCH /api/collections/:id  -> owner self-edits their collection.
// Editable: name, description, cover image. Slug stays stable so existing links
// keep working even after a rename.
r.patch("/:id", requireAuth, async (req, res) => {
  const c = await prisma.collection.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
  if (!c) return res.status(404).json({ error: "collection not found" });
  if (c.ownerId !== req.user.id) return res.status(403).json({ error: "you can only edit your own collections" });

  const b = req.body || {};
  const data = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 80) return res.status(400).json({ error: "name required (<=80 chars)" });
    data.name = name;
  }
  if (b.description !== undefined) data.description = String(b.description).trim() || null;
  if (b.coverUrl !== undefined) data.coverUrl = String(b.coverUrl).trim() || null;
  if (Object.keys(data).length === 0) return res.status(400).json({ error: "no editable fields provided" });

  const updated = await prisma.collection.update({ where: { id: req.params.id }, data });
  res.json({ id: updated.id, name: updated.name, slug: updated.slug, description: updated.description, coverUrl: updated.coverUrl });
});

// GET /api/collections/:key  -> one collection (by id or slug) with stats + rarities
r.get("/:key", async (req, res) => {
  const c = await prisma.collection.findFirst({ where: { OR: [{ id: req.params.key }, { slug: req.params.key }], flagged: false }, include: { owner: true } });
  if (!c) return res.status(404).json({ error: "collection not found" });
  const s = await stats(c.id);
  const groups = await prisma.track.groupBy({ by: ["rarity"], where: { collectionId: c.id, flagged: false, rarity: { not: null } }, _count: { rarity: true } });
  res.json({
    id: c.id, name: c.name, slug: c.slug, description: c.description, coverUrl: c.coverUrl,
    owner: { id: c.owner.id, handle: handleOf(c.owner), avatarSeed: c.owner.avatarSeed, address: c.owner.address || c.owner.id },
    itemCount: s.itemCount, floorWei: s.floorWei, covers: s.covers,
    rarities: groups.map((g) => ({ rarity: g.rarity, count: g._count.rarity })).sort((a, b) => b.count - a.count),
  });
});

export default r;
