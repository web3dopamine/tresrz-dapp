import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { pinFile, pinJSON, buildMetadata, ipfsConfigured } from "../ipfs.js";

const r = Router();

// In-memory storage; files are streamed straight to IPFS/disk, capped at 50 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4"];
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// POST /api/upload/audio  (multipart 'file') -> pins the full track to IPFS.
// Returns { cid, uri, url, mime }. The CID is the gated full track; the API
// only reveals its gateway URL to verified holders via /api/stream.
r.post("/audio", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  if (!AUDIO_MIMES.includes(req.file.mimetype)) {
    return res.status(415).json({ error: `unsupported audio type ${req.file.mimetype}` });
  }
  try {
    const pin = await pinFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.status(201).json({ ...pin, mime: req.file.mimetype, ipfs: ipfsConfigured });
  } catch (e) {
    res.status(502).json({ error: "pin failed", detail: String(e.message || e) });
  }
});

// POST /api/upload/image  (multipart 'file') -> pins cover art to IPFS.
r.post("/image", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  if (!IMAGE_MIMES.includes(req.file.mimetype)) {
    return res.status(415).json({ error: `unsupported image type ${req.file.mimetype}` });
  }
  try {
    const pin = await pinFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.status(201).json({ ...pin, mime: req.file.mimetype });
  } catch (e) {
    res.status(502).json({ error: "pin failed", detail: String(e.message || e) });
  }
});

// POST /api/upload/metadata  { title, description, image, audio, genre, attributes }
// Builds ERC-721/1155-compliant metadata JSON and pins it. Returns { cid, uri, url }.
r.post("/metadata", requireAuth, async (req, res) => {
  const { title, description, image, audio, genre, attributes } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const meta = buildMetadata({
      title: String(title).slice(0, 120),
      description: description ? String(description).slice(0, 1000) : undefined,
      image,
      audio,
      genre,
      artist: req.user.address,
      attributes: Array.isArray(attributes) ? attributes : [],
    });
    const pin = await pinJSON(meta, `${title}.json`);
    res.status(201).json({ ...pin, metadata: meta });
  } catch (e) {
    res.status(502).json({ error: "pin failed", detail: String(e.message || e) });
  }
});

export default r;
