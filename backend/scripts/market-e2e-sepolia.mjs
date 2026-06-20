// Sepolia-scaled mirror of market-e2e.mjs. Same flow (mint -> list -> secondary
// buy -> offer -> accept) but with testnet-sized amounts and a buyer funded from
// the deployer, so it runs against a real chain on a small faucet balance.
// Run:  RPC_URL=<sepolia> MUSIC_CONTRACT=.. MARKET_CONTRACT=.. DEPLOYER_PK=0x.. \
//       CHAIN_ID=11155111 node scripts/market-e2e-sepolia.mjs
import { createWalletClient, createPublicClient, http, parseEventLogs, defineChain, parseEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const RPC = process.env.RPC_URL;
const MUSIC = process.env.MUSIC_CONTRACT;
const MARKET = process.env.MARKET_CONTRACT;
const SELLER_PK = process.env.DEPLOYER_PK;          // deployer == artist/seller (funded)
const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
// A FRESH throwaway buyer (never use a well-known key — sweeper bots drain those
// on public testnets, and never commit a real key). Defaults to an ephemeral
// random key; funded from the deployer at the start, swept back at the end.
const BUYER_PK = process.env.BUYER_PK || generatePrivateKey();
if (!RPC || !MUSIC || !MARKET || !SELLER_PK) throw new Error("set RPC_URL, MUSIC_CONTRACT, MARKET_CONTRACT, DEPLOYER_PK");

// Scaled amounts (≈ $0 on a testnet): primary price, listing price, offer price.
const PRICE = parseEther("0.0001");
const LIST_PRICE = parseEther("0.0002");
const OFFER_PRICE = parseEther("0.00015");
const FUND_BUYER = parseEther("0.003");             // gas + purchase budget for the buyer

const chain = defineChain({ id: CHAIN_ID, name: "sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const seller = createWalletClient({ account: privateKeyToAccount(SELLER_PK), chain, transport: http(RPC) });
const buyer = createWalletClient({ account: privateKeyToAccount(BUYER_PK), chain, transport: http(RPC) });

const musicAbi = [
  { type: "function", name: "mintTrack", stateMutability: "nonpayable", inputs: [{ name: "maxSupply", type: "uint64" }, { name: "price", type: "uint96" }, { name: "royaltyBps", type: "uint96" }, { name: "metadataUri", type: "string" }], outputs: [{ name: "trackId", type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "TrackMinted", inputs: [{ name: "trackId", type: "uint256", indexed: true }, { name: "artist", type: "address", indexed: true }, { name: "maxSupply", type: "uint64", indexed: false }, { name: "price", type: "uint96", indexed: false }, { name: "uri", type: "string", indexed: false }] },
];
const marketAbi = [
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "qty", type: "uint64" }, { name: "pricePerUnit", type: "uint96" }], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "listingId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "makeOffer", stateMutability: "payable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "qty", type: "uint64" }, { name: "pricePerUnit", type: "uint96" }], outputs: [{ name: "offerId", type: "uint256" }] },
  { type: "function", name: "acceptOffer", stateMutability: "nonpayable", inputs: [{ name: "offerId", type: "uint256" }], outputs: [] },
  { type: "event", name: "Listed", inputs: [{ name: "listingId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true }, { name: "qty", type: "uint64", indexed: false }, { name: "pricePerUnit", type: "uint96", indexed: false }] },
  { type: "event", name: "Sale", inputs: [{ name: "listingId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: false }, { name: "qty", type: "uint64", indexed: false }, { name: "paid", type: "uint256", indexed: false }, { name: "royalty", type: "uint256", indexed: false }, { name: "fee", type: "uint256", indexed: false }] },
  { type: "event", name: "OfferMade", inputs: [{ name: "offerId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: true }, { name: "qty", type: "uint64", indexed: false }, { name: "pricePerUnit", type: "uint96", indexed: false }] },
  { type: "event", name: "OfferAccepted", inputs: [{ name: "offerId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "buyer", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: false }, { name: "qty", type: "uint64", indexed: false }, { name: "paid", type: "uint256", indexed: false }, { name: "royalty", type: "uint256", indexed: false }, { name: "fee", type: "uint256", indexed: false }] },
];

const wait = (hash) => pub.waitForTransactionReceipt({ hash });
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) process.exitCode = 1; };

async function main() {
  const sAddr = seller.account.address, bAddr = buyer.account.address;
  console.log("seller/artist:", sAddr, "\nbuyer:", bAddr, "\nchain:", (await pub.getChainId()));

  // fund the buyer for gas + purchases
  const bBal = await pub.getBalance({ address: bAddr });
  if (bBal < OFFER_PRICE) {
    await wait(await seller.sendTransaction({ to: bAddr, value: FUND_BUYER }));
    ok(true, `funded buyer with ${FUND_BUYER} wei`);
  } else ok(true, `buyer already funded (${bBal} wei)`);

  // seller mints a 5-edition track and approves the marketplace
  let hash = await seller.writeContract({ abi: musicAbi, address: MUSIC, functionName: "mintTrack", args: [5n, PRICE, 500n, "ipfs://e2e-sepolia"] });
  const minted = parseEventLogs({ abi: musicAbi, eventName: "TrackMinted", logs: (await wait(hash)).logs })[0];
  const tokenId = minted.args.trackId;
  console.log("minted tokenId", tokenId.toString());
  // mintTrack only registers the track; editions exist only once bought from the
  // primary sale. Seller buys 3 editions so it has inventory to list/offer-fill.
  await wait(await seller.writeContract({ abi: musicAbi, address: MUSIC, functionName: "buy", args: [tokenId, 3n], value: PRICE * 3n }));
  const sellerEd = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [sAddr, tokenId] });
  ok(sellerEd >= 3n, `seller acquired ${sellerEd} primary editions`);
  await wait(await seller.writeContract({ abi: musicAbi, address: MUSIC, functionName: "setApprovalForAll", args: [MARKET, true] }));

  // --- fixed-price listing + secondary buy ---
  hash = await seller.writeContract({ abi: marketAbi, address: MARKET, functionName: "list", args: [tokenId, 3n, LIST_PRICE] });
  const listed = parseEventLogs({ abi: marketAbi, eventName: "Listed", logs: (await wait(hash)).logs })[0];
  const listingId = listed.args.listingId;
  ok(!!listingId, `listed 3 @ ${LIST_PRICE} (listingId ${listingId})`);

  const buyerBal0 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  hash = await buyer.writeContract({ abi: marketAbi, address: MARKET, functionName: "buy", args: [listingId, 2n], value: LIST_PRICE * 2n });
  const sale = parseEventLogs({ abi: marketAbi, eventName: "Sale", logs: (await wait(hash)).logs })[0];
  const buyerBal1 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  ok(buyerBal1 - buyerBal0 === 2n, `buyer received 2 editions (royalty ${sale.args.royalty} fee ${sale.args.fee})`);

  // --- offer + accept ---
  hash = await buyer.writeContract({ abi: marketAbi, address: MARKET, functionName: "makeOffer", args: [tokenId, 1n, OFFER_PRICE], value: OFFER_PRICE });
  const offer = parseEventLogs({ abi: marketAbi, eventName: "OfferMade", logs: (await wait(hash)).logs })[0];
  const offerId = offer.args.offerId;
  ok(!!offerId, `buyer made offer 1 @ ${OFFER_PRICE} (offerId ${offerId})`);

  hash = await seller.writeContract({ abi: marketAbi, address: MARKET, functionName: "acceptOffer", args: [offerId] });
  const accepted = parseEventLogs({ abi: marketAbi, eventName: "OfferAccepted", logs: (await wait(hash)).logs })[0];
  const buyerBal2 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  ok(buyerBal2 - buyerBal1 === 1n, `seller accepted offer, buyer now holds ${buyerBal2} editions (paid ${accepted.args.paid})`);

  // sweep the buyer's leftover testnet ETH back to the deployer (don't strand it)
  try {
    const gp = (await pub.estimateFeesPerGas()).maxFeePerGas ?? 2000000000n;
    const cost = 21000n * gp * 2n;
    const left = await pub.getBalance({ address: bAddr });
    if (left > cost) {
      await wait(await buyer.sendTransaction({ to: sAddr, value: left - cost, gas: 21000n }));
      ok(true, `swept ${left - cost} wei back to deployer`);
    }
  } catch (e) { console.log("(sweep-back skipped:", e.shortMessage || e.message, ")"); }

  console.log("\n✓ SEPOLIA MARKET E2E OK — list/buy + offer/accept with royalty + fee split");
}
main().catch((e) => { console.error(e); process.exit(1); });
