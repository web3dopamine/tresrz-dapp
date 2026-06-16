require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, LIBERTY_RPC = "https://rpc.libertychain.org", SEPOLIA_RPC } = process.env;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

module.exports = {
  // evmVersion pinned to cancun: OpenZeppelin v5.6 emits the `mcopy` opcode, which
  // solc 0.8.24 only enables on the cancun target (its default is shanghai).
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  networks: {
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337, accounts },
    // Liberty Chain (Reth-based sovereign EVM L1, chainId 13370, zero-gas)
    liberty: { url: LIBERTY_RPC, chainId: 13370, accounts, gasPrice: 0 },
    sepolia: { url: SEPOLIA_RPC || "", chainId: 11155111, accounts }
  }
};
