// Deploy the upgraded TresrzMusic (with setPrice/batchSetPrice) + a matching
// TresrzMarketplace (its `nft` ref is immutable, so it must be redeployed too).
// Uses the platform delivery wallet so it is both owner and on-chain artist,
// exactly like the current deployment.
import "dotenv/config";
import fs from "fs";
import { createWalletClient, createPublicClient, http, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const artifacts = JSON.parse(fs.readFileSync("./tresrz_artifacts.json", "utf8"));
const RPC = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
const account = privateKeyToAccount(process.env.DELIVERY_PRIVATE_KEY);

const chain = defineChain({
  id: CHAIN_ID, name: "sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const FEE_RECIPIENT = account.address; // same as the old contract

async function deploy(name, { abi, bytecode }, args) {
  console.log(`deploying ${name}…`);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (rc.status !== "success") throw new Error(`${name} deploy reverted`);
  console.log(`  ${name} -> ${rc.contractAddress}  (gas ${rc.gasUsed})`);
  return rc.contractAddress;
}

const before = await pub.getBalance({ address: account.address });
console.log("deployer:", account.address, formatEther(before), "ETH");

const music = await deploy("TresrzMusic", artifacts.music, [FEE_RECIPIENT]);
const market = await deploy("TresrzMarketplace", artifacts.market, [music, FEE_RECIPIENT]);

// sanity: the new contract must expose the price setter
const hasSetter = artifacts.music.abi.some((x) => x.name === "setPrice");
const nextId = await pub.readContract({ address: music, abi: artifacts.music.abi, functionName: "nextTrackId" });
console.log("setPrice present:", hasSetter, "| nextTrackId:", nextId.toString());

const after = await pub.getBalance({ address: account.address });
console.log("spent:", formatEther(before - after), "ETH | left:", formatEther(after), "ETH");

fs.writeFileSync("./deploy-v2.json", JSON.stringify({ music, market, feeRecipient: FEE_RECIPIENT, at: new Date().toISOString() }, null, 2));
console.log("\nMUSIC_CONTRACT=" + music);
console.log("MARKET_CONTRACT=" + market);
