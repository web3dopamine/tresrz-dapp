// Create a signed-in throwaway buyer and a Stripe checkout session for 1 edition.
import "dotenv/config";
import { createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SiweMessage } from "siwe";
import { prisma } from "../src/db.js";

const API = "http://localhost:31338";
const chain = defineChain({ id: Number(process.env.CHAIN_ID), name: "sepolia", nativeCurrency: { name: "E", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL] } } });
const pk = generatePrivateKey();
const w = createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(process.env.RPC_URL) });
const addr = w.account.address;

const { nonce } = await (await fetch(`${API}/api/auth/nonce?address=${addr}`)).json();
const msg = new SiweMessage({ domain: "localhost:31337", address: addr, statement: "fiat e2e", uri: "http://localhost:31337", version: "1", chainId: Number(process.env.CHAIN_ID), nonce }).prepareMessage();
const signature = await w.signMessage({ message: msg });
const { token } = await (await fetch(`${API}/api/auth/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: msg, signature }) })).json();

const track = (await (await fetch(`${API}/api/tracks`)).json()).find((t) => t.chainTokenId != null);
const res = await fetch(`${API}/api/fiat/checkout`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ trackId: track.id, qty: 1 }) });
const d = await res.json();
console.log(JSON.stringify({ buyer: addr, trackId: track.id, tokenId: track.chainTokenId, url: d.url || null, error: d.error || null }));
await prisma.$disconnect();
