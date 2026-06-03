const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  const Music = await hre.ethers.getContractFactory("TresrzMusic");
  const music = await Music.deploy(feeRecipient);
  await music.waitForDeployment();

  const addr = await music.getAddress();
  console.log("TresrzMusic deployed:", addr);
  console.log("\nAdd to frontend/.env.local:\n  NEXT_PUBLIC_MUSIC_CONTRACT=" + addr);
}
main().catch((e) => { console.error(e); process.exit(1); });
