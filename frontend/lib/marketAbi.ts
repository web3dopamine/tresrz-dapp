// Minimal ABI for TresrzMarketplace (secondary market: listings + offers).
export const marketAbi = [
  // --- listings ---
  { type: "function", name: "list", stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "qty", type: "uint64" },
      { name: "pricePerUnit", type: "uint96" },
    ], outputs: [{ name: "listingId", type: "uint256" }] },
  { type: "function", name: "updateListing", stateMutability: "nonpayable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "qty", type: "uint64" },
      { name: "pricePerUnit", type: "uint96" },
    ], outputs: [] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "payable",
    inputs: [{ name: "listingId", type: "uint256" }, { name: "qty", type: "uint64" }], outputs: [] },
  { type: "function", name: "listings", stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "qty", type: "uint64" },
      { name: "pricePerUnit", type: "uint96" },
      { name: "active", type: "bool" },
    ] },
  { type: "function", name: "nextListingId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },

  // --- offers ---
  { type: "function", name: "makeOffer", stateMutability: "payable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "qty", type: "uint64" },
      { name: "pricePerUnit", type: "uint96" },
    ], outputs: [{ name: "offerId", type: "uint256" }] },
  { type: "function", name: "cancelOffer", stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }], outputs: [] },
  { type: "function", name: "acceptOffer", stateMutability: "nonpayable",
    inputs: [{ name: "offerId", type: "uint256" }], outputs: [] },
  { type: "function", name: "offers", stateMutability: "view",
    inputs: [{ name: "offerId", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "qty", type: "uint64" },
      { name: "pricePerUnit", type: "uint96" },
      { name: "escrow", type: "uint256" },
      { name: "active", type: "bool" },
    ] },
  { type: "function", name: "nextOfferId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },

  // --- admin / config (read by the admin dashboard) ---
  { type: "function", name: "platformFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "feeRecipient", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "setPlatformFee", stateMutability: "nonpayable", inputs: [{ name: "bps", type: "uint16" }], outputs: [] },
  { type: "function", name: "setFeeRecipient", stateMutability: "nonpayable", inputs: [{ name: "r", type: "address" }], outputs: [] },

  // --- events ---
  { type: "event", name: "Listed", inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "qty", type: "uint64", indexed: false },
      { name: "pricePerUnit", type: "uint96", indexed: false }] },
  { type: "event", name: "Sale", inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
      { name: "royalty", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false }] },
  { type: "event", name: "OfferMade", inputs: [
      { name: "offerId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "qty", type: "uint64", indexed: false },
      { name: "pricePerUnit", type: "uint96", indexed: false }] },
  { type: "event", name: "OfferAccepted", inputs: [
      { name: "offerId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "qty", type: "uint64", indexed: false },
      { name: "paid", type: "uint256", indexed: false },
      { name: "royalty", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false }] },
] as const;

export const MARKET_CONTRACT = (process.env.NEXT_PUBLIC_MARKET_CONTRACT || "0x0000000000000000000000000000000000000000") as `0x${string}`;
