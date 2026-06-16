import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, sepolia } from "wagmi/chains";
import { defineChain } from "viem";

// Liberty Chain — Reth-based sovereign EVM L1, chainId 13370, zero-gas
export const libertyChain = defineChain({
  id: 13370,
  name: "Liberty Chain",
  nativeCurrency: { name: "Liberty", symbol: "LBRTY", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.libertychain.org"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.libertychain.org" } },
});

// Local hardhat node (chainId 31337). Used when deploying/developing against
// `npx hardhat node`. The contract in NEXT_PUBLIC_MUSIC_CONTRACT is deployed here.
export const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

// All chains the wallet may use. The one matching NEXT_PUBLIC_DEFAULT_CHAIN is put
// first so RainbowKit/wagmi selects it by default.
const allChains = [hardhatLocal, libertyChain, sepolia, mainnet] as const;
const defaultChainId = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN || hardhatLocal.id);

const ordered = [
  ...allChains.filter((c) => c.id === defaultChainId),
  ...allChains.filter((c) => c.id !== defaultChainId),
] as unknown as typeof allChains;

export const config = getDefaultConfig({
  appName: "TRESRZ",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "demo",
  chains: ordered,
  ssr: true,
});
