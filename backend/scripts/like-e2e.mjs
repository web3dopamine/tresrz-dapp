// Proves the like flow the detail page uses: SIWE auth -> POST /api/likes/:id ->
// re-fetch the track and confirm liked/count persisted (survives "refresh").
import { createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";

const API = "http://localhost:31338";
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // hardhat #1
const DOMAIN = "localhost:31337";
const chain = defineChain({ id: 31337, name: "Hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http("http://127.0.0.1:8545") });

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
  const list = await (await fetch(`${API}/api/tracks?limit=1`)).json();
  const id = list[0].id;
  console.log("track:", list[0].title, "starting likes:", list[0].likes);

  const r1 = await (await fetch(`${API}/api/likes/${id}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  console.log("after like   -> liked:", r1.liked, "count:", r1.count);

  // re-fetch as this authed user (simulates refresh): liked should be true
  const refetch = await (await fetch(`${API}/api/tracks/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  console.log("refetch      -> liked:", refetch.liked, "likes:", refetch.likes);

  const r2 = await (await fetch(`${API}/api/likes/${id}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  console.log("after unlike -> liked:", r2.liked, "count:", r2.count);

  const ok = r1.liked === true && refetch.liked === true && refetch.likes === r1.count && r2.liked === false;
  console.log(ok ? "\n✓ LIKE PERSISTS ACROSS REFETCH" : "\n✗ like flow mismatch");
}
main().catch((e) => { console.error(e); process.exit(1); });
