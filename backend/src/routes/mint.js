import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { prisma } from "../db.js";
import { pinFile, pinJSON, buildMetadata } from "../ipfs.js";
import { platformMint, deliveryConfigured } from "../chain.js";

// Custodial (wallet-less) minting. The creator fills the form and provides an
// email; the PLATFORM wallet mints the track on-chain and holds the earnings.
// The creator manages the track and withdraws earnings later with a bearer
// "manage token" issued here (shown once, hashed at rest).
const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Global daily ceiling on platform-funded mints (gas-drain backstop; the
// per-IP hourly cap lives in index.js). Tune via env for launch.
const DAILY_CAP = Number(process.env.CUSTODIAL_DAILY_CAP || 200);

export const custodialEnabled = () => deliveryConfigured;

r.get("/status", (_req, res) => res.json({ enabled: custodialEnabled() }));

// POST /api/mint/custodial  (multipart)
// fields: title, genre, description?, maxSupply, priceEth, royaltyPct, coverSeed?, email, handle?
// files:  audio (required), image (optional)
r.post("/custodial", upload.fields([{ name: "audio", maxCount: 1 }, { name: "image", maxCount: 1 }]), async (req, res) => {
  if (!custodialEnabled()) return res.status(503).json({ error: "custodial minting not configured" });
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    const genre = String(b.genre || "").trim().toUpperCase();
    const email = String(b.email || "").trim().toLowerCase();
    const handle = String(b.handle || "").trim() || null;
    const description = String(b.description || "").trim();
    const maxSupply = Math.floor(Number(b.maxSupply));
    const priceEth = Number(b.priceEth);
    const royaltyPct = Number(b.royaltyPct);
    const coverSeed = Number(b.coverSeed) || Math.floor(Math.random() * 9999);

    // ---- validation ----
    if (!title || title.length > 120) return res.status(400).json({ error: "title required (<=120 chars)" });
    if (!genre) return res.status(400).json({ error: "genre required" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
    if (!Number.isInteger(maxSupply) || maxSupply < 1 || maxSupply > 100000) return res.status(400).json({ error: "maxSupply must be 1..100000" });
    if (!Number.isFinite(priceEth) || priceEth < 0) return res.status(400).json({ error: "price must be >= 0" });
    if (!Number.isFinite(royaltyPct) || royaltyPct < 0 || royaltyPct > 10) return res.status(400).json({ error: "royalty must be 0..10%" });
    const audio = req.files?.audio?.[0];
    if (!audio) return res.status(400).json({ error: "audio file required" });
    if (!AUDIO_MIMES.includes(audio.mimetype)) return res.status(415).json({ error: `unsupported audio type ${audio.mimetype}` });
    const image = req.files?.image?.[0];
    if (image && !IMAGE_MIMES.includes(image.mimetype)) return res.status(415).json({ error: `unsupported image type ${image.mimetype}` });

    const priceWei = BigInt(Math.round(priceEth * 1e18)).toString();
    const royaltyBps = Math.round(royaltyPct * 100);

    // global daily cap (gas-drain backstop)
    const since = new Date(Date.now() - 86400e3);
    if ((await prisma.track.count({ where: { custodial: true, createdAt: { gte: since } } })) >= DAILY_CAP) {
      return res.status(429).json({ error: "daily minting limit reached, please try again tomorrow" });
    }

    // Returning creator? They may pass their existing manage token to attach
    // this track to the SAME account (one balance/dashboard). The token — not
    // the unverified email — is the identity, so nobody can take over an
    // account by re-minting with someone else's email.
    let existingCreator = null;
    const providedToken = String(b.manageToken || "");
    if (providedToken) {
      const dot = providedToken.indexOf(".");
      if (dot > 0) {
        const cand = await prisma.user.findUnique({ where: { id: providedToken.slice(0, dot) } });
        if (cand?.custodial && cand.manageTokenHash === sha(providedToken.slice(dot + 1))) existingCreator = cand;
      }
      if (!existingCreator) return res.status(401).json({ error: "invalid manage token" });
    }

    // ---- 1) pin audio + optional image to IPFS ----
    const audioPin = await pinFile(audio.buffer, audio.originalname, audio.mimetype);
    const imagePin = image ? await pinFile(image.buffer, image.originalname, image.mimetype) : null;

    // ---- 2) pin ERC-721 metadata ----
    const meta = buildMetadata({
      title, description: description || undefined, image: imagePin?.uri || undefined,
      audio: audioPin.uri, genre, artist: handle || email,
      attributes: [{ trait_type: "Editions", value: maxSupply }],
    });
    const metaPin = await pinJSON(meta, `${title}.json`);
    const metadataUri = metaPin.uri || metaPin.url;
    if (!metadataUri) return res.status(502).json({ error: "metadata pin failed" });

    // ---- 3) resolve the custodial creator account BEFORE the irreversible mint,
    // so the only post-mint DB write is the Track insert (smallest failure surface).
    // - returning creator (valid token): reuse it, never touch the hash
    // - new creator: create a fresh account + token (token = identity, not email)
    let creator, manageToken;
    if (existingCreator) {
      creator = existingCreator;
      manageToken = providedToken;
      if (!creator.handle && handle) {
        const free = !(await prisma.user.findUnique({ where: { handle } }));
        if (free) { await prisma.user.update({ where: { id: creator.id }, data: { handle } }); }
      }
    } else {
      const rawToken = crypto.randomBytes(24).toString("base64url");
      const handleFree = handle ? !(await prisma.user.findUnique({ where: { handle } })) : false;
      creator = await prisma.user.create({
        data: { email: email || null, handle: handleFree ? handle : null, custodial: true, avatarSeed: Math.floor(Math.random() * 9999), manageTokenHash: sha(rawToken) },
      });
      manageToken = `${creator.id}.${rawToken}`;
    }

    // ---- 4) platform-mint on-chain (irreversible) ----
    const mint = await platformMint({ maxSupply, priceWei, royaltyBps, metadataUri });
    if (!mint.ok) return res.status(502).json({ error: "on-chain mint failed", reason: mint.reason });

    // ---- 5) persist the track. If this fails the NFT exists on-chain but has no
    // Track row — log the recovery keys loudly and retry once before giving up. ----
    let track;
    const trackData = {
      title: title.slice(0, 120), genre: genre.slice(0, 40), maxSupply, priceWei,
      coverSeed, audioUrl: audioPin.url || null, audioCid: audioPin.cid || null,
      coverUrl: imagePin?.url || null, metadataUri, mime: audio.mimetype,
      chainTokenId: mint.trackId, txHash: mint.txHash, custodial: true, artistId: creator.id,
    };
    for (let attempt = 1; attempt <= 2 && !track; attempt++) {
      try {
        track = await prisma.track.create({ data: trackData, include: { artist: true, _count: { select: { likes: true } } } });
      } catch (e) {
        if (attempt === 2) {
          console.error(`RECOVERY NEEDED: minted on-chain but Track insert failed. tokenId=${mint.trackId} tx=${mint.txHash} creator=${creator.id} metadataUri=${metadataUri} err=${e.message}`);
          return res.status(500).json({ error: "minted on-chain but saving failed — support can recover it", chainTokenId: mint.trackId, txHash: mint.txHash });
        }
      }
    }

    res.status(201).json({
      trackId: track.id, chainTokenId: mint.trackId, txHash: mint.txHash,
      manageToken, creatorId: creator.id,
    });
  } catch (e) {
    if (e?.code === "P2002") return res.status(409).json({ error: "duplicate (handle or token already exists)" });
    console.error("custodial mint failed:", e);
    res.status(500).json({ error: "mint failed", detail: String(e.message || e) });
  }
});

export default r;
