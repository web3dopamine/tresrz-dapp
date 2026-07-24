// Proves the buy flow TrackCard/detail page use: on-chain buy(trackId, qty) ->
// POST /api/sales -> minted increments and editions-left decreases.
import { createWalletClient, createPublicClient, http, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const API = "http://localhost:31338";
const RPC = "http://127.0.0.1:8545";
const CONTRACT = process.env.MUSIC_CONTRACT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // hardhat #2 (a buyer)
const DOMAIN = "localhost:31337";

const BUY_ABI = [
  { type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "event", name: "TrackPurchased", inputs: [
    { name: "trackId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true },
    { name: "qty", type: "uint64", indexed: false }, { name: "paid", type: "uint256", indexed: false }] },
];
const chain = defineChain({ id: 31337, name: "Hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });

async function auth() {
  const { nonce } = await (await fetch(`${API}/api/auth/nonce?address=${account.address}`)).json();
  const siwe = new SiweMessage({ domain: DOMAIN, address: account.address, statement: "Sign in to TRESRZ - own the sound.", uri: `http://${DOMAIN}`, version: "1", chainId: 31337, nonce });
  const message = siwe.prepareMessage();
  const signature = await wallet.signMessage({ message });
  const v = await (await fetch(`${API}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) })).json();
  return v.token;
}

async function main() {
  const token = await auth();
  // pick an on-chain track with editions left
  const list = await (await fetch(`${API}/api/tracks`)).json();
  const t = list.find((x) => x.chainTokenId != null && x.left > 1);
  console.log("buying:", t.title, "tokenId", t.chainTokenId, "| before left:", t.left, "minted:", t.minted);

  const hash = await wallet.writeContract({ abi: BUY_ABI, address: CONTRACT, functionName: "buy", args: [BigInt(t.chainTokenId), 1n], value: BigInt(t.priceWei) });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const ev = parseEventLogs({ abi: BUY_ABI, eventName: "TrackPurchased", logs: receipt.logs })[0];
  console.log("on-chain TrackPurchased -> buyer:", ev.args.buyer, "qty:", ev.args.qty.toString(), "paid:", ev.args.paid.toString());

  const sale = await (await fetch(`${API}/api/sales`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ trackId: t.id, qty: 1, priceWei: t.priceWei, txHash: hash }) })).json();
  console.log("POST /api/sales -> recorded sale id:", sale.id);

  const after = await (await fetch(`${API}/api/tracks/${t.id}`)).json();
  console.log("after left:", after.left, "minted:", after.minted);
  console.log(after.minted === t.minted + 1 && after.left === t.left - 1 ? "\n✓ BUY OK — editions-left reconciled" : "\n✗ mismatch");
}
main().catch((e) => { console.error(e); process.exit(1); });
