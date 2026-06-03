// Minimal ABI for TresrzMusic interactions used by the frontend
export const musicAbi = [
  { type: "function", name: "mintTrack", stateMutability: "nonpayable",
    inputs: [
      { name: "maxSupply", type: "uint64" },
      { name: "price", type: "uint96" },
      { name: "royaltyBps", type: "uint96" },
      { name: "metadataUri", type: "string" },
    ], outputs: [{ name: "trackId", type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "payable",
    inputs: [{ name: "trackId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "editionsLeft", stateMutability: "view",
    inputs: [{ name: "trackId", type: "uint256" }], outputs: [{ type: "uint64" }] },
  { type: "event", name: "TrackPurchased", inputs: [
      { name: "trackId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false }] },
] as const;

export const MUSIC_CONTRACT = (process.env.NEXT_PUBLIC_MUSIC_CONTRACT || "0x0000000000000000000000000000000000000000") as `0x${string}`;
