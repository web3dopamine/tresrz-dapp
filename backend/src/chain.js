import { createPublicClient, http, parseEventLogs, defineChain } from "viem";

// Minimal ABI for reading the primary-sale event we verify against.
export const purchaseAbi = [
  {
    type: "event",
    name: "TrackPurchased",
    inputs: [
      { name: "trackId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
    ],
  },
];

const RPC_URL = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
export const MUSIC_CONTRACT = process.env.MUSIC_CONTRACT || null;

const chain = defineChain({
  id: CHAIN_ID,
  name: "TresrzChain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL || "http://127.0.0.1:8545"] } },
});

export const publicClient = RPC_URL && MUSIC_CONTRACT ? createPublicClient({ chain, transport: http(RPC_URL) }) : null;

export const chainConfigured = !!publicClient;

/**
 * Verify a primary purchase actually happened on-chain for the given txHash.
 * Returns { ok:true } only if the receipt succeeded and contains a TrackPurchased
 * event from our contract matching the expected tokenId, buyer and qty.
 */
export async function verifyPurchase({ txHash, expectedTokenId, expectedBuyer, expectedQty }) {
  if (!chainConfigured) return { ok: false, reason: "chain not configured" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return { ok: false, reason: "bad txHash" };

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "tx not found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx reverted" };

  // only logs emitted by our contract
  const ours = receipt.logs.filter((l) => l.address.toLowerCase() === MUSIC_CONTRACT.toLowerCase());
  const events = parseEventLogs({ abi: purchaseAbi, eventName: "TrackPurchased", logs: ours });

  const match = events.find(
    (e) =>
      e.args.trackId === BigInt(expectedTokenId) &&
      e.args.buyer.toLowerCase() === String(expectedBuyer).toLowerCase() &&
      Number(e.args.qty) === Number(expectedQty)
  );
  if (!match) return { ok: false, reason: "no matching TrackPurchased event" };
  return { ok: true, paid: match.args.paid.toString() };
}
