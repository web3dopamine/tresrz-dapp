// Cut the database over to the newly-minted contract: swap every chainTokenId to
// its new id and set the per-rarity price. Runs only when the re-mint mapped the
// FULL catalogue, and does the id swap in two passes because chainTokenId is
// unique (old and new id ranges overlap, so a direct update would collide).
import "dotenv/config";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const map = JSON.parse(fs.readFileSync("./remint-progress.json", "utf8"));
const { music, market } = JSON.parse(fs.readFileSync("./deploy-v2.json", "utf8"));

const PRICE_ETH = {
  "COMMON": "0.01", "RARE": "0.25", "SUPER RARE": "0.5",
  "ULTRA RARE": "1.25", "ONE OF A KIND": "6.25", "LEGENDARY": "31.25",
};
const toWei = (eth) => (BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n).toString();

const tracks = await prisma.track.findMany({ select: { id: true, rarity: true } });
const missing = tracks.filter((t) => !map[t.id]);
if (missing.length) {
  console.error(`ABORT: ${missing.length} track(s) have no new token id — re-mint is incomplete.`);
  process.exit(1);
}
console.log(`all ${tracks.length} tracks mapped. cutting over…`);

// pass 1 — clear ids so the unique index can't collide
await prisma.$executeRawUnsafe(`UPDATE "Track" SET "chainTokenId" = NULL`);
console.log("cleared old token ids");

// pass 2 — assign new ids + tier prices in chunks
const CHUNK = 500;
let done = 0;
for (let i = 0; i < tracks.length; i += CHUNK) {
  const part = tracks.slice(i, i + CHUNK);
  const values = part.map((t) => {
    const wei = toWei(PRICE_ETH[String(t.rarity || "").toUpperCase()] ?? "0.01");
    return `('${t.id}', ${map[t.id]}, '${wei}')`;
  }).join(",");
  await prisma.$executeRawUnsafe(
    `UPDATE "Track" AS t SET "chainTokenId" = v.tok, "priceWei" = v.price
     FROM (VALUES ${values}) AS v(id, tok, price)
     WHERE t.id = v.id`
  );
  done += part.length;
  if (done % 2000 === 0 || done === tracks.length) console.log(`  ${done}/${tracks.length}`);
}

// verify
const nulls = await prisma.track.count({ where: { chainTokenId: null } });
const byRarity = await prisma.track.groupBy({ by: ["rarity"], _count: { rarity: true } });
console.log("\nunmapped after cutover:", nulls);
for (const r of byRarity) {
  const t = await prisma.track.findFirst({ where: { rarity: r.rarity }, select: { priceWei: true, chainTokenId: true } });
  console.log(`  ${String(r.rarity).padEnd(15)} ${String(r._count.rarity).padStart(5)}  ${(Number(BigInt(t.priceWei)) / 1e18).toFixed(4)} ETH  (eg token #${t.chainTokenId})`);
}
console.log("\nNEW MUSIC_CONTRACT =", music);
console.log("NEW MARKET_CONTRACT =", market);
await prisma.$disconnect();
