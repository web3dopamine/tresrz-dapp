import { Router } from "express";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { MUSIC_CONTRACT, MARKET_CONTRACT, chainConfigured } from "../chain.js";

const r = Router();
r.use(requireAdmin);

// GET /api/admin/stats -> platform totals for the dashboard header.
r.get("/stats", async (_req, res) => {
  const [users, tracks, sales, flaggedTracks, flaggedUsers, featured] = await Promise.all([
    prisma.user.count(),
    prisma.track.count(),
    prisma.sale.count(),
    prisma.track.count({ where: { flagged: true } }),
    prisma.user.count({ where: { flagged: true } }),
    prisma.track.count({ where: { hot: true } }),
  ]);
  const volume = await prisma.sale.aggregate({ _count: true });
  res.json({
    users, tracks, sales, flaggedTracks, flaggedUsers, featured,
    saleCount: volume._count,
    contracts: { music: MUSIC_CONTRACT, market: MARKET_CONTRACT, chainConfigured },
  });
});

// GET /api/admin/tracks -> all tracks incl. flagged (admin view).
r.get("/tracks", async (_req, res) => {
  const tracks = await prisma.track.findMany({
    orderBy: { createdAt: "desc" },
    include: { artist: { select: { address: true, handle: true } }, _count: { select: { likes: true, sales: true } } },
  });
  res.json(tracks);
});

// GET /api/admin/users -> all users (admin view).
r.get("/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { tracks: true, sales: true } } },
  });
  res.json(users);
});

// POST /api/admin/tracks/:id/feature  { featured: bool } -> set the featured (hot) flag.
r.post("/tracks/:id/feature", async (req, res) => {
  const featured = !!req.body?.featured;
  try {
    const t = await prisma.track.update({ where: { id: req.params.id }, data: { hot: featured } });
    res.json({ id: t.id, hot: t.hot });
  } catch {
    res.status(404).json({ error: "track not found" });
  }
});

// POST /api/admin/tracks/:id/flag  { flagged: bool } -> moderate (hide) a track.
r.post("/tracks/:id/flag", async (req, res) => {
  const flagged = !!req.body?.flagged;
  try {
    const t = await prisma.track.update({ where: { id: req.params.id }, data: { flagged } });
    res.json({ id: t.id, flagged: t.flagged });
  } catch {
    res.status(404).json({ error: "track not found" });
  }
});

// POST /api/admin/users/:id/flag  { flagged: bool } -> moderate a user.
r.post("/users/:id/flag", async (req, res) => {
  const flagged = !!req.body?.flagged;
  try {
    const u = await prisma.user.update({ where: { id: req.params.id }, data: { flagged } });
    res.json({ id: u.id, flagged: u.flagged });
  } catch {
    res.status(404).json({ error: "user not found" });
  }
});

export default r;
