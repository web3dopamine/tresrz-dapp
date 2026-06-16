// Sanity-check: read state from a deployed TresrzMusic.
// Usage: ADDR=0x... npx hardhat run scripts/read.js --network localhost
const hre = require("hardhat");

async function main() {
  const addr = process.env.ADDR || process.env.NEXT_PUBLIC_MUSIC_CONTRACT;
  if (!addr) throw new Error("Set ADDR=<deployed address>");
  const music = await hre.ethers.getContractAt("TresrzMusic", addr);

  const nextTrackId = await music.nextTrackId();
  const feeBps = await music.platformFeeBps();
  const feeRecipient = await music.feeRecipient();
  console.log("Contract:       ", addr);
  console.log("nextTrackId:    ", nextTrackId.toString());
  console.log("platformFeeBps: ", feeBps.toString(), `(${Number(feeBps) / 100}%)`);
  console.log("feeRecipient:   ", feeRecipient);

  // editionsLeft for trackId 1 (0 until something is minted — proves the read path works)
  const left1 = await music.editionsLeft(1);
  console.log("editionsLeft(1):", left1.toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
