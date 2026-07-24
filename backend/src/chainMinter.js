// Background "drip" minter: takes catalog items that were bulk-imported (or
// otherwise created off-chain) and mints them on-chain SLOWLY, a small batch at
// a time, so a large collection lands on-chain without spiking gas or draining
// the platform wallet. Runs automatically — on by default.
//
// Safety: only mints when gas is below a ceiling AND the wallet holds a minimum
// balance. In-flight rows are tracked purely by `mintTx` (status stays "active",
// so they remain visible and the single-publish reconciler never touches them);
// buying is gated by `chainTokenId == null` until the mint confirms. Restart-safe:
// a pending batch is re-resolved from its tx hash on the next tick.
import { formatEther, parseEther } from "viem";
import { prisma } from "./db.js";
import {
  submitBatchMint, batchMintResult, publicClient, deliveryConfigured, deliveryAddress,
} from "./chain.js";
import { buildMetadata, pinJSON, ipfsConfigured } from "./ipfs.js";

const ENABLED = String(process.env.CHAIN_DRIP_ENABLED ?? "true") !== "false";
const BATCH = Math.max(1, Number(process.env.CHAIN_DRIP_BATCH || 25));
const INTERVAL_MS = Math.max(20_000, Number(process.env.CHAIN_DRIP_INTERVAL_MS || 120_000));
const MAX_GAS_GWEI = Number(process.env.CHAIN_DRIP_MAX_GAS_GWEI || 8);
const MIN_BALANCE_WEI = parseEther(String(process.env.CHAIN_DRIP_MIN_BALANCE_ETH || "0.05"));
const ROYALTY_BPS = Number(process.env.ROYALTY_BPS || 500);

let running = false;   // prevents overlapping ticks (a tick can outlast the interval)
let lowBalanceLogged = false;

// Resolve any batch we've already submitted: match the tx's contiguous tokenIds
// (sorted asc) to the in-flight rows (ordered by id asc — the exact submission
// order), then set chainTokenId + txHash. A revert clears mintTx so the item
// retries on a later tick.
async function resolvePending() {
  const inflight = await prisma.track.findMany({
    where: { chainTokenId: null, custodial: true, mintTx: { not: null }, mintStatus: "active" },
    select: { id: true, mintTx: true }, orderBy: { id: "asc" },
  });
  if (!inflight.length) return;
  const byHash = new Map();
  for (const t of inflight) {
    if (!byHash.has(t.mintTx)) byHash.set(t.mintTx, []);
    byHash.get(t.mintTx).push(t);
  }

  for (const [hash, rows] of byHash) {
    const r = await batchMintResult(hash);
    if (r.status === "pending") continue;                    // not mined yet
    if (r.status === "reverted") {
      await prisma.track.updateMany({ where: { id: { in: rows.map((x) => x.id) } }, data: { mintTx: null } }).catch(() => {});
      console.warn("[drip] batch reverted, will retry:", hash);
      continue;
    }
    // success: zip sorted tokenIds to id-asc rows (contract assigns them in order)
    const ids = r.tokenIds.slice().sort((a, b) => a - b);
    const ordered = rows.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const n = Math.min(ids.length, ordered.length);
    for (let i = 0; i < n; i++) {
      await prisma.track.update({ where: { id: ordered[i].id }, data: { chainTokenId: ids[i], txHash: hash } })
        .catch((e) => console.error("[drip] assign token failed:", ordered[i].id, ids[i], e.message));
    }
    console.log(`[drip] confirmed batch ${hash}: assigned ${n} token id(s)`);
  }
}

// Ensure a row has an on-chain metadata URI. URL-imported items already carry one
// (their source JSON); CSV/other items get metadata built + pinned to IPFS now.
async function ensureMetadataUri(t) {
  if (t.metadataUri) return t.metadataUri;
  if (!ipfsConfigured) return null; // can't mint without a tokenURI and no pinning available
  const meta = buildMetadata({
    title: t.title, image: t.coverUrl || undefined, audio: t.externalUrl || t.audioUrl || undefined,
    genre: t.genre, attributes: Array.isArray(t.attributes) ? t.attributes : [],
  });
  const pin = await pinJSON(meta, `${t.title}.json`).catch(() => null);
  const uri = pin?.uri || pin?.url || null;
  if (uri) await prisma.track.update({ where: { id: t.id }, data: { metadataUri: uri } }).catch(() => {});
  return uri;
}

async function mintNextBatch() {
  const candidates = await prisma.track.findMany({
    where: { chainTokenId: null, custodial: true, mintStatus: "active", mintTx: null },
    take: BATCH, orderBy: { id: "asc" },
  });
  if (!candidates.length) return 0;

  const items = [];
  for (const t of candidates) {
    const metadataUri = await ensureMetadataUri(t);
    if (!metadataUri) continue; // skip un-mintable rows (no URI); they stay catalog-only
    items.push({ id: t.id, maxSupply: t.maxSupply || 1, priceWei: t.priceWei || "0", royaltyBps: ROYALTY_BPS, metadataUri });
  }
  if (!items.length) return 0;

  const sub = await submitBatchMint(items);
  if (!sub.ok) { console.warn("[drip] submit failed:", sub.reason); return 0; }
  await prisma.track.updateMany({ where: { id: { in: items.map((x) => x.id) } }, data: { mintTx: sub.hash } });
  console.log(`[drip] submitted batch of ${items.length} → ${sub.hash}`);
  return items.length;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await resolvePending();

    // gas ceiling — skip minting this round if the network is expensive
    const gas = await publicClient.getGasPrice().catch(() => null);
    if (gas != null && Number(gas) / 1e9 > MAX_GAS_GWEI) {
      console.log(`[drip] gas ${(Number(gas) / 1e9).toFixed(1)} gwei > ${MAX_GAS_GWEI}, waiting`);
      return;
    }
    // wallet floor — never drain below the minimum
    const bal = await publicClient.getBalance({ address: deliveryAddress }).catch(() => null);
    if (bal != null && bal < MIN_BALANCE_WEI) {
      if (!lowBalanceLogged) { console.warn(`[drip] wallet ${formatEther(bal)} ETH below floor ${formatEther(MIN_BALANCE_WEI)} — pausing mints`); lowBalanceLogged = true; }
      return;
    }
    lowBalanceLogged = false;

    await mintNextBatch();
  } catch (e) {
    console.error("[drip] tick failed:", e?.message || e);
  } finally {
    running = false;
  }
}

export function startChainMinter() {
  if (!ENABLED) { console.log("[drip] chain drip minter disabled (CHAIN_DRIP_ENABLED=false)"); return; }
  if (!deliveryConfigured) { console.log("[drip] no platform mint wallet configured — chain drip minter idle"); return; }
  console.log(`[drip] chain drip minter on: batch ${BATCH}, every ${INTERVAL_MS / 1000}s, gas<=${MAX_GAS_GWEI}gwei, floor ${formatEther(MIN_BALANCE_WEI)}ETH`);
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  setTimeout(tick, 8_000); // first pass shortly after boot
}
