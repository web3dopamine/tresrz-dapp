// Two-step proof that SIWE nonces survive an API restart.
//   node nonce-persist.mjs sign     -> get a nonce, sign it, save the message+sig
//   (restart the backend here)
//   node nonce-persist.mjs verify   -> submit the saved message+sig; should still verify
import { createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SiweMessage } from "siwe";
import { writeFileSync, readFileSync } from "node:fs";

const API = "http://localhost:31338";
const PK = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"; // hardhat #4
const DOMAIN = "localhost:31337";
const FILE = "/tmp/siwe-persist.json";
const chain = defineChain({ id: 31337, name: "h", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const account = privateKeyToAccount(PK);
const wallet = createWalletClient({ account, chain, transport: http("http://127.0.0.1:8545") });

const mode = process.argv[2];

if (mode === "sign") {
  const { nonce } = await (await fetch(`${API}/api/auth/nonce?address=${account.address}`)).json();
  const siwe = new SiweMessage({ domain: DOMAIN, address: account.address, statement: "Sign in to TRESRZ - own the sound.", uri: `http://${DOMAIN}`, version: "1", chainId: 31337, nonce });
  const message = siwe.prepareMessage();
  const signature = await wallet.signMessage({ message });
  writeFileSync(FILE, JSON.stringify({ message, signature }));
  console.log("signed with nonce", nonce, "-> saved. (now restart the backend)");
} else if (mode === "verify") {
  const { message, signature } = JSON.parse(readFileSync(FILE, "utf8"));
  const res = await fetch(`${API}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) });
  const body = await res.json();
  console.log("verify after restart ->", res.status, body.token ? "JWT ISSUED ✓ (nonce survived restart)" : JSON.stringify(body));
  process.exit(body.token ? 0 : 1);
} else {
  console.error("usage: node nonce-persist.mjs sign|verify");
  process.exit(2);
}
