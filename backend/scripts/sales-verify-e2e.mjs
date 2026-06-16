// Proves POST /api/sales now verifies on-chain: a real purchase is accepted, while a
// forged txHash, a qty mismatch, and a replay are all rejected.
import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const API = "http://localhost:31338";
const RPC = "http://127.0.0.1:8545";
const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"; // hardhat #3
const DOMAIN = "localhost:31337";
const BUY_ABI = [{ type: "function", name: "buy", stateMutability: "payable", inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] }];
const chain = defineChain({ id: 31337, name: "h", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
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
const post = (token, body) => fetch(`${API}/api/sales`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

async function main() {
  const token = await auth();
  const list = await (await fetch(`${API}/api/tracks`)).json();
  const t = list.find((x) => x.chainTokenId != null && x.left > 1);

  // a real on-chain purchase
  const hash = await wallet.writeContract({ abi: BUY_ABI, address: CONTRACT, functionName: "buy", args: [BigInt(t.chainTokenId), 1n], value: BigInt(t.priceWei) });
  await pub.waitForTransactionReceipt({ hash });

  const good = await post(token, { trackId: t.id, qty: 1, priceWei: t.priceWei, txHash: hash });
  console.log("A) real purchase           ->", good.status, good.status === 201 ? "ACCEPTED ✓" : JSON.stringify(good.body));

  const fakeHash = "0x" + "ab".repeat(32);
  const forged = await post(token, { trackId: t.id, qty: 1, priceWei: t.priceWei, txHash: fakeHash });
  console.log("B) forged txHash           ->", forged.status, forged.status >= 400 ? `REJECTED ✓ (${forged.body.reason || forged.body.error})` : "WRONGLY ACCEPTED");

  // real tx but claim qty=5 (event says 1)
  const hash2 = await wallet.writeContract({ abi: BUY_ABI, address: CONTRACT, functionName: "buy", args: [BigInt(t.chainTokenId), 1n], value: BigInt(t.priceWei) });
  await pub.waitForTransactionReceipt({ hash: hash2 });
  const qtyLie = await post(token, { trackId: t.id, qty: 5, priceWei: t.priceWei, txHash: hash2 });
  console.log("C) qty mismatch (claim 5)  ->", qtyLie.status, qtyLie.status >= 400 ? `REJECTED ✓ (${qtyLie.body.reason || qtyLie.body.error})` : "WRONGLY ACCEPTED");

  // replay the first (already-recorded) txHash
  const replay = await post(token, { trackId: t.id, qty: 1, priceWei: t.priceWei, txHash: hash });
  console.log("D) replay same txHash      ->", replay.status, replay.status === 409 ? "REJECTED ✓ (duplicate)" : JSON.stringify(replay.body));

  // bad input (no txHash)
  const badInput = await post(token, { trackId: t.id, qty: 1 });
  console.log("E) missing txHash (valid.) ->", badInput.status, badInput.status === 400 ? `REJECTED ✓ (${badInput.body.error})` : "WRONGLY ACCEPTED");

  const ok = good.status === 201 && forged.status >= 400 && qtyLie.status >= 400 && replay.status === 409 && badInput.status === 400;
  console.log(ok ? "\n✓ SALE VERIFICATION ENFORCED" : "\n✗ verification gap");
}
main().catch((e) => { console.error(e); process.exit(1); });
