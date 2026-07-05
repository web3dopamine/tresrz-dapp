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

    // ---- 1) pin audio + optional image to IPFS ----
    const audioPin = await pinFile(audio.buffer, audio.originalname, audio.mimetype);
    const imagePin = image ? await pinFile(image.buffer, image.originalname, image.mimetype) : null;

    // ---- 2) pin ERC-721 metadata ----
    const meta = buildMetadata({
      title, description: description || undefined, image: imagePin?.uri || undefined,
      audio: audioPin.uri, genre, artist: handle || "TRESRZ",
      attributes: [{ trait_type: "Editions", value: maxSupply }],
    });
    const metaPin = await pinJSON(meta, `${title}.json`);
    const metadataUri = metaPin.uri || metaPin.url;
    if (!metadataUri) return res.status(502).json({ error: "metadata pin failed" });

    // ---- 3) the artist is the LOGGED-IN user (attribution/display). The platform
    // wallet is the on-chain artist, so ALL crypto proceeds go to it. If the user
    // gave an artist name and doesn't have one yet, adopt it (when free).
    const creator = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!creator) return res.status(401).json({ error: "account not found" });
    if (handle && !creator.handle) {
      const free = !(await prisma.user.findUnique({ where: { handle } }));
      if (free) await prisma.user.update({ where: { id: creator.id }, data: { handle } });
    }

    // ---- 4) SUBMIT the on-chain mint without waiting (returns a tx hash fast) ----
    const sub = await submitMint({ maxSupply, priceWei, royaltyBps, metadataUri });
    if (!sub.ok) return res.status(502).json({ error: "could not submit on-chain mint", reason: sub.reason });

    // ---- 5) persist the track in a "minting" state; the reconciler fills in the
    // tokenId once the tx confirms (usually ~15-30s). The request returns now. ----
    const track = await prisma.track.create({
      data: {
        title: title.slice(0, 120), genre: genre.slice(0, 40), maxSupply, priceWei,
        coverSeed, audioUrl: audioPin.url || null, audioCid: audioPin.cid || null,
        coverUrl: imagePin?.url || null, metadataUri, mime: audio.mimetype,
        chainTokenId: null, txHash: sub.hash, mintTx: sub.hash, mintStatus: "minting",
        custodial: true, artistId: creator.id,
      },
      include: { artist: true, _count: { select: { likes: true } } },
    });

    res.status(201).json({ trackId: track.id, txHash: sub.hash, status: "minting" });
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "duplicate value" });
    console.error("custodial mint failed:", e);
    res.status(500).json({ error: "mint failed", detail: String(e.message || e) });
  }
});

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
    } catch (e) {
      console.error("mint reconciler tick failed:", e.message);
    }
  };
  mintTimer = setInterval(tick, 12_000);
  mintTimer.unref?.();
}

export default r;
