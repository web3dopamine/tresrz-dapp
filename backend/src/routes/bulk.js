import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { usdPerEth } from "./rate.js";

// Self-serve BULK collection upload. A collection owner ingests many items at
// once — either by pasting a metadata base URL (a folder of N.json files, like
// OpenSea/IPFS drops) or by uploading a CSV. Items are imported as a CATALOG
// (DB rows referencing their media): they show + play immediately, and buying
// stays gated until they're minted on-chain (a separate, gas-controlled step) —
// exactly like every other custodial track. This never auto-spends gas.
const r = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const MAX_ITEMS = 5000;            // per-job safety cap
const CONCURRENCY = 6;

// USD price per rarity tier (same tiers the platform already uses). When an item
// carries a known Rarity trait we price by tier; otherwise the creator's default.
const PRICE_USD = {
  "COMMON": 15, "UNCOMMON": 25, "RARE": 75, "SUPER RARE": 120, "ULTRA RARE": 200,
  "EPIC": 300, "LEGENDARY": 500, "MYTHIC": 750, "ONE OF A KIND": 1000, "1 OF 1": 1000,
};

const usdToWei = (usd, rate) => BigInt(Math.round((Number(usd) / rate) * 1e18)).toString();
const attrOf = (list, t) => {
  const a = (Array.isArray(list) ? list : []).find((x) => String(x?.trait_type).toLowerCase() === t.toLowerCase());
  return a ? a.value : null;
};

// ---- in-memory job registry (polled by the client) ----------------------
const jobs = new Map(); // jobId -> progress record
let seq = 0;
function newJob(mode, collectionId, ownerId, total) {
  const id = `job_${Date.now().toString(36)}_${++seq}`;
  const rec = { id, mode, collectionId, ownerId, status: "running", total, done: 0, created: 0, skipped: 0, failed: 0, errors: [], startedAt: Date.now(), finishedAt: null };
  jobs.set(id, rec);
  // evict old finished jobs so the map can't grow unbounded
  if (jobs.size > 200) for (const [k, v] of jobs) { if (v.finishedAt && Date.now() - v.finishedAt > 3600e3) jobs.delete(k); }
  return rec;
}
function noteError(rec, msg) { if (rec.errors.length < 25) rec.errors.push(String(msg).slice(0, 200)); }

async function fetchJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

// Create one catalog Track row from a normalized item. Deduped by metadataUri
// (URL mode) so re-running a job is idempotent.
async function createItem({ ownerId, collectionId, rate, defaultUsd }, it) {
  const rarity = it.rarity ? String(it.rarity).toUpperCase().trim() : "";
  // pricing precedence: an explicit per-item price wins, else the rarity tier,
  // else the creator's default. (URL items carry no explicit price → tier/default.)
  const explicit = it.priceUsd != null && String(it.priceUsd).trim() !== "" ? Number(it.priceUsd) : null;
  const usd = (explicit != null && Number.isFinite(explicit) && explicit >= 0) ? explicit
    : (rarity && PRICE_USD[rarity]) ? PRICE_USD[rarity]
    : defaultUsd;
  const media = it.media || null;
  const mime = media && /\.(mp4|webm|mov)$/i.test(media) ? "video/mp4" : (media ? "audio/mpeg" : null);
  await prisma.track.create({
    data: {
      title: String(it.name || "Untitled").slice(0, 120),
      genre: String(it.genre || "MUSIC").toUpperCase().slice(0, 40),
      coverSeed: Math.floor(Math.random() * 9973),
      audioUrl: media,
      coverUrl: it.image || null,
      externalUrl: media,
      metadataUri: it.metadataUri || null,
      attributes: Array.isArray(it.attributes) && it.attributes.length ? it.attributes : undefined,
      rarity: rarity || null,
      mime,
      priceWei: usdToWei(usd, rate),
      maxSupply: 1,
      chainTokenId: null,
      mintStatus: "active",   // visible + playable; buy gated until on-chain
      custodial: true,
      collectionId,
      artistId: ownerId,
    },
  });
}

// Run items through a small concurrency pool, updating the job record live.
async function runJob(rec, items, ctx) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const it = items[idx++];
      try {
        await createItem(ctx, it);
        rec.created++;
      } catch (e) {
        if (e?.code === "P2002") rec.skipped++;   // already imported (unique metadataUri)
        else { rec.failed++; noteError(rec, e.message || e); }
      }
      rec.done++;
    }
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    rec.status = "done";
  } catch (e) {
    rec.status = "error"; noteError(rec, e.message || e);
  } finally {
    rec.finishedAt = Date.now();
  }
}

// Verify the caller owns the target collection; returns the collection or sends 4xx.
async function ownCollection(req, res) {
  const collectionId = String(req.body?.collectionId || "");
  if (!collectionId) { res.status(400).json({ error: "collectionId required" }); return null; }
  const c = await prisma.collection.findUnique({ where: { id: collectionId }, select: { id: true, ownerId: true } });
  if (!c) { res.status(404).json({ error: "collection not found" }); return null; }
  if (c.ownerId !== req.user.id) { res.status(403).json({ error: "you can only import into your own collections" }); return null; }
  return c;
}

