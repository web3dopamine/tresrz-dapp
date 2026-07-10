// Bulk-import the Bitcoin Billionaire Ballers collection into TRESRZ as a CATALOG
// (referencing the existing IPFS media — no re-storage, no on-chain mint).
//
//   node import-collection.mjs <START> <END> [CONCURRENCY]
//
// Idempotent/resumable: skips items already imported (by metadataUri). Run a small
// range first to sanity-check, then the full 1..9000.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ARTIST_ID = process.env.IMPORT_ARTIST_ID; // NURI
const BASE = "https://1st-nft.bitcoinbillionaireballers.com/ipfs/bafybeidyxeopr2htcmujzi4v2ljvsuhjs5e3grv4djubl6zqmblywyecna";
const GW = "https://1st-nft.bitcoinbillionaireballers.com/ipfs"; // media gateway root

// USD price per Rarity tier. Tier names match the collection's actual "Rarity"
// trait values. Unknown/missing -> DEFAULT_USD (and logged so we can catch it).
const PRICE_USD = {
  "COMMON": 15,
  "UNCOMMON": 25,
  "RARE": 75,
  "ULTRA RARE": 200,
  "EPIC": 300,
  "LEGENDARY": 500,
  "MYTHIC": 750,
  "1 OF 1": 1000,
};
const DEFAULT_USD = 15;
const unmapped = new Map(); // rarity -> count, for any tier not in PRICE_USD

const START = Number(process.argv[2] || 1);
const END = Number(process.argv[3] || 9000);
const CONCURRENCY = Number(process.argv[4] || 5);

async function fetchJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  return null;
}

function attr(list, t) {
  const a = (list || []).find((x) => x.trait_type === t);
  return a ? a.value : null;
}

async function usdPerEth() {
  const r = await fetchJSON("http://localhost:31338/api/rate");
  return r?.usdPerEth || 3000; // fallback
}

function usdToWei(usd, rate) {
  return BigInt(Math.round((usd / rate) * 1e18)).toString();
}

async function main() {
  if (!ARTIST_ID) throw new Error("set IMPORT_ARTIST_ID");
  const rate = await usdPerEth();
  console.log(`rate=${rate} USD/ETH, range ${START}..${END}, concurrency ${CONCURRENCY}`);

  // preload already-imported metadataUris for resumability
  const existing = new Set(
    (await prisma.track.findMany({ where: { artistId: ARTIST_ID }, select: { metadataUri: true } }))
      .map((t) => t.metadataUri).filter(Boolean),
  );
  console.log(`already imported: ${existing.size}`);

  let done = 0, skipped = 0, failed = 0, created = 0;
  const ids = [];
  for (let n = START; n <= END; n++) ids.push(n);

  // simple concurrency pool
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const n = ids[idx++];
      const metaUri = `${BASE}/${n}.json`;
      if (existing.has(metaUri)) { skipped++; continue; }
      const d = await fetchJSON(metaUri);
      if (!d) { failed++; console.error("FETCH FAIL", n); continue; }
      try {
        const rarity = String(attr(d.attributes, "Rarity") || "").toUpperCase();
        const genre = String(attr(d.attributes, "Genre") || attr(d.attributes, "Category") || "MUSIC").toUpperCase();
        const usd = PRICE_USD[rarity] ?? DEFAULT_USD;
        if (rarity && !(rarity in PRICE_USD)) unmapped.set(rarity, (unmapped.get(rarity) || 0) + 1);
        const anim = d.animation_url || null;   // ~20MB mp4, kept on their gateway
        const image = d.image || null;
        await prisma.track.create({
          data: {
            title: String(d.name || `#${n}`).slice(0, 120),
            genre: genre.slice(0, 40),
            coverSeed: (n * 2654435761) % 9973,
            audioUrl: anim,               // reference (not stored) — plays the mp4 audio
            coverUrl: image,
            externalUrl: anim,
            metadataUri: metaUri,
            attributes: d.attributes ?? undefined,
            mime: "video/mp4",
            priceWei: usdToWei(usd, rate),
            maxSupply: 1,
            chainTokenId: null,
            mintStatus: "active",         // shows + plays; buy gated until on-chain
            custodial: true,
            artistId: ARTIST_ID,
          },
        });
        created++; ids._lastId = n;
      } catch (e) {
        if (e?.code === "P2002") { skipped++; }
        else { failed++; console.error("CREATE FAIL", n, e.message); }
      }
      done++;
      if (done % 100 === 0) console.log(`progress: ${done}/${ids.length} (created ${created}, skipped ${skipped}, failed ${failed})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`DONE. created=${created} skipped=${skipped} failed=${failed} total=${done}`);
  if (unmapped.size) console.log("UNMAPPED RARITIES (priced at default, review):", JSON.stringify([...unmapped.entries()]));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
