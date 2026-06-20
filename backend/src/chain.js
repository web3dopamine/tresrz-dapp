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

// Secondary-market events we verify when recording resales for price history.
export const marketAbi = [
  {
    type: "event",
    name: "Sale",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
      { name: "royalty", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OfferAccepted",
    inputs: [
      { name: "offerId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
      { name: "royalty", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
];

// Minimal ERC-1155 balanceOf for token-gated streaming checks.
const balanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
];

const RPC_URL = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
export const MUSIC_CONTRACT = process.env.MUSIC_CONTRACT || null;
export const MARKET_CONTRACT = process.env.MARKET_CONTRACT || null;

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

/**
 * Read an address's ERC-1155 balance of a tokenId on TresrzMusic. Used to gate
 * full-track streaming to holders. Returns a BigInt (0n if chain not configured).
 */
export async function balanceOf(account, tokenId) {
  if (!chainConfigured) return 0n;
  if (!/^0x[0-9a-fA-F]{40}$/.test(account || "")) return 0n;
  try {
    return await publicClient.readContract({
      address: MUSIC_CONTRACT,
      abi: balanceAbi,
      functionName: "balanceOf",
      args: [account, BigInt(tokenId)],
    });
  } catch {
    return 0n;
  }
}

/**
 * Verify a secondary-market sale (fixed-price Sale or accepted Offer) happened
 * on-chain for the given txHash, matching tokenId, buyer and qty. Returns
 * { ok, paid, seller, kind } on success.
 */
export async function verifySecondarySale({ txHash, expectedTokenId, expectedBuyer, expectedQty }) {
  if (!chainConfigured || !MARKET_CONTRACT) return { ok: false, reason: "market not configured" };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || "")) return { ok: false, reason: "bad txHash" };

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "tx not found" };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx reverted" };

  const ours = receipt.logs.filter((l) => l.address.toLowerCase() === MARKET_CONTRACT.toLowerCase());
  const events = parseEventLogs({ abi: marketAbi, logs: ours });

  const match = events.find(
    (e) =>
      (e.eventName === "Sale" || e.eventName === "OfferAccepted") &&
      e.args.tokenId === BigInt(expectedTokenId) &&
      e.args.buyer.toLowerCase() === String(expectedBuyer).toLowerCase() &&
      Number(e.args.qty) === Number(expectedQty)
  );
  if (!match) return { ok: false, reason: "no matching secondary-sale event" };
  return {
    ok: true,
    paid: match.args.paid.toString(),
    seller: match.args.seller,
    kind: match.eventName === "Sale" ? "secondary_listing" : "secondary_offer",
  };
}