// POST /api/bulk/url  { collectionId, baseUrl, start, end, ext?, defaultPriceUsd? }
// Ingests baseUrl/{n}{ext} for n in [start,end]. ext defaults to ".json".
r.post("/url", requireAuth, async (req, res) => {
  const c = await ownCollection(req, res);
  if (!c) return;
  let baseUrl = String(req.body?.baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: "baseUrl must be an http(s) URL" });
  const start = Math.max(0, Math.floor(Number(req.body?.start ?? 1)));
  const end = Math.floor(Number(req.body?.end ?? 0));
  const ext = String(req.body?.ext || ".json");
  const defaultUsd = Number(req.body?.defaultPriceUsd ?? 15) || 15;
  if (!Number.isInteger(end) || end < start) return res.status(400).json({ error: "end must be an integer >= start" });
  if (end - start + 1 > MAX_ITEMS) return res.status(400).json({ error: `range too large (max ${MAX_ITEMS} items per job)` });

  const rate = await usdPerEth();
  if (!rate) return res.status(503).json({ error: "price rate unavailable, try again shortly" });

  const total = end - start + 1;
  const rec = newJob("url", c.id, req.user.id, total);
  res.status(202).json({ jobId: rec.id, total });

  // fetch + create in the background; the client polls /api/bulk/:jobId
  (async () => {
    const ctx = { ownerId: req.user.id, collectionId: c.id, rate, defaultUsd };
    let n = start;
    async function worker() {
      while (n <= end) {
        const cur = n++;
        const metaUri = `${baseUrl}/${cur}${ext}`;
        const d = await fetchJSON(metaUri);
        if (!d) { rec.failed++; rec.done++; noteError(rec, `fetch failed: ${cur}${ext}`); continue; }
        const it = {
          name: d.name, image: d.image, media: d.animation_url || d.audio_url || null,
          attributes: d.attributes, metadataUri: metaUri,
          rarity: attrOf(d.attributes, "Rarity"),
          genre: attrOf(d.attributes, "Genre") || attrOf(d.attributes, "Category"),
        };
        try { await createItem(ctx, it); rec.created++; }
        catch (e) { if (e?.code === "P2002") rec.skipped++; else { rec.failed++; noteError(rec, e.message || e); } }
        rec.done++;
      }
    }
    try { await Promise.all(Array.from({ length: CONCURRENCY }, worker)); rec.status = "done"; }
    catch (e) { rec.status = "error"; noteError(rec, e.message || e); }
    finally { rec.finishedAt = Date.now(); }
  })();
});

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines).
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// POST /api/bulk/csv  (multipart: file=CSV, fields: collectionId, defaultPriceUsd?)
// Columns (case-insensitive, flexible): name, price/priceusd, image, media/animation/audio,
// rarity, genre. A `price` column is treated as USD.
r.post("/csv", requireAuth, upload.single("file"), async (req, res) => {
  const c = await ownCollection(req, res);
  if (!c) return;
  if (!req.file) return res.status(400).json({ error: "no CSV file" });
  const defaultUsd = Number(req.body?.defaultPriceUsd ?? 15) || 15;

  const rows = parseCSV(req.file.buffer.toString("utf8"));
  if (rows.length < 2) return res.status(400).json({ error: "CSV needs a header row and at least one data row" });
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
  const iName = col("name", "title");
  const iPrice = col("price", "priceusd", "price_usd", "usd");
  const iImage = col("image", "cover", "image_url");
  const iMedia = col("media", "animation", "animation_url", "audio", "audio_url", "video");
  const iRarity = col("rarity");
  const iGenre = col("genre", "category");
  if (iName === -1) return res.status(400).json({ error: 'CSV must have a "name" column' });

  const items = rows.slice(1, 1 + MAX_ITEMS).map((cells) => ({
    name: cells[iName],
    priceUsd: iPrice !== -1 ? cells[iPrice] : "",
    image: iImage !== -1 ? cells[iImage]?.trim() : "",
    media: iMedia !== -1 ? cells[iMedia]?.trim() : "",
    rarity: iRarity !== -1 ? cells[iRarity] : "",
    genre: iGenre !== -1 ? cells[iGenre] : "",
  }));

  const rate = await usdPerEth();
  if (!rate) return res.status(503).json({ error: "price rate unavailable, try again shortly" });

  const rec = newJob("csv", c.id, req.user.id, items.length);
  res.status(202).json({ jobId: rec.id, total: items.length });
  runJob(rec, items, { ownerId: req.user.id, collectionId: c.id, rate, defaultUsd });
});

// GET /api/bulk/:jobId -> live progress (owner only)
r.get("/:jobId", requireAuth, (req, res) => {
  const rec = jobs.get(req.params.jobId);
  if (!rec) return res.status(404).json({ error: "job not found (it may have expired)" });
  if (rec.ownerId !== req.user.id) return res.status(403).json({ error: "not your job" });
  const { id, mode, status, total, done, created, skipped, failed, errors } = rec;
  res.json({ id, mode, status, total, done, created, skipped, failed, errors });
});

export default r;
