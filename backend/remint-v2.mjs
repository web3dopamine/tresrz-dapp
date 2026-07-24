// Re-mint the whole catalogue onto the NEW TresrzMusic at the correct per-rarity
// prices. Writes a trackId -> newTokenId map to disk as it goes (resumable), and
// does NOT touch the database — the cutover is a separate, fast step so the live
// site is never pointing at half-migrated data.
import "dotenv/config";
import fs from "fs";
import { createWalletClient, createPublicClient, http, defineChain, formatEther, formatGwei, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const { music: MUSIC } = JSON.parse(fs.readFileSync("./deploy-v2.json", "utf8"));
const { music: musicArt } = JSON.parse(fs.readFileSync("./tresrz_artifacts.json", "utf8"));

const PRICE_ETH = {
  "COMMON": "0.01",
  "RARE": "0.25",
  "SUPER RARE": "0.5",
  "ULTRA RARE": "1.25",
  "ONE OF A KIND": "6.25",
  "LEGENDARY": "31.25",
};
const toWei = (eth) => BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n; // exact for these values
const ROYALTY_BPS = 500n;
const BATCH = Number(process.env.REMINT_BATCH || 70);
const MAX_GAS_GWEI = Number(process.env.REMINT_MAX_GAS_GWEI || 6);
const MIN_BALANCE = 10n ** 17n; // 0.1 ETH floor
const PROGRESS = "./remint-progress.json";

const account = privateKeyToAccount(process.env.DELIVERY_PRIVATE_KEY);
const chain = defineChain({
  id: Number(process.env.CHAIN_ID || 11155111), name: "sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(process.env.RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(process.env.RPC_URL) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let map = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, "utf8")) : {};
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(map));

const tracks = await prisma.track.findMany({
  select: { id: true, rarity: true, maxSupply: true, metadataUri: true, title: true },
  orderBy: { id: "asc" },
});
const todo = tracks.filter((t) => !map[t.id]);
console.log(`catalogue ${tracks.length} | already minted ${tracks.length - todo.length} | to mint ${todo.length}`);

// price sanity: every track must resolve to a tier price
const unpriced = todo.filter((t) => !PRICE_ETH[String(t.rarity || "").toUpperCase()]);
if (unpriced.length) {
  console.error("ABORT: tracks with no tier price:", unpriced.length, unpriced.slice(0, 3).map((t) => t.rarity));
  process.exit(1);
}
const noUri = todo.filter((t) => !t.metadataUri);
if (noUri.length) { console.error("ABORT: tracks without metadataUri:", noUri.length); process.exit(1); }

const started = await pub.getBalance({ address: account.address });
console.log("wallet", formatEther(started), "ETH | batch", BATCH, "| gas ceiling", MAX_GAS_GWEI, "gwei");

let minted = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);

  // gas + balance guards
  for (;;) {
    const gas = await pub.getGasPrice();
    const bal = await pub.getBalance({ address: account.address });
    if (bal < MIN_BALANCE) { console.error("ABORT: balance floor reached", formatEther(bal)); save(); process.exit(1); }
    if (Number(formatGwei(gas)) <= MAX_GAS_GWEI) break;
    console.log(`gas ${formatGwei(gas)} gwei > ${MAX_GAS_GWEI}, waiting 60s…`);
    await sleep(60_000);
  }

  const args = [
    slice.map((t) => BigInt(t.maxSupply || 1)),
    slice.map((t) => toWei(PRICE_ETH[String(t.rarity).toUpperCase()])),
    slice.map(() => ROYALTY_BPS),
    slice.map((t) => t.metadataUri),
  ];

  try {
    const hash = await wallet.writeContract({ address: MUSIC, abi: musicArt.abi, functionName: "batchMintTracks", args });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
    if (rc.status !== "success") throw new Error("reverted");
    const evs = parseEventLogs({ abi: musicArt.abi, eventName: "TrackMinted", logs: rc.logs });
    const ids = evs.map((e) => Number(e.args.trackId)).sort((a, b) => a - b);
    if (ids.length !== slice.length) throw new Error(`expected ${slice.length} ids, got ${ids.length}`);
    slice.forEach((t, k) => { map[t.id] = ids[k]; });
    save();
    minted += slice.length;
    const pct = (((tracks.length - todo.length + minted) / tracks.length) * 100).toFixed(1);
    console.log(`[${pct}%] batch ${i / BATCH + 1}: +${slice.length} (tokens ${ids[0]}..${ids[ids.length - 1]}) ${hash.slice(0, 12)}…`);
  } catch (e) {
    console.error("batch failed:", e.shortMessage || e.message, "— retrying in 30s");
    await sleep(30_000);
    i -= BATCH; // retry this slice
  }
}

const ended = await pub.getBalance({ address: account.address });
console.log(`DONE. minted ${minted} | mapped ${Object.keys(map).length}/${tracks.length}`);
console.log("gas spent:", formatEther(started - ended), "ETH | left:", formatEther(ended), "ETH");
await prisma.$disconnect();
