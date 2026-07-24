// Sync on-chain TresrzMusic tracks into the DB. Two jobs:
//   1) Free stale chainTokenId slots — DB tracks (e.g. demo seed data) whose
//      chainTokenId points at a token that doesn't exist on this deployment, is a
//      throwaway test mint, or whose metadata doesn't match. These get their
//      chainTokenId nulled so they stay as display-only and stop colliding with
//      real mints (a collision is what makes a fresh mint's persist step 409).
//   2) Backfill real on-chain mints that aren't in the DB yet (e.g. a mint whose
//      persist failed) by reading their pinned ERC-721 metadata.
// Idempotent: re-running only adds what's missing. Run:
//   node -r dotenv/config scripts/sync-chain.mjs
import { createPublicClient, http } from "viem";
import { prisma } from "../src/db.js";

const RPC = process.env.RPC_URL;
const MUSIC = process.env.MUSIC_CONTRACT;
const GATEWAY = (process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud").replace(/\/$/, "");
if (!RPC || !MUSIC) throw new Error("set RPC_URL and MUSIC_CONTRACT");

const abi = [
  { type: "function", name: "nextTrackId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tracks", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "artist", type: "address" }, { name: "price", type: "uint96" }, { name: "maxSupply", type: "uint64" },
    { name: "minted", type: "uint64" }, { name: "metadataUri", type: "string" }, { name: "active", type: "bool" } ] },
];
const pub = createPublicClient({ transport: http(RPC) });
const gw = (uri) => !uri ? null : uri.startsWith("ipfs://") ? `${GATEWAY}/ipfs/${uri.slice(7)}` : uri;
const isTest = (uri) => !uri || uri.includes("e2e") || !uri.startsWith("ipfs://");

const MINTED_EVENT = {
  type: "event", name: "TrackMinted",
  inputs: [
    { name: "trackId", type: "uint256", indexed: true }, { name: "artist", type: "address", indexed: true },
    { name: "maxSupply", type: "uint64", indexed: false }, { name: "price", type: "uint96", indexed: false }, { name: "uri", type: "string", indexed: false },
  ],
};
// Find a token's mint tx + block timestamp by scanning TrackMinted backward in
// 10-block chunks (free-tier eth_getLogs limit). Mints are recent, so this is quick.
async function findMint(tokenId) {
  const cur = Number(await pub.getBlockNumber());
  for (let hi = cur; hi > cur - 8000; hi -= 10) {
    const fromBlock = BigInt(Math.max(hi - 9, 0));
    let logs;
    try { logs = await pub.getLogs({ address: MUSIC, event: MINTED_EVENT, args: { trackId: BigInt(tokenId) }, fromBlock, toBlock: BigInt(hi) }); }
    catch { return null; }
    if (logs.length) {
      const blk = await pub.getBlock({ blockNumber: logs[0].blockNumber });
      return { txHash: logs[0].transactionHash, mintedAt: new Date(Number(blk.timestamp) * 1000) };
    }
  }
  return null;
}

async function main() {
  const next = Number(await pub.readContract({ abi, address: MUSIC, functionName: "nextTrackId" }));
  console.log(`on-chain tracks: 1..${next - 1}`);

  // read all on-chain tracks once
  const chain = {};
  for (let id = 1; id < next; id++) {
    const t = await pub.readContract({ abi, address: MUSIC, functionName: "tracks", args: [BigInt(id)] });
    chain[id] = { artist: t[0], price: t[1], maxSupply: t[2], minted: t[3], uri: t[4], active: t[5] };
  }

  // 1) free stale/colliding chainTokenIds
  let freed = 0;
  const dbWithToken = await prisma.track.findMany({ where: { chainTokenId: { not: null } } });
  for (const tr of dbWithToken) {
    const oc = chain[tr.chainTokenId];
    // A genuinely-synced track's metadataUri exactly matches the on-chain uri.
    // Anything else (null, or different) is a seed/placeholder squatting on the slot.
    const mismatch = !oc || isTest(oc.uri) || tr.metadataUri !== oc.uri;
    if (mismatch) {
      await prisma.track.update({ where: { id: tr.id }, data: { chainTokenId: null } });
      freed++;
      console.log(`  freed chainTokenId ${tr.chainTokenId} from "${tr.title}" (seed/mismatch)`);
    }
  }

  // 2) backfill real on-chain mints missing from the DB
  let added = 0;
  for (let id = 1; id < next; id++) {
    const oc = chain[id];
    if (isTest(oc.uri)) continue;                       // skip throwaway test mints
    const exists = await prisma.track.findUnique({ where: { chainTokenId: id } });
    if (exists) {
      // already synced — backfill the mint date/tx if we never captured it
      if (!exists.txHash) {
        const mint = await findMint(id);
        if (mint) {
          await prisma.track.update({ where: { id: exists.id }, data: { txHash: mint.txHash, createdAt: mint.mintedAt } });
          console.log(`  ~ set mint date for token ${id} "${exists.title}" -> ${mint.mintedAt.toISOString()}`);
        }
      }
      continue;
    }

    let meta = {};
    try { meta = await (await fetch(gw(oc.uri))).json(); } catch { console.log(`  ! token ${id}: metadata fetch failed, skipping`); continue; }
    const genre = (meta.attributes || []).find((a) => a.trait_type === "Genre")?.value || "UNKNOWN";
    const artist = await prisma.user.upsert({
      where: { address: oc.artist },
      update: {},
      create: { address: oc.artist, avatarSeed: Math.floor(Math.random() * 9999) },
    });
    const mint = await findMint(id);                    // real mint date + tx from chain
    const track = await prisma.track.create({
      data: {
        chainTokenId: id,
        title: meta.name || `Track #${id}`,
        genre: String(genre).toUpperCase(),
        coverSeed: Math.floor(Math.random() * 999),
        audioUrl: gw(meta.animation_url),
        audioCid: meta.animation_url?.startsWith("ipfs://") ? meta.animation_url.slice(7) : null,
        coverUrl: gw(meta.image),
        metadataUri: oc.uri,
        priceWei: oc.price.toString(),
        maxSupply: Number(oc.maxSupply),
        minted: Number(oc.minted),
        artistId: artist.id,
        txHash: mint?.txHash || null,
        ...(mint ? { createdAt: mint.mintedAt } : {}),
      },
    });
    added++;
    console.log(`  + backfilled token ${id} "${track.title}" (${genre}) artist ${oc.artist}`);
  }

  console.log(`\nDone. Freed ${freed} stale slot(s), backfilled ${added} on-chain track(s).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
