// On-chain mint of imported catalog tracks (chainTokenId == null) for a creator.
// Supports BOTH modes:
//   - batch  (default): batchMintTracks — ~BATCH_SIZE tracks per tx, ~33% cheaper/item, ~100x fewer txs
//   - single           : mintTrack — one track per tx (granular; matches the per-user publish flow)
// Funds-aware + resumable (only touches not-yet-minted tracks).
//
//   node mint-collection.mjs <ARTIST_ID> [MAX] [BATCH_SIZE] [MODE=batch|single]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { submitMint, mintResult, submitBatchMint, batchMintResult, publicClient, deliveryAddress } from "./src/chain.js";

const prisma = new PrismaClient();
const ARTIST_ID = process.argv[2];
const MAX = Number(process.argv[3] || 100000);
const BATCH_SIZE = Number(process.argv[4] || 100);
const MODE = (process.argv[5] || "batch").toLowerCase(); // "batch" | "single"
const ROYALTY_BPS = Number(process.env.IMPORT_ROYALTY_BPS || 500);
const GAS_BUFFER_ETH = 0.002;

const toIpfsUri = (u) => { const m = /\/ipfs\/(.+)$/.exec(u || ""); return m ? `ipfs://${m[1]}` : u; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, tries = 40) {
  for (let i = 0; i < tries; i++) { const r = await fn(); if (r.status !== "pending") return r; await sleep(4000); }
  return { status: "pending" };
}

async function main() {
  if (!ARTIST_ID) throw new Error("usage: node mint-collection.mjs <ARTIST_ID> [MAX] [BATCH_SIZE] [MODE=batch|single]");
  if (MODE !== "batch" && MODE !== "single") throw new Error(`MODE must be 'batch' or 'single' (got '${MODE}')`);
  const pending = await prisma.track.findMany({
    where: { artistId: ARTIST_ID, chainTokenId: null, mintTx: null },
    orderBy: { createdAt: "asc" }, take: MAX,
    select: { id: true, title: true, priceWei: true, maxSupply: true, metadataUri: true },
  });

  const gasPrice = await publicClient.getGasPrice();
  const COST_PER_ITEM = (MODE === "batch" ? 130000n : 195000n) * gasPrice; // batch ~125k, single ~188k /item
  let budgetWei = await publicClient.getBalance({ address: deliveryAddress });
  const bufferWei = BigInt(Math.round(GAS_BUFFER_ETH * 1e18));
  const step = MODE === "batch" ? BATCH_SIZE : 1;
  console.log(`MODE=${MODE} | to mint: ${pending.length} | wallet ${(Number(budgetWei) / 1e18).toFixed(4)} ETH -> affords ~${Number(budgetWei / COST_PER_ITEM)} items`);

  let minted = 0, groups = 0, stopped = false;
  for (let i = 0; i < pending.length; i += step) {
    const chunk = pending.slice(i, i + step);
    const cost = COST_PER_ITEM * BigInt(chunk.length);
    if (budgetWei < cost + bufferWei) {
      stopped = true;
      console.log(`STOP for funds after ${minted} mints (~${(Number(budgetWei) / 1e18).toFixed(4)} ETH left). Fund the wallet and re-run to continue.`);
      break;
    }
    const items = chunk.map((t) => ({ maxSupply: t.maxSupply || 1, priceWei: t.priceWei || "0", royaltyBps: ROYALTY_BPS, metadataUri: toIpfsUri(t.metadataUri) }));

    let hash, tokenIds;
    if (MODE === "batch") {
      const sub = await submitBatchMint(items);
      if (!sub.ok) { if (/insufficient funds|exceeds the balance/i.test(sub.reason)) { stopped = true; break; } console.error("batch submit fail:", sub.reason); continue; }
      const res = await waitFor(() => batchMintResult(sub.hash));
      if (res.status !== "success" || res.tokenIds.length !== chunk.length) { console.error(`batch ${res.status}; leaving for retry`); continue; }
      hash = sub.hash; tokenIds = res.tokenIds;
    } else {
      const sub = await submitMint(items[0]);
      if (!sub.ok) { if (/insufficient funds|exceeds the balance/i.test(sub.reason)) { stopped = true; break; } console.error("single submit fail:", sub.reason); continue; }
      const res = await waitFor(() => mintResult(sub.hash));
      if (res.status !== "success" || res.tokenId == null) { console.error(`single ${res.status}; leaving for retry`); continue; }
      hash = sub.hash; tokenIds = [res.tokenId];
    }

    await prisma.$transaction(chunk.map((t, k) =>
      prisma.track.update({ where: { id: t.id }, data: { chainTokenId: tokenIds[k], mintTx: hash, txHash: hash, mintStatus: "active" } })));
    budgetWei -= cost; minted += chunk.length; groups++;
    if (MODE === "batch" || minted % 10 === 0)
      console.log(`${MODE} ${groups}: +${chunk.length} (tokens ${tokenIds[0]}..${tokenIds[tokenIds.length - 1]}) | total ${minted}/${pending.length} | tx ${hash.slice(0, 12)}…`);
  }
  const bal = await publicClient.getBalance({ address: deliveryAddress });
  console.log(`DONE (${MODE}). minted=${minted} in ${groups} ${MODE === "batch" ? "batches" : "txs"} | stoppedForFunds=${stopped} | walletLeft=${(Number(bal) / 1e18).toFixed(4)} ETH`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
