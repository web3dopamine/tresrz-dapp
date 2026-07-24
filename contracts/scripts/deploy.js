const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;

  const Music = await hre.ethers.getContractFactory("TresrzMusic");
  const music = await Music.deploy(feeRecipient);
  await music.waitForDeployment();
  const musicAddr = await music.getAddress();
  console.log("TresrzMusic deployed:", musicAddr);

  const Market = await hre.ethers.getContractFactory("TresrzMarketplace");
  const market = await Market.deploy(musicAddr, feeRecipient);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  console.log("TresrzMarketplace deployed:", marketAddr);

  console.log("\nAdd to frontend/.env.local:");
  console.log("  NEXT_PUBLIC_MUSIC_CONTRACT=" + musicAddr);
  console.log("  NEXT_PUBLIC_MARKET_CONTRACT=" + marketAddr);
  console.log("\nAdd to backend/.env:");
  console.log("  MUSIC_CONTRACT=" + musicAddr);
  console.log("  MARKET_CONTRACT=" + marketAddr);
}
main().catch((e) => { console.error(e); process.exit(1); });
