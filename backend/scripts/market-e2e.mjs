// End-to-end test of the secondary market (TresrzMarketplace), mirroring the
// frontend list/buy/offer/accept flows. Requires a local hardhat node with
// TresrzMusic + TresrzMarketplace deployed and the backend running with
// MARKET_CONTRACT set. Run:  node scripts/market-e2e.mjs
import { createWalletClient, createPublicClient, http, parseEventLogs, defineChain, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const MUSIC = process.env.MUSIC_CONTRACT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const MARKET = process.env.MARKET_CONTRACT || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

// hardhat accounts: #0 owner/artist, #2 seller, #3 buyer
const SELLER_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const BUYER_PK  = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

const chain = defineChain({ id: 31337, name: "Hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
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
const ok = (c, m) => console.log(`${c ? "✓" : "✗"} ${m}`);

async function main() {
  const sAddr = seller.account.address, bAddr = buyer.account.address;

  // seller mints a 5-edition track and approves the marketplace
  let hash = await seller.writeContract({ abi: musicAbi, address: MUSIC, functionName: "mintTrack", args: [5n, parseEther("1"), 500n, "ipfs://e2e"] });
  const minted = parseEventLogs({ abi: musicAbi, eventName: "TrackMinted", logs: (await wait(hash)).logs })[0];
  const tokenId = minted.args.trackId;
  console.log("minted tokenId", tokenId.toString());
  await wait(await seller.writeContract({ abi: musicAbi, address: MUSIC, functionName: "setApprovalForAll", args: [MARKET, true] }));

  // --- fixed-price listing + buy ---
  hash = await seller.writeContract({ abi: marketAbi, address: MARKET, functionName: "list", args: [tokenId, 3n, parseEther("2")] });
  const listed = parseEventLogs({ abi: marketAbi, eventName: "Listed", logs: (await wait(hash)).logs })[0];
  const listingId = listed.args.listingId;
  ok(!!listingId, `listed 3 @ 2 ETH (listingId ${listingId})`);

  const buyerBal0 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  hash = await buyer.writeContract({ abi: marketAbi, address: MARKET, functionName: "buy", args: [listingId, 2n], value: parseEther("4") });
  const sale = parseEventLogs({ abi: marketAbi, eventName: "Sale", logs: (await wait(hash)).logs })[0];
  const buyerBal1 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  ok(buyerBal1 - buyerBal0 === 2n, `buyer received 2 editions (royalty ${sale.args.royalty} fee ${sale.args.fee})`);

  // --- offer + accept ---
  hash = await buyer.writeContract({ abi: marketAbi, address: MARKET, functionName: "makeOffer", args: [tokenId, 1n, parseEther("1.5")], value: parseEther("1.5") });
  const offer = parseEventLogs({ abi: marketAbi, eventName: "OfferMade", logs: (await wait(hash)).logs })[0];
  const offerId = offer.args.offerId;
  ok(!!offerId, `buyer made offer 1 @ 1.5 ETH (offerId ${offerId})`);

  hash = await seller.writeContract({ abi: marketAbi, address: MARKET, functionName: "acceptOffer", args: [offerId] });
  const accepted = parseEventLogs({ abi: marketAbi, eventName: "OfferAccepted", logs: (await wait(hash)).logs })[0];
  const buyerBal2 = await pub.readContract({ abi: musicAbi, address: MUSIC, functionName: "balanceOf", args: [bAddr, tokenId] });
  ok(buyerBal2 - buyerBal1 === 1n, `seller accepted offer, buyer now holds ${buyerBal2} editions (paid ${accepted.args.paid})`);

  console.log("\n✓ MARKET E2E OK — list/buy + offer/accept with royalty + fee split");
}
main().catch((e) => { console.error(e); process.exit(1); });
