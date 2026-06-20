import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { balanceOf, chainConfigured } from "../chain.js";
import { gatewayUrl } from "../ipfs.js";

const r = Router();

// GET /api/stream/:id/preview   (public)
// Returns the public preview URL for a track. The frontend player limits
// non-holder playback to a short preview window; the full track is never
// exposed here.
r.get("/:id/preview", optionalAuth, async (req, res) => {
  const t = await prisma.track.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: "not found" });
  res.json({ trackId: t.id, previewUrl: t.audioUrl || null });
});

// GET /api/stream/:id/full   (auth)
// Token-gated: only returns the full-track gateway URL if the authenticated
// wallet holds >= 1 edition of the track on-chain. Falls back to allowing the
// artist (so creators can always play their own work).
r.get("/:id/full", requireAuth, async (req, res) => {
  const t = await prisma.track.findUnique({ where: { id: req.params.id }, include: { artist: true } });
  if (!t) return res.status(404).json({ error: "not found" });

  const isArtist = t.artist?.address?.toLowerCase() === String(req.user.address).toLowerCase();

  if (!isArtist) {
    if (t.chainTokenId == null) return res.status(409).json({ error: "track not on-chain; gating unavailable" });
    if (!chainConfigured) return res.status(503).json({ error: "chain not configured for gating" });
    const bal = await balanceOf(req.user.address, t.chainTokenId);
    if (bal <= 0n) {
      return res.status(403).json({ error: "hold an edition to stream the full track", gated: true });
    }
  }

  // Holder (or artist) verified — reveal the full-track source.
  const fullUrl = t.audioCid ? gatewayUrl(t.audioCid) : t.audioUrl;
  if (!fullUrl) return res.status(404).json({ error: "no full audio for this track" });
  res.json({ trackId: t.id, fullUrl, mime: t.mime || null, viaArtist: isArtist });
});

export default r;
