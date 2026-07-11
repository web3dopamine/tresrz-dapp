import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { pinFile, pinJSON, buildMetadata } from "../ipfs.js";
import { submitMint, mintResult, deliveryConfigured } from "../chain.js";
import { usdPerEth } from "./rate.js";

// Wallet-free minting. The creator just fills a form; the PLATFORM wallet mints
// the track on-chain and is the on-chain artist, so 100% of crypto sale
// proceeds (primary + royalties) go to that single platform address. No
// per-creator wallet, account, or payout — the record here only supplies the
// artist name shown on the marketplace.
const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
// Global daily ceiling on platform-funded mints (gas-drain backstop; the
// per-IP hourly cap lives in index.js). Tune via env for launch.
const DAILY_CAP = Number(process.env.CUSTODIAL_DAILY_CAP || 200);

export const custodialEnabled = () => deliveryConfigured;

r.get("/status", (_req, res) => res.json({ enabled: custodialEnabled() }));

// POST /api/mint/custodial  (multipart)
// fields: title, genre, description?, maxSupply, priceEth, royaltyPct, coverSeed?, email, handle?
// files:  audio (required), image (optional)
r.post("/custodial", requireAuth, upload.fields([{ name: "audio", maxCount: 1 }, { name: "image", maxCount: 1 }]), async (req, res) => {
  if (!custodialEnabled()) return res.status(503).json({ error: "custodial minting not configured" });
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const genre = String(b.genre || "").trim().toUpperCase();
    const handle = String(b.handle || "").trim() || null;
    const description = String(b.description || "").trim();
    const maxSupply = Math.floor(Number(b.maxSupply));
    const priceUsd = Number(b.priceUsd);
    const royaltyPct = Number(b.royaltyPct);
    const coverSeed = Number(b.coverSeed) || Math.floor(Math.random() * 9999);
    const collectionId = String(b.collectionId || "").trim() || null;

    // ---- validation ----
    if (!title || title.length > 120) return res.status(400).json({ error: "title required (<=120 chars)" });
    if (!genre) return res.status(400).json({ error: "genre required" });
    if (!Number.isInteger(maxSupply) || maxSupply < 1 || maxSupply > 100000) return res.status(400).json({ error: "maxSupply must be 1..100000" });
    if (!Number.isFinite(priceUsd) || priceUsd < 0) return res.status(400).json({ error: "price must be >= 0" });
    if (!Number.isFinite(royaltyPct) || royaltyPct < 0 || royaltyPct > 10) return res.status(400).json({ error: "royalty must be 0..10%" });
    const audio = req.files?.audio?.[0];
    if (!audio) return res.status(400).json({ error: "audio file required" });
    if (!AUDIO_MIMES.includes(audio.mimetype)) return res.status(415).json({ error: `unsupported audio type ${audio.mimetype}` });
    const image = req.files?.image?.[0];
    if (image && !IMAGE_MIMES.includes(image.mimetype)) return res.status(415).json({ error: `unsupported image type ${image.mimetype}` });

    // creator prices in USD; snapshot the on-chain price in wei at the live rate.
    const rate = await usdPerEth();
    if (!rate) return res.status(503).json({ error: "USD rate unavailable, try again in a moment" });
    const priceEth = priceUsd / rate;
    const priceWei = BigInt(Math.round(priceEth * 1e18)).toString();
    const royaltyBps = Math.round(royaltyPct * 100);

    // global daily cap (gas-drain backstop)
    const since = new Date(Date.now() - 86400e3);
    if ((await prisma.track.count({ where: { custodial: true, createdAt: { gte: since } } })) >= DAILY_CAP) {
      return res.status(429).json({ error: "daily minting limit reached, please try again tomorrow" });
    }

    // ---- the artist is the LOGGED-IN user (attribution/display). The platform
    // wallet is the on-chain artist, so ALL crypto proceeds go to it. If the user
    // gave an artist name and doesn't have one yet, adopt it (when free).
    const creator = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!creator) return res.status(401).json({ error: "account not found" });
    if (handle && !creator.handle) {
      const free = !(await prisma.user.findUnique({ where: { handle } }));
      if (free) await prisma.user.update({ where: { id: creator.id }, data: { handle } });
    }

    // optional: assign to one of the creator's own collections
    let validCollectionId = null;
    if (collectionId) {
      const col = await prisma.collection.findFirst({ where: { id: collectionId, ownerId: creator.id } });
      if (!col) return res.status(400).json({ error: "collection not found or not yours" });
      validCollectionId = col.id;
    }

    // ---- persist a "publishing" placeholder and RETURN IMMEDIATELY. The slow work
    // — pinning audio/image/metadata to IPFS and submitting the on-chain mint — is
    // done in the background (see finalizePublish). The track is hidden from public
    // listings until it's live; the creator sees it as "publishing" in the meantime.
    const track = await prisma.track.create({
      data: {
        title: title.slice(0, 120), genre: genre.slice(0, 40), maxSupply, priceWei,
        coverSeed, audioCid: null, metadataUri: null,
        mime: audio.mimetype, chainTokenId: null, txHash: null, mintTx: null,
        mintStatus: "publishing", custodial: true, artistId: creator.id,
        collectionId: validCollectionId,
        // store the raw bytes so the track is served + playable from our DB instantly
        media: { create: {
          audioData: audio.buffer, audioMime: audio.mimetype,
          imageData: image?.buffer || null, imageMime: image?.mimetype || null,
        } },
      },
    });
    // point preview/cover at the DB-backed media route (available immediately)
    await prisma.track.update({
      where: { id: track.id },
      data: {
        audioUrl: `/api/media/${track.id}/audio`,
        coverUrl: image ? `/api/media/${track.id}/cover` : null,
      },
    });

    res.status(201).json({ trackId: track.id, status: "publishing" });

    // Fire-and-forget: pin to IPFS + submit the mint. Buffers stay alive via the
    // closure until the job finishes. On any failure the track is marked "failed".
    finalizePublish(track.id, {
      audioBuf: audio.buffer, audioName: audio.originalname, audioType: audio.mimetype,
      imageBuf: image?.buffer || null, imageName: image?.originalname, imageType: image?.mimetype,
      title, description, genre, metaArtist: handle || "TRESRZ", maxSupply, priceWei, royaltyBps,
    }).catch((e) => console.error("finalizePublish crashed:", track.id, e?.message || e));
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "duplicate value" });
    console.error("custodial mint failed:", e);
    res.status(500).json({ error: "mint failed", detail: String(e.message || e) });
  }
});

