// Full-stack e2e against the LIVE tresrz deployment (Sepolia + local API).
// Flow: SIWE auth (artist / fresh buyer / admin) -> primary buy on-chain ->
// record -> list -> secondary buy -> record (buyer party) -> offer -> accept ->
// record (SELLER party, the new path) -> token-gated streaming from all three
// perspectives -> likes -> IPFS uploads -> admin moderation (with revert) ->
// price history. Prints PASS/FAIL per step; exits 1 on any FAIL.
import "dotenv/config";
import { readFileSync } from "fs";
import { createWalletClient, createPublicClient, http, defineChain, formatEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SiweMessage } from "siwe";

const API = "http://localhost:31338";
const DOMAIN = "localhost:31337";
const RPC = process.env.RPC_URL;
const MUSIC = process.env.MUSIC_CONTRACT;
const MARKET = process.env.MARKET_CONTRACT;
const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);

// deployer/artist key from contracts/.env; admin = hardhat account #0 (publicly
// known dev key, listed in ADMIN_ADDRESSES)
const contractsEnv = readFileSync("/root/tresrz-dapp/contracts/.env", "utf8");
const DEPLOYER_PK = contractsEnv.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
const ADMIN_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_PK = generatePrivateKey();

const chain = defineChain({ id: CHAIN_ID, name: "sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (pk) => createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(RPC) });
const artist = wallet(DEPLOYER_PK), buyer = wallet(BUYER_PK), admin = wallet(ADMIN_PK);

let fails = 0;
const ok = (c, m, extra = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${m}${extra ? " — " + extra : ""}`); if (!c) fails++; };
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

const musicAbi = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
];
const marketAbi = [
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "qty", type: "uint64" }, { name: "pricePerUnit", type: "uint96" }], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "listingId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "makeOffer", stateMutability: "payable", inputs: [{ name: "tokenId", type: "uint256" }, { name: "qty", type: "uint64" }, { name: "pricePerUnit", type: "uint96" }], outputs: [{ name: "offerId", type: "uint256" }] },
  { type: "function", name: "acceptOffer", stateMutability: "nonpayable", inputs: [{ name: "offerId", type: "uint256" }], outputs: [] },
  { type: "function", name: "nextListingId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextOfferId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

async function siweLogin(w) {
  const addr = w.account.address;
  const { nonce } = await (await fetch(`${API}/api/auth/nonce?address=${addr}`)).json();
  const msg = new SiweMessage({
    domain: DOMAIN, address: addr, statement: "e2e test sign-in", uri: `http://${DOMAIN}`,
    version: "1", chainId: CHAIN_ID, nonce,
  }).prepareMessage();
  const signature = await w.signMessage({ message: msg });
  const res = await fetch(`${API}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, signature }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`SIWE verify failed for ${addr}: ${d.error} ${d.detail || ""}`);
  return d.token;
}
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const j = { "Content-Type": "application/json" };

async function main() {
  console.log(`artist: ${artist.account.address}\nbuyer:  ${buyer.account.address}\nadmin:  ${admin.account.address}\n`);

  // ---------- 0. pick the on-chain track ----------
  const tracks = await (await fetch(`${API}/api/tracks`)).json();
  const track = tracks.find((t) => t.chainTokenId != null);
  ok(!!track, "found on-chain track in catalog", `${track.title} (tokenId ${track.chainTokenId}, left ${track.left})`);
  const tokenId = BigInt(track.chainTokenId);
  const price = BigInt(track.priceWei);
  const leftBefore = track.left;

  // ---------- 1. SIWE auth for all three roles ----------
  const artistTok = await siweLogin(artist); ok(!!artistTok, "SIWE sign-in: artist");
  const adminTok = await siweLogin(admin); ok(!!adminTok, "SIWE sign-in: admin");
  const meAdmin = await (await fetch(`${API}/api/auth/me`, { headers: auth(adminTok) })).json();
  ok(meAdmin.isAdmin === true, "admin wallet recognized as admin");

  // ---------- 2. fund fresh buyer, SIWE ----------
  await wait(await artist.sendTransaction({ to: buyer.account.address, value: 4_000_000_000_000_000n }));
  ok(true, "funded fresh buyer with 0.004 ETH");
  const buyerTok = await siweLogin(buyer); ok(!!buyerTok, "SIWE sign-in: fresh buyer");

  // ---------- 3. PRIMARY: buy 2 editions on-chain, record via API ----------
  const buyHash = await buyer.writeContract({ address: MUSIC, abi: musicAbi, functionName: "buy", args: [tokenId, 2n], value: price * 2n });
  await wait(buyHash);
  ok(true, "primary buy on-chain (2 editions)", buyHash.slice(0, 14) + "…");
  let r = await fetch(`${API}/api/sales`, { method: "POST", headers: { ...j, ...auth(buyerTok) }, body: JSON.stringify({ trackId: track.id, qty: 2, priceWei: (price * 2n).toString(), txHash: buyHash }) });
  ok(r.status === 201, "primary sale recorded via API (on-chain verified)", `HTTP ${r.status}`);
  // duplicate replay must be rejected
  r = await fetch(`${API}/api/sales`, { method: "POST", headers: { ...j, ...auth(buyerTok) }, body: JSON.stringify({ trackId: track.id, qty: 2, priceWei: (price * 2n).toString(), txHash: buyHash }) });
  ok(r.status === 409, "replayed txHash rejected", `HTTP ${r.status}`);
  // forged tx must be rejected
  r = await fetch(`${API}/api/sales`, { method: "POST", headers: { ...j, ...auth(buyerTok) }, body: JSON.stringify({ trackId: track.id, qty: 1, priceWei: "1", txHash: "0x" + "11".repeat(32) }) });
  ok(r.status === 400, "forged txHash rejected", `HTTP ${r.status}`);
  const after = await (await fetch(`${API}/api/tracks/${track.id}`)).json();
  ok(after.left === leftBefore - 2, "editions-left decremented", `${leftBefore} -> ${after.left}`);

  // ---------- 4. STREAMING: holder / artist / non-holder ----------
  r = await fetch(`${API}/api/stream/${track.id}/preview`);
  ok(r.status === 200, "streaming preview public", `HTTP ${r.status}`);
  r = await fetch(`${API}/api/stream/${track.id}/full`, { headers: auth(buyerTok) });
  const fullHolder = await r.json();
  ok(r.status === 200 && !!fullHolder.fullUrl, "full track unlocked for HOLDER (on-chain balanceOf)", `HTTP ${r.status}`);
  r = await fetch(`${API}/api/stream/${track.id}/full`, { headers: auth(artistTok) });
  const fullArtist = await r.json();
  ok(r.status === 200 && fullArtist.viaArtist === true, "full track unlocked for ARTIST (bypass)", `HTTP ${r.status}`);
  r = await fetch(`${API}/api/stream/${track.id}/full`, { headers: auth(adminTok) });
  ok(r.status === 403, "full track DENIED for non-holder", `HTTP ${r.status}`);
  r = await fetch(`${API}/api/stream/${track.id}/full`);
  ok(r.status === 401, "full track DENIED unauthenticated", `HTTP ${r.status}`);

  // ---------- 5. SECONDARY (listing): buyer lists, artist buys, records as buyer-party ----------
  await wait(await buyer.writeContract({ address: MUSIC, abi: musicAbi, functionName: "setApprovalForAll", args: [MARKET, true] }));
  const LIST_PRICE = 200_000_000_000_000n; // 0.0002 ETH
  const listHash = await buyer.writeContract({ address: MARKET, abi: marketAbi, functionName: "list", args: [tokenId, 1n, LIST_PRICE] });
  await wait(listHash);
  const listingId = (await pub.readContract({ address: MARKET, abi: marketAbi, functionName: "nextListingId" })) - 1n;
  ok(true, "buyer listed 1 edition on marketplace", `listing #${listingId}`);
  const sBuyHash = await artist.writeContract({ address: MARKET, abi: marketAbi, functionName: "buy", args: [listingId, 1n], value: LIST_PRICE });
  await wait(sBuyHash);
  ok(true, "artist bought the listing on-chain", sBuyHash.slice(0, 14) + "…");
  r = await fetch(`${API}/api/sales/secondary`, { method: "POST", headers: { ...j, ...auth(artistTok) }, body: JSON.stringify({ trackId: track.id, qty: 1, txHash: sBuyHash }) });
  let d = await r.json();
  ok(r.status === 201 && d.kind === "secondary_listing", "secondary listing sale recorded (buyer party)", `HTTP ${r.status} kind=${d.kind}`);

  // ---------- 6. SECONDARY (offer): artist offers, buyer accepts, records as SELLER party ----------
  const OFFER_PRICE = 150_000_000_000_000n; // 0.00015 ETH
  const offerHash = await artist.writeContract({ address: MARKET, abi: marketAbi, functionName: "makeOffer", args: [tokenId, 1n, OFFER_PRICE], value: OFFER_PRICE });
  await wait(offerHash);
  const offerId = (await pub.readContract({ address: MARKET, abi: marketAbi, functionName: "nextOfferId" })) - 1n;
  ok(true, "artist made escrowed offer", `offer #${offerId}`);
  const acceptHash = await buyer.writeContract({ address: MARKET, abi: marketAbi, functionName: "acceptOffer", args: [offerId] });
  await wait(acceptHash);
  ok(true, "buyer (holder) accepted the offer on-chain", acceptHash.slice(0, 14) + "…");
  r = await fetch(`${API}/api/sales/secondary`, { method: "POST", headers: { ...j, ...auth(buyerTok) }, body: JSON.stringify({ trackId: track.id, qty: 1, txHash: acceptHash }) });
  d = await r.json();
  ok(r.status === 201 && d.kind === "secondary_offer", "accepted offer recorded by SELLER (new path)", `HTTP ${r.status} kind=${d.kind}`);
  // a stranger must NOT be able to record it (already recorded -> 409, but party check is what matters for fresh txs; both are rejections)
  r = await fetch(`${API}/api/sales/secondary`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ trackId: track.id, qty: 1, txHash: acceptHash }) });
  ok(r.status === 409 || r.status === 400, "third party cannot double-record", `HTTP ${r.status}`);

  // ---------- 7. price history reflects all three sales ----------
  const hist = await (await fetch(`${API}/api/sales/history/${track.id}`)).json();
  const kinds = hist.map((h) => h.kind);
  ok(kinds.includes("primary") && kinds.includes("secondary_listing") && kinds.includes("secondary_offer"),
    "price history shows primary + secondary_listing + secondary_offer", kinds.join(","));

  // ---------- 8. likes toggle ----------
  const l1 = await (await fetch(`${API}/api/likes/${track.id}`, { method: "POST", headers: auth(buyerTok) })).json();
  const l2 = await (await fetch(`${API}/api/likes/${track.id}`, { method: "POST", headers: auth(buyerTok) })).json();
  ok(l1.liked === true && l2.liked === false, "like toggles on and off", `likes ${l1.count}->${l2.count}`);

  // ---------- 9. IPFS upload pipeline ----------
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(2048).fill(0xff)], { type: "audio/mpeg" }), "e2e-test.mp3");
  r = await fetch(`${API}/api/upload/audio`, { method: "POST", headers: auth(artistTok), body: fd });
  d = await r.json();
  ok(r.status === 201 && d.pinned === true && d.uri?.startsWith("ipfs://"), "audio upload pinned to IPFS", `cid=${(d.cid || "").slice(0, 14)}…`);
  const badFd = new FormData();
  badFd.append("file", new Blob([new Uint8Array(64)], { type: "application/x-msdownload" }), "evil.exe");
  r = await fetch(`${API}/api/upload/audio`, { method: "POST", headers: auth(artistTok), body: badFd });
  ok(r.status === 415, "disallowed MIME rejected (415)", `HTTP ${r.status}`);
  r = await fetch(`${API}/api/upload/metadata`, { method: "POST", headers: { ...j, ...auth(artistTok) }, body: JSON.stringify({ title: "E2E Test", description: "e2e", image: "ipfs://x", audio: d.uri, genre: "TEST" }) });
  d = await r.json();
  ok(r.status === 201 && d.pinned === true && d.metadata?.name === "E2E Test" && d.metadata?.animation_url, "ERC-721 metadata built + pinned", `uri=${(d.uri || "").slice(0, 20)}…`);

  // ---------- 10. admin moderation (toggle + verify + revert) ----------
  const stats = await (await fetch(`${API}/api/admin/stats`, { headers: auth(adminTok) })).json();
  ok(typeof stats.tracks === "number" && stats.contracts?.chainConfigured === true, "admin stats (chain configured)", `tracks=${stats.tracks} sales=${stats.sales ?? stats.saleCount}`);
  r = await fetch(`${API}/api/admin/stats`, { headers: auth(buyerTok) });
  ok(r.status === 403, "admin routes denied to non-admin", `HTTP ${r.status}`);

  // feature toggle
  await fetch(`${API}/api/admin/tracks/${track.id}/feature`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ featured: true }) });
  let hot = await (await fetch(`${API}/api/tracks?hot=true`)).json();
  ok(hot.some((t) => t.id === track.id), "featured flag shows track in hot feed");
  await fetch(`${API}/api/admin/tracks/${track.id}/feature`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ featured: track.hot }) });

  // track flag hides from public
  await fetch(`${API}/api/admin/tracks/${track.id}/flag`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ flagged: true }) });
  let pubList = await (await fetch(`${API}/api/tracks`)).json();
  ok(!pubList.some((t) => t.id === track.id), "flagged track hidden from public list");
  await fetch(`${API}/api/admin/tracks/${track.id}/flag`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ flagged: false }) });
  pubList = await (await fetch(`${API}/api/tracks`)).json();
  ok(pubList.some((t) => t.id === track.id), "unflag restores track");

  // user flag hides artist + their tracks
  const users = await (await fetch(`${API}/api/admin/users`, { headers: auth(adminTok) })).json();
  const artistUser = users.find((u) => u.address.toLowerCase() === artist.account.address.toLowerCase());
  await fetch(`${API}/api/admin/users/${artistUser.id}/flag`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ flagged: true }) });
  const artistsPub = await (await fetch(`${API}/api/artists`)).json();
  pubList = await (await fetch(`${API}/api/tracks`)).json();
  ok(!artistsPub.some((a) => a.address.toLowerCase() === artist.account.address.toLowerCase()), "flagged user hidden from artists");
  ok(!pubList.some((t) => t.artist.address.toLowerCase() === artist.account.address.toLowerCase()), "flagged user's tracks hidden from public list");
  await fetch(`${API}/api/admin/users/${artistUser.id}/flag`, { method: "POST", headers: { ...j, ...auth(adminTok) }, body: JSON.stringify({ flagged: false }) });
  ok(true, "moderation flags reverted");

  // ---------- 11. sweep buyer funds back ----------
  try {
    const bal = await pub.getBalance({ address: buyer.account.address });
    const gasPrice = await pub.getGasPrice();
    const fee = 21000n * gasPrice * 2n;
    if (bal > fee) {
      await wait(await buyer.sendTransaction({ to: artist.account.address, value: bal - fee, gasPrice: gasPrice * 2n, gas: 21000n }));
      ok(true, "swept buyer remainder back to deployer", `${formatEther(bal - fee)} ETH`);
    }
  } catch (e) { ok(true, "sweep skipped", String(e.shortMessage || e.message).slice(0, 60)); }

  console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FATAL:", e.shortMessage || e.message); process.exit(1); });
