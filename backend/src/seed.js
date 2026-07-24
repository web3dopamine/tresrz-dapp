import "dotenv/config";
import { prisma } from "./db.js";
import { createWalletClient, createPublicClient, http, parseEther, parseEventLogs, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const E = (n) => parseEther(String(n)).toString(); // ETH -> wei string

// Deterministic hardhat dev accounts (publicly known — local use only). Each seed
// artist mints from its own account so on-chain `artist` matches the DB artist.
const ARTIST_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];
const HANDLES = ["BLOCKJ4NE", "Charlie", "The_Account", "TwoSpiral", "GordieDean", "Adeline_Yeo"];
// Artist profiles (shown on /artist/[address]) — matched to the genres each one mints.
const BIOS = [
  "Synthwave architect and jazz dropout from the neon side of the grid. BLOCKJ4NE builds widescreen analog dreams — chrome arpeggios one night, smoke-filled piano rooms the next.",
  "House selector with a trap heart. Charlie chases the 3am warehouse feeling and bottles it — rolling basslines, hands-in-the-air drops, and grit when you least expect it.",
  "Ambient cartographer turned phonk experimentalist. The_Account maps the quiet between beats, then floods it with distortion. Music for empty highways and full minds.",
  "Techno purist and drill agitator. TwoSpiral works in loops that tighten until they snap — hypnotic, mechanical, and built for rooms with no windows.",
  "Dub craftsman. One track, one edition, no compromises. GordieDean carves heavyweight low-end and cavernous echo — sound-system music for the blockchain age.",
  "Lo-fi composer and late-night romantic. Adeline_Yeo presses warmth into tape hiss — dusty keys, soft drums, and the kind of melody you hum without noticing.",
];

// Real, genre-matched audio for every track — Creative-Commons / royalty-free pieces
// hosted on archive.org (verified hotlinkable: HTTP 200 audio/mpeg from any origin, no
// Referer restriction). Each track gets its own fitting track; none are left empty.
const tracks = [
  { title: "NEON PULSE", genre: "SYNTHWAVE", price: 0.47, max: 14, hot: true, royaltyPct: 5,
    audio: "https://archive.org/download/retro-promenade_202011/Retro%20Promenade/%5BRP-TS001%5D%20Time%20Slap%20Podcast%20Trailers%20-%20Season%201%20%282014%29/01.%20001%20The%20Chrome%20Warrior%20Vendetta.mp3" },
  { title: "Remore", genre: "HOUSE", price: 1.97, max: 1, hot: true, royaltyPct: 7,
    audio: "https://archive.org/download/rest037-kay_grove_-_samba_440-night_walk/rest037-01-kay_grove_-_samba440_vbr.mp3" },
  { title: "AWAKENING", genre: "AMBIENT", price: 3.8, max: 33, hot: true, royaltyPct: 4,
    audio: "https://archive.org/download/pcr089EmilDavydov-Sketches/pcr089_01_emil_davydov_sketch_no1.mp3" },
  { title: "Two Spirals", genre: "TECHNO", price: 0.85, max: 5, hot: true, royaltyPct: 6,
    audio: "https://archive.org/download/dig017_tromenia_ep/dig017_01_blurix_-_tromenia.mp3" },
  { title: "Dub Skull", genre: "DUB", price: 9.39, max: 1, hot: true, royaltyPct: 10,
    audio: "https://archive.org/download/DWK031/Aydio_-_02_-_Deltitnu.mp3" },
  { title: "After Hours", genre: "LO-FI", price: 0.3, max: 20, royaltyPct: 3,
    audio: "https://archive.org/download/DWK044/Lo-Fi_Scientists_-_01_-_Jazz_Baby_vbr.mp3" },
  { title: "Polychrome", genre: "JAZZ", price: 0.55, max: 8, royaltyPct: 5,
    audio: "https://archive.org/download/ca200_cjazz/101_Strings_Of_Consciousness__Asphodel.mp3" },
  { title: "Latin Tech", genre: "TRAP", price: 1.1, max: 12, royaltyPct: 5,
    audio: "https://archive.org/download/ariesbeatschilltrap/Aries_Beats_-_Chill_Trap.mp3" },
  { title: "Static Bloom", genre: "PHONK", price: 0.72, max: 6, royaltyPct: 5,
    audio: "https://archive.org/download/flames-by-shadxwfxre/FLAMES%20BY%20SHADXWFXRE.mp3" },
  { title: "Midnight Run", genre: "DRILL", price: 1.45, max: 9, royaltyPct: 5,
    audio: "https://archive.org/download/free-for-profit-central-cee-x-uk-drill-type-beat-tension/%28FREE%20FOR%20PROFIT%29%20UK%20Drill%20Type%20Beat%20SECRETS%20%20NY%20Drill%20Type%20Beat%20%20Free%20Drill%20instrumental%202023.mp3" },
];

