import { createPublicClient, createWalletClient, http, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

// ---- fiat delivery wallet (Stripe checkout fulfilment) ----
// The platform wallet that buys editions on-chain after a card payment clears
// and forwards them to the customer. Testnet: the deployer key works fine.
const DELIVERY_PK = process.env.DELIVERY_PRIVATE_KEY || null;
const deliveryAccount = DELIVERY_PK && /^0x[0-9a-fA-F]{64}$/.test(DELIVERY_PK) ? privateKeyToAccount(DELIVERY_PK) : null;
const deliveryWallet = deliveryAccount && RPC_URL ? createWalletClient({ account: deliveryAccount, chain, transport: http(RPC_URL) }) : null;
export const deliveryConfigured = !!(deliveryWallet && publicClient && MUSIC_CONTRACT);
export const deliveryAddress = deliveryAccount?.address ?? null;

const musicWriteAbi = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "id", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "data", type: "bytes" },
  ], outputs: [] },
];

/**
 * Fulfil a fiat order: platform wallet buys `qty` editions of `tokenId` on the
 * primary market (paying `unitPriceWei` each in ETH) and transfers them to the
 * customer wallet. Returns { ok, buyTx, transferTx, paidWei } or { ok:false, reason }.
 */
export async function buyAndDeliver({ tokenId, qty, unitPriceWei, to }) {
  if (!deliveryConfigured) return { ok: false, reason: "delivery wallet not configured" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || "")) return { ok: false, reason: "bad recipient address" };
  try {
    const value = BigInt(unitPriceWei) * BigInt(qty);
    const buyTx = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "buy",
      args: [BigInt(tokenId), BigInt(qty)], value,
    });
    const buyRcpt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    if (buyRcpt.status !== "success") return { ok: false, reason: "on-chain buy reverted", buyTx };

    const transferTx = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "safeTransferFrom",
      args: [deliveryAccount.address, to, BigInt(tokenId), BigInt(qty), "0x"],
    });
    const xferRcpt = await publicClient.waitForTransactionReceipt({ hash: transferTx });
    if (xferRcpt.status !== "success") return { ok: false, reason: "delivery transfer reverted", buyTx, transferTx };

    return { ok: true, buyTx, transferTx, paidWei: value.toString() };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

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
 * on-chain for the given txHash, matching tokenId and qty. `expectedParty` must
 * be the buyer OR the seller of the event — a listing buy is recorded by the
 * buyer, an accepted offer by the seller (the only wallet present for that tx).
 * Returns { ok, paid, buyer, seller, kind } on success.
 */
export async function verifySecondarySale({ txHash, expectedTokenId, expectedParty, expectedQty }) {
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

  const party = String(expectedParty).toLowerCase();
  const match = events.find(
    (e) =>
      (e.eventName === "Sale" || e.eventName === "OfferAccepted") &&
      e.args.tokenId === BigInt(expectedTokenId) &&
      (e.args.buyer.toLowerCase() === party || e.args.seller.toLowerCase() === party) &&
      Number(e.args.qty) === Number(expectedQty)
  );
  if (!match) return { ok: false, reason: "no matching secondary-sale event" };
  return {
    ok: true,
    paid: match.args.paid.toString(),
    buyer: match.args.buyer,
    seller: match.args.seller,
    kind: match.eventName === "Sale" ? "secondary_listing" : "secondary_offer",
  };
}
