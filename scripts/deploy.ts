import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying NFTSellerToken…");
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance: ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  const factory = await ethers.getContractFactory("NFTSellerToken");
  const contract = await factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nNFTSellerToken deployed to:", address);

  // Print key contract parameters
  const basePrice = await contract.BASE_PRICE();
  const priceStep = await contract.PRICE_STEP();
  const maxSupply = await contract.MAX_SUPPLY();
  console.log("BASE_PRICE :", ethers.formatEther(basePrice), "ETH (first token)");
  console.log("PRICE_STEP :", ethers.formatEther(priceStep), "ETH per token");
  console.log("MAX_SUPPLY :", maxSupply.toString(), "tokens");
  console.log("DIVIDEND   : 50% of every sale distributed to all holders");

  // ── Write address to .env automatically ────────────────────────────────
  const envPath = path.resolve(process.cwd(), ".env");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

  if (envContent.includes("NFT_CONTRACT_ADDRESS=")) {
    envContent = envContent.replace(
      /NFT_CONTRACT_ADDRESS=.*/,
      `NFT_CONTRACT_ADDRESS=${address}`
    );
  } else {
    envContent += `\nNFT_CONTRACT_ADDRESS=${address}\n`;
  }
  fs.writeFileSync(envPath, envContent);
  console.log("\n.env updated with NFT_CONTRACT_ADDRESS =", address);

  // ── Verify hint ────────────────────────────────────────────────────────
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n) {
    console.log("\nTo verify on Etherscan / Polygonscan:");
    console.log(
      `  npx hardhat verify --network ${network.name} ${address} "${deployer.address}"`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
