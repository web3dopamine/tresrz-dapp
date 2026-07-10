// BATCH on-chain mint of imported catalog tracks (chainTokenId == null) for a
// creator. Submits ~BATCH_SIZE tracks per tx (batchMintTracks), waits for the
// receipt, and assigns the contiguous tokenIds in order — then marks each track
// "active". Funds-aware + resumable (only touches not-yet-minted tracks).
//
//   node mint-collection.mjs <ARTIST_ID> [MAX] [BATCH_SIZE]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { submitBatchMint, batchMintResult, publicClient, deliveryAddress } from "./src/chain.js";

const prisma = new PrismaClient();
const ARTIST_ID = process.argv[2];
const MAX = Number(process.argv[3] || 100000);
const BATCH_SIZE = Number(process.argv[4] || 100);
const ROYALTY_BPS = Number(process.env.IMPORT_ROYALTY_BPS || 500);
const GAS_BUFFER_ETH = 0.002;

const toIpfsUri = (u) => { const m = /\/ipfs\/(.+)$/.exec(u || ""); return m ? `ipfs://${m[1]}` : u; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitBatch(hash, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await batchMintResult(hash);
    if (r.status !== "pending") return r;
    await sleep(4000);
  }
  return { status: "pending" };
}

async function main() {
  if (!ARTIST_ID) throw new Error("usage: node mint-collection.mjs <ARTIST_ID> [MAX] [BATCH_SIZE]");
  const pending = await prisma.track.findMany({
    where: { artistId: ARTIST_ID, chainTokenId: null, mintTx: null },
    orderBy: { createdAt: "asc" }, take: MAX,
    select: { id: true, title: true, priceWei: true, maxSupply: true, metadataUri: true },
  });

  const gasPrice = await publicClient.getGasPrice();
  const COST_PER_ITEM = 130000n * gasPrice; // ~125k gas/item in a batch + margin
  let budgetWei = await publicClient.getBalance({ address: deliveryAddress });
  const bufferWei = BigInt(Math.round(GAS_BUFFER_ETH * 1e18));
  console.log(`to mint: ${pending.length} | batch ${BATCH_SIZE} | wallet ${(Number(budgetWei) / 1e18).toFixed(4)} ETH -> affords ~${Number(budgetWei / COST_PER_ITEM)} items`);

  let minted = 0, batches = 0, stopped = false;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const cost = COST_PER_ITEM * BigInt(chunk.length);
    if (budgetWei < cost + bufferWei) {
      stopped = true;
      console.log(`STOP for funds after ${minted} mints (~${(Number(budgetWei) / 1e18).toFixed(4)} ETH left). Fund the wallet and re-run to continue.`);
      break;
    }
    const items = chunk.map((t) => ({ maxSupply: t.maxSupply || 1, priceWei: t.priceWei || "0", royaltyBps: ROYALTY_BPS, metadataUri: toIpfsUri(t.metadataUri) }));
    const sub = await submitBatchMint(items);
    if (!sub.ok) {
      console.error(`batch ${batches} submit fail:`, sub.reason);
      if (/insufficient funds|exceeds the balance/i.test(sub.reason)) { stopped = true; break; }
      continue;
    }
    const res = await waitBatch(sub.hash);
    if (res.status !== "success" || res.tokenIds.length !== chunk.length) {
      console.error(`batch ${batches} ${res.status}, tokenIds=${res.tokenIds?.length}; leaving for retry`);
      continue; // tracks stay chainTokenId=null/mintTx=null -> re-minted next run
    }
    // assign contiguous tokenIds in submission order
    await prisma.$transaction(chunk.map((t, k) =>
      prisma.track.update({ where: { id: t.id }, data: { chainTokenId: res.tokenIds[k], mintTx: sub.hash, txHash: sub.hash, mintStatus: "active" } }),
    ));
    budgetWei -= cost;
    minted += chunk.length; batches++;
    console.log(`batch ${batches}: +${chunk.length} (tokens ${res.tokenIds[0]}..${res.tokenIds[res.tokenIds.length - 1]}) | total ${minted}/${pending.length} | tx ${sub.hash.slice(0, 12)}…`);
  }
  const bal = await publicClient.getBalance({ address: deliveryAddress });
  console.log(`DONE. minted=${minted} in ${batches} batches | stoppedForFunds=${stopped} | walletLeft=${(Number(bal) / 1e18).toFixed(4)} ETH`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
