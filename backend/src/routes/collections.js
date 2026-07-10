import { Router } from "express";
import { prisma } from "../db.js";

// Collections = creators, presented OpenSea-style. Name comes from the dominant
// "Project" trait when present (imported collections), else the creator handle.
const r = Router();

const handleOf = (u) => u.handle || (u.email ? u.email.split("@")[0] : (u.address ? u.address.slice(0, 6) + "…" : "Creator"));

r.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 12, 30);
  const users = await prisma.user.findMany({
    where: { flagged: false, tracks: { some: { flagged: false } } },
    include: { _count: { select: { tracks: true } } },
    orderBy: { tracks: { _count: "desc" } },
    take: limit,
  });
  const out = [];
  for (const u of users) {
    let name = handleOf(u);
    try {
      const proj = await prisma.$queryRawUnsafe(
        `SELECT elem->>'value' AS val FROM "Track", jsonb_array_elements(attributes) elem
         WHERE "artistId"=$1 AND attributes IS NOT NULL AND elem->>'trait_type'='Project' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`, u.id);
      if (proj[0]?.val) name = proj[0].val;
    } catch {}
    let floorWei = null;
    try {
      const f = await prisma.$queryRawUnsafe(
        `SELECT MIN(CAST("priceWei" AS NUMERIC))::text AS floor FROM "Track"
         WHERE "artistId"=$1 AND flagged=false AND "mintStatus" IN ('active','minting','publishing')`, u.id);
      floorWei = f[0]?.floor || null;
    } catch {}
    const covers = await prisma.track.findMany({
      where: { artistId: u.id, flagged: false, mintStatus: { in: ["active", "minting", "publishing"] } },
      select: { coverSeed: true, coverUrl: true }, take: 4, orderBy: { createdAt: "desc" },
    });
    out.push({
      id: u.id, name, handle: handleOf(u), address: u.address || u.id, avatarSeed: u.avatarSeed,
      itemCount: u._count.tracks, floorWei, covers,
    });
  }
  res.json(out);
});

export default r;