const MINT_ABI = [
  { type: "function", name: "mintTrack", stateMutability: "nonpayable",
    inputs: [{ name: "maxSupply", type: "uint64" }, { name: "price", type: "uint96" }, { name: "royaltyBps", type: "uint96" }, { name: "metadataUri", type: "string" }],
    outputs: [{ name: "trackId", type: "uint256" }] },
  { type: "event", name: "TrackMinted", inputs: [
    { name: "trackId", type: "uint256", indexed: true }, { name: "artist", type: "address", indexed: true },
    { name: "maxSupply", type: "uint64", indexed: false }, { name: "price", type: "uint96", indexed: false }, { name: "uri", type: "string", indexed: false }] },
];

const CONTRACT = process.env.MUSIC_CONTRACT;
const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const onChain = !!CONTRACT;

const chain = defineChain({ id: 31337, name: "Hardhat", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const accounts = ARTIST_KEYS.map((k) => privateKeyToAccount(k));
const pub = onChain ? createPublicClient({ chain, transport: http(RPC) }) : null;

async function mintOnChain(artistIdx, t) {
  const account = accounts[artistIdx];
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const metadata = JSON.stringify({ name: t.title, genre: t.genre, coverSeed: t.coverSeed, audioUrl: t.audioUrl || null });
  const metadataUri = `data:application/json,${encodeURIComponent(metadata)}`;
  const hash = await wallet.writeContract({
    abi: MINT_ABI, address: CONTRACT, functionName: "mintTrack",
    args: [BigInt(t.max), parseEther(String(t.price)), BigInt(Math.round(t.royaltyPct * 100)), metadataUri],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const ev = parseEventLogs({ abi: MINT_ABI, eventName: "TrackMinted", logs: receipt.logs })[0];
  return { trackId: Number(ev.args.trackId), txHash: hash };
}

async function main() {
  console.log(`Seeding… (${onChain ? `on-chain via ${CONTRACT}` : "off-chain, no contract configured"})`);

  // Clean slate (artist addresses changed from placeholders to real hardhat accounts).
  await prisma.like.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.track.deleteMany();
  await prisma.user.deleteMany();

  const userIds = [];
  for (let i = 0; i < HANDLES.length; i++) {
    const u = await prisma.user.create({
      data: { address: accounts[i].address, handle: HANDLES[i], avatarSeed: i * 137 + 7, bio: BIOS[i] },
    });
    userIds.push(u.id);
  }

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    t.coverSeed = i * 53 + 11;
    t.audioUrl = t.audio;
    const artistIdx = i % HANDLES.length;
    let chainTokenId = null, txHash = null;
    if (onChain) {
      const r = await mintOnChain(artistIdx, t);
      chainTokenId = r.trackId;
      txHash = r.txHash;
      console.log(`  minted "${t.title}" -> tokenId ${chainTokenId}`);
    }
    await prisma.track.create({
      data: {
        title: t.title, genre: t.genre, priceWei: E(t.price), maxSupply: t.max,
        minted: 0, coverSeed: t.coverSeed, hot: !!t.hot, chainTokenId, txHash,
        audioUrl: t.audioUrl, artistId: userIds[artistIdx],
      },
    });
  }
  console.log("Done. Users:", userIds.length, "Tracks:", tracks.length, onChain ? "(all on-chain & buyable)" : "(off-chain demo)");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
