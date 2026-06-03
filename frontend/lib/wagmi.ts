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

export const config = getDefaultConfig({
  appName: "TRESRZ",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "demo",
  chains: [libertyChain, sepolia, mainnet],
  ssr: true,
});