// Retry a flaky async call (Pinata/RPC hiccups) a few times with linear backoff.
async function withRetry(fn, tries = 3, delayMs = 1500) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1))); }
  }
  throw last;
}

// Background finalize for a "publishing" track: pin audio + image + metadata to
// IPFS, submit the on-chain mint, then flip the track to "minting" (the tx
// reconciler below promotes it to "active" once it confirms). Any failure marks
// the track "failed" so the creator can re-publish.
async function finalizePublish(trackId, x) {
  try {
    const audioPin = await withRetry(() => pinFile(x.audioBuf, x.audioName, x.audioType));
    const imagePin = x.imageBuf ? await withRetry(() => pinFile(x.imageBuf, x.imageName, x.imageType)) : null;

    const meta = buildMetadata({
      title: x.title, description: x.description || undefined, image: imagePin?.uri || undefined,
      audio: audioPin.uri, genre: x.genre, artist: x.metaArtist,
      attributes: [{ trait_type: "Editions", value: x.maxSupply }],
    });
    const metaPin = await withRetry(() => pinJSON(meta, `${x.title}.json`));
    const metadataUri = metaPin.uri || metaPin.url;
    if (!metadataUri) throw new Error("metadata pin failed");

    const sub = await withRetry(async () => {
      const s = await submitMint({ maxSupply: x.maxSupply, priceWei: x.priceWei, royaltyBps: x.royaltyBps, metadataUri });
      if (!s.ok) throw new Error("submit failed: " + (s.reason || "unknown"));
      return s;
    });

    // NOTE: keep audioUrl/coverUrl pointing at our DB-backed media route (fast,
    // reliable, same-origin). IPFS is only recorded for the on-chain metadata.
    await prisma.track.update({
      where: { id: trackId },
      data: {
        audioCid: audioPin.cid || null,
        metadataUri, txHash: sub.hash, mintTx: sub.hash, mintStatus: "minting",
      },
    });
    console.log("publish submitted on-chain:", trackId, sub.hash);
  } catch (e) {
    console.error("finalizePublish failed for", trackId, e?.message || e);
    await prisma.track.update({ where: { id: trackId }, data: { mintStatus: "failed" } }).catch(() => {});
  }
}

// Background reconciler: finalizes "minting" tracks once their tx confirms —
// sets the real chainTokenId (from the TrackMinted event) and flips to active,
// or marks failed if the tx reverted. Runs every 12s.
let mintTimer = null;
export function startMintReconciler() {
  if (mintTimer) return;
  const tick = async () => {
    try {
      const pending = await prisma.track.findMany({
        where: { mintStatus: "minting", mintTx: { not: null } },
        take: 20, orderBy: { createdAt: "asc" },
      });
      for (const t of pending) {
        const r = await mintResult(t.mintTx);
        if (r.status === "success") {
          await prisma.track.update({ where: { id: t.id }, data: { chainTokenId: r.tokenId, mintStatus: "active" } })
            .catch((e) => console.error("mint finalize failed:", t.id, "token", r.tokenId, e.message));
        } else if (r.status === "reverted") {
          await prisma.track.update({ where: { id: t.id }, data: { mintStatus: "failed" } }).catch(() => {});
          console.error("mint reverted for track", t.id, "tx", t.mintTx);
        } // pending: leave for the next tick
      }

      // crash safety: a "publishing" track that never reached submit (process died
      // mid-job, so its buffers are gone) can't self-heal — fail it after 15 min so
      // it stops hanging and the creator can re-publish.
      const stuck = await prisma.track.updateMany({
        where: { mintStatus: "publishing", mintTx: null, createdAt: { lt: new Date(Date.now() - 15 * 60e3) } },
        data: { mintStatus: "failed" },
      });
      if (stuck.count) console.warn("marked", stuck.count, "stuck 'publishing' track(s) as failed");
    } catch (e) {
      console.error("mint reconciler tick failed:", e.message);
    }
  };
  mintTimer = setInterval(tick, 12_000);
  mintTimer.unref?.();
}

export default r;
