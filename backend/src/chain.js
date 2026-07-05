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
  { type: "function", name: "editionsLeft", stateMutability: "view", inputs: [{ name: "trackId", type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "function", name: "mintTrack", stateMutability: "nonpayable", inputs: [
    { name: "maxSupply", type: "uint64" }, { name: "price", type: "uint96" }, { name: "royaltyBps", type: "uint96" }, { name: "metadataUri", type: "string" }],
    outputs: [{ name: "trackId", type: "uint256" }] },
  { type: "event", name: "TrackMinted", inputs: [
    { name: "trackId", type: "uint256", indexed: true }, { name: "artist", type: "address", indexed: true },
    { name: "maxSupply", type: "uint64", indexed: false }, { name: "price", type: "uint96", indexed: false }, { name: "uri", type: "string", indexed: false }] },
];

/**
 * SUBMIT a platform mint without waiting for the receipt — returns the tx hash
 * immediately so the API can respond fast. A background reconciler resolves the
 * tokenId later via mintResult(). The platform is the on-chain artist.
 */
export async function submitMint({ maxSupply, priceWei, royaltyBps, metadataUri }) {
  if (!deliveryConfigured) return { ok: false, reason: "platform mint wallet not configured" };
  try {
    const hash = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "mintTrack",
      args: [BigInt(maxSupply), BigInt(priceWei), BigInt(royaltyBps), metadataUri],
    });
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

/** Non-blocking result of a submitted mint: { status: success|reverted|pending, tokenId? }. */
export async function mintResult(hash) {
  if (!chainConfigured) return { status: "pending" };
  try {
    const rc = await publicClient.getTransactionReceipt({ hash });
    if (rc.status !== "success") return { status: "reverted" };
    const ev = parseEventLogs({ abi: musicWriteAbi, eventName: "TrackMinted", logs: rc.logs })[0];
    if (ev?.args?.trackId === undefined) return { status: "reverted" };
    return { status: "success", tokenId: Number(ev.args.trackId) };
  } catch {
    return { status: "pending" }; // not mined yet
  }
}

/** Synchronous mint (submit + wait) — kept for scripts/tests. */
export async function platformMint({ maxSupply, priceWei, royaltyBps, metadataUri }) {
  const sub = await submitMint({ maxSupply, priceWei, royaltyBps, metadataUri });
  if (!sub.ok) return sub;
  try {
    const rc = await publicClient.waitForTransactionReceipt({ hash: sub.hash });
    if (rc.status !== "success") return { ok: false, reason: "mint reverted", txHash: sub.hash };
    const ev = parseEventLogs({ abi: musicWriteAbi, eventName: "TrackMinted", logs: rc.logs })[0];
    if (ev?.args?.trackId === undefined) return { ok: false, reason: "TrackMinted event missing", txHash: sub.hash };
    return { ok: true, trackId: Number(ev.args.trackId), txHash: sub.hash };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

/**
 * Send ETH from the platform wallet (custodial creator withdrawals).
 * Returns { ok:true, txHash } on confirmed success, { ok:false, pending:true,
 * txHash } when the tx was BROADCAST but the receipt couldn't be confirmed
 * (caller must NOT refund — the ETH may have left), or { ok:false } for a
 * definitive pre-broadcast failure (safe to refund).
 */
export async function sendEth({ to, wei }) {
  if (!deliveryConfigured) return { ok: false, reason: "platform wallet not configured" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || "")) return { ok: false, reason: "bad address" };
  const value = (() => { try { return BigInt(wei); } catch { return -1n; } })();
  if (value <= 0n) return { ok: false, reason: "nothing to withdraw" };
  let hash;
  try {
    const bal = await publicClient.getBalance({ address: deliveryAccount.address });
    if (bal < value) return { ok: false, reason: "platform float too low, contact support" };
    hash = await deliveryWallet.sendTransaction({ to, value });
  } catch (e) {
    // failure before/at broadcast — nothing left the wallet, safe to refund
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
  // tx is broadcast (we hold a hash). A receipt failure here is UNKNOWN, not
  // a refundable failure.
  try {
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status === "success") return { ok: true, txHash: hash };
    return { ok: false, reason: "transfer reverted", txHash: hash }; // reverted = funds returned, refundable
  } catch (e) {
    return { ok: false, pending: true, txHash: hash, reason: String(e.shortMessage || e.message || e) };
  }
}

export const deliveryBalanceOf = (tokenId) =>
  deliveryConfigured ? balanceOf(deliveryAccount.address, tokenId) : Promise.resolve(0n);

/** On-chain editions still available for primary purchase (source of truth). */
export async function editionsLeft(tokenId) {
  if (!chainConfigured) return null;
  try {
    return await publicClient.readContract({ address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "editionsLeft", args: [BigInt(tokenId)] });
  } catch { return null; }
}

/** Submit a primary buy WITHOUT waiting for the receipt. Returns the tx hash
 *  immediately so callers can persist it before awaiting — a retry then
 *  re-checks the same tx instead of buying again. */
export async function submitBuy({ tokenId, qty, unitPriceWei }) {
  if (!deliveryConfigured) return { ok: false, reason: "delivery wallet not configured" };
  try {
    const value = BigInt(unitPriceWei) * BigInt(qty);
    const hash = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "buy",
      args: [BigInt(tokenId), BigInt(qty)], value,
    });
    return { ok: true, hash, paidWei: value.toString() };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

/** Non-blocking status of a submitted tx: "success" | "reverted" | "pending". */
export async function txStatus(hash) {
  if (!chainConfigured) return "pending";
  try {
    const rc = await publicClient.getTransactionReceipt({ hash });
    return rc.status === "success" ? "success" : "reverted";
  } catch {
    return "pending"; // not mined yet (or unknown)
  }
}

/** Await a submitted tx. Returns { ok, status: success|reverted|pending }. */
export async function waitReceipt(hash, timeoutMs = 60_000) {
  if (!chainConfigured) return { ok: false, status: "pending", reason: "chain not configured" };
  try {
    const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return { ok: rc.status === "success", status: rc.status === "success" ? "success" : "reverted" };
  } catch (e) {
    // timeout / not-yet-mined — caller should retry later, NOT re-submit
    return { ok: false, status: "pending", reason: String(e.shortMessage || e.message || e) };
  }
}

/**
 * Buy `qty` editions of `tokenId` on the primary market with the platform
 * delivery wallet (paying `unitPriceWei` each). The editions stay in the
 * delivery wallet — used both as step 1 of direct delivery and as the "hold"
 * step for guest card buyers who claim to a wallet later.
 */
export async function buyEditions({ tokenId, qty, unitPriceWei }) {
  if (!deliveryConfigured) return { ok: false, reason: "delivery wallet not configured" };
  try {
    const value = BigInt(unitPriceWei) * BigInt(qty);
    const buyTx = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "buy",
      args: [BigInt(tokenId), BigInt(qty)], value,
    });
    const buyRcpt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    if (buyRcpt.status !== "success") return { ok: false, reason: "on-chain buy reverted", buyTx };
    return { ok: true, buyTx, paidWei: value.toString() };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

/** Transfer `qty` editions of `tokenId` from the delivery wallet to `to`. */
export async function transferEditions({ tokenId, qty, to }) {
  if (!deliveryConfigured) return { ok: false, reason: "delivery wallet not configured" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || "")) return { ok: false, reason: "bad recipient address" };
  try {
    const transferTx = await deliveryWallet.writeContract({
      address: MUSIC_CONTRACT, abi: musicWriteAbi, functionName: "safeTransferFrom",
      args: [deliveryAccount.address, to, BigInt(tokenId), BigInt(qty), "0x"],
    });
    const xferRcpt = await publicClient.waitForTransactionReceipt({ hash: transferTx });
    if (xferRcpt.status !== "success") return { ok: false, reason: "delivery transfer reverted", transferTx };
    return { ok: true, transferTx };
  } catch (e) {
    return { ok: false, reason: String(e.shortMessage || e.message || e) };
  }
}

/**
 * Fulfil a fiat order end-to-end: buy then transfer to the customer wallet.
 * Returns { ok, buyTx, transferTx, paidWei } or { ok:false, reason }.
 */
export async function buyAndDeliver({ tokenId, qty, unitPriceWei, to }) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to || "")) return { ok: false, reason: "bad recipient address" };
  const bought = await buyEditions({ tokenId, qty, unitPriceWei });
  if (!bought.ok) return bought;
  const moved = await transferEditions({ tokenId, qty, to });
  if (!moved.ok) return { ...moved, buyTx: bought.buyTx };
  return { ok: true, buyTx: bought.buyTx, transferTx: moved.transferTx, paidWei: bought.paidWei };
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
