// End-to-end mint proof: mirrors exactly what frontend/app/mint/page.tsx does in the
// browser, but driven from Node (no wallet UI). Steps:
//   1) on-chain mintTrack via the deployed contract
//   2) read the new trackId from the TrackMinted event
//   3) SIWE auth against the backend -> JWT (same nonce/sign/verify the UI uses)
//   4) POST /api/tracks so the track persists and shows on the home page
//   5) GET /api/tracks to confirm it is there
import { createWalletClient, createPublicClient, http, parseEther, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const API = process.env.API || "http://localhost:31338";
const RPC = process.env.RPC || "http://127.0.0.1:8545";
const CONTRACT = process.env.CONTRACT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PK = process.env.PK || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DOMAIN = process.env.SIWE_DOMAIN || "localhost:31337";

const abi = [
  { type: "function", name: "mintTrack", stateMutability: "nonpayable",
    inputs: [{ name: "maxSupply", type: "uint64" }, { name: "price", type: "uint96" }, { name: "royaltyBps", type: "uint96" }, { name: "metadataUri", type: "string" }],
    outputs: [{ name: "trackId", type: "uint256" }] },
  { type: "event", name: "TrackMinted", inputs: [
    { name: "trackId", type: "uint256", indexed: true }, { name: "artist", type: "address", indexed: true },
    { name: "maxSupply", type: "uint64", indexed: false }, { name: "price", type: "uint96", indexed: false }, { name: "uri", type: "string", indexed: false }] },
];

const hardhat = defineChain({ id: 31337, name: "Hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain: hardhat, transport: http(RPC) });
const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });

const TRACK = { title: "GHOST FREQUENCY", genre: "SYNTHWAVE", maxSupply: 7, priceEth: "0.08", royaltyPct: 5, coverSeed: 4242, audioUrl: "https://cdn.tresrz.test/ghost.mp3" };

async function main() {
  console.log("Artist wallet:", account.address);

  // 1) on-chain mint
  const priceWei = parseEther(TRACK.priceEth);
  const metadata = JSON.stringify({ name: TRACK.title, genre: TRACK.genre, audioUrl: TRACK.audioUrl, coverSeed: TRACK.coverSeed });
  const metadataUri = `data:application/json,${encodeURIComponent(metadata)}`;
  const hash = await wallet.writeContract({ abi, address: CONTRACT, functionName: "mintTrack",
    args: [BigInt(TRACK.maxSupply), priceWei, BigInt(TRACK.royaltyPct * 100), metadataUri] });
  console.log("1) mintTrack tx:", hash);

  // 2) trackId from event
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const events = parseEventLogs({ abi, eventName: "TrackMinted", logs: receipt.logs });
  const trackId = events[0].args.trackId;
  console.log("2) TrackMinted -> on-chain trackId:", trackId.toString());

  // 3) SIWE auth -> JWT
  const nonceRes = await (await fetch(`${API}/api/auth/nonce?address=${account.address}`)).json();
  const siwe = new SiweMessage({ domain: DOMAIN, address: account.address, statement: "Sign in to TRESRZ - own the sound.",
    uri: `http://${DOMAIN}`, version: "1", chainId: 31337, nonce: nonceRes.nonce });
  const message = siwe.prepareMessage();
  const signature = await wallet.signMessage({ message });
  const verify = await (await fetch(`${API}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) })).json();
  if (!verify.token) throw new Error("SIWE verify failed: " + JSON.stringify(verify));
  console.log("3) SIWE verified, JWT issued for user:", verify.user.address);

  // 4) persist via API
  const createRes = await fetch(`${API}/api/tracks`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${verify.token}` },
    body: JSON.stringify({ title: TRACK.title, genre: TRACK.genre, maxSupply: TRACK.maxSupply, priceWei: priceWei.toString(),
      coverSeed: TRACK.coverSeed, audioUrl: TRACK.audioUrl, chainTokenId: Number(trackId), txHash: hash }) });
  const created = await createRes.json();
  if (createRes.status !== 201) throw new Error("create failed: " + JSON.stringify(created));
  console.log("4) POST /api/tracks ->", createRes.status, "db id:", created.id, "title:", created.title);

  // 5) confirm on feed
  const list = await (await fetch(`${API}/api/tracks`)).json();
  const found = list.find((t) => t.id === created.id);
  console.log("5) GET /api/tracks -> found minted track on feed:", !!found, found ? `(chainTokenId ${found.chainTokenId})` : "");
  console.log(found ? "\n✓ END-TO-END MINT OK" : "\n✗ NOT FOUND");
}
main().catch((e) => { console.error(e); process.exit(1); });
