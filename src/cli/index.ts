#!/usr/bin/env node
import { Command } from "commander";
import * as dotenv from "dotenv";
import chalk from "chalk";
import { StorageService } from "../services/StorageService";
import { MintService } from "../services/MintService";
import { MarketplaceService } from "../services/MarketplaceService";
import { Web3Service } from "../web3/Web3Service";
import {
  printNFT,
  printNFTTable,
  printTransactionTable,
  printUser,
  success,
  error,
  info,
} from "./display";

dotenv.config();

// ── Bootstrap ──────────────────────────────────────────────────────────────

const storage = new StorageService();
const minter  = new MintService(storage);
const market  = new MarketplaceService(storage);

function getWeb3(): Web3Service {
  const rpc      = process.env.RPC_URL;
  const key      = process.env.PRIVATE_KEY;
  const contract = process.env.NFT_CONTRACT_ADDRESS;
  if (!rpc || !key || !contract) {
    throw new Error(
      "On-chain mode requires RPC_URL, PRIVATE_KEY, and NFT_CONTRACT_ADDRESS in .env"
    );
  }
  return new Web3Service(rpc, key, contract, storage);
}

function isOnChain(): boolean {
  const mode = process.env.BOT_MODE ?? "simulation";
  return mode !== "simulation";
}

// ── CLI root ────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("nft-bot")
  .description(
    chalk.cyan("NFT Seller Bot") +
    " — mint, list and trade NFTs in simulation or on-chain mode.\n" +
    chalk.dim("  Set BOT_MODE=simulation (default) | local | sepolia | polygon_amoy")
  )
  .version("1.0.0");

// ── mint ────────────────────────────────────────────────────────────────────

program
  .command("mint")
  .description("Mint a new NFT (price is auto-calculated based on supply)")
  .requiredOption("-n, --name <name>", "NFT name")
  .requiredOption("-d, --desc <description>", "NFT description")
  .requiredOption("-i, --image <url>", "Image URL or IPFS URI")
  .option("-o, --owner <address>", "Owner address / username", "alice")
  .option("-a, --attributes <json>", "JSON array of attributes, e.g. '[{\"trait_type\":\"Rarity\",\"value\":\"Legendary\"}]'", "[]")
  .option("--uri <metadataUri>", "Metadata URI (on-chain mode only)")
  .action(async (opts) => {
    try {
      let attributes = [];
      try { attributes = JSON.parse(opts.attributes); } catch {
        error("--attributes must be valid JSON array"); process.exit(1);
      }

      if (isOnChain()) {
        const web3 = getWeb3();
        if (!opts.uri) { error("--uri <metadataUri> is required for on-chain minting"); process.exit(1); }
        console.log(chalk.dim("  Sending mint transaction…"));
        const nft = await web3.mint({
          name: opts.name,
          description: opts.desc,
          image: opts.image,
          attributes,
          metadataUri: opts.uri,
        });
        success(`Minted on-chain! Token #${nft.tokenId} tx: ${nft.mintTxHash}`);
        printNFT(nft);
      } else {
        const nft = minter.mint({
          name: opts.name,
          description: opts.desc,
          image: opts.image,
          attributes,
          owner: opts.owner,
        });
        success(`Minted NFT #${nft.tokenId} — auto-price: ${nft.price} ${nft.currency}`);
        printNFT(nft);
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── batch-mint ──────────────────────────────────────────────────────────────

program
  .command("batch-mint")
  .description("Batch mint NFTs from a JSON file")
  .requiredOption("-f, --file <path>", "Path to JSON file with array of mint options")
  .option("-o, --owner <address>", "Owner for all NFTs (simulation only)", "alice")
  .action(async (opts) => {
    const fs = await import("fs");
    try {
      const raw = fs.readFileSync(opts.file, "utf-8");
      const items = JSON.parse(raw);
      if (!Array.isArray(items)) { error("File must contain a JSON array"); process.exit(1); }

      if (isOnChain()) {
        const web3 = getWeb3();
        console.log(chalk.dim(`  Sending batch mint for ${items.length} NFTs…`));
        const nfts = await web3.batchMint(items);
        success(`Batch minted ${nfts.length} NFTs on-chain`);
        printNFTTable(nfts, "Batch Minted NFTs");
      } else {
        const nfts = minter.batchMint(items.map((i: Record<string, unknown>) => ({ ...i, owner: (i.owner as string) ?? opts.owner })) as import("../services/MintService").MintOptions[]);
        success(`Batch minted ${nfts.length} NFTs`);
        printNFTTable(nfts, "Batch Minted NFTs");
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── list ────────────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List an NFT for sale")
  .requiredOption("-t, --token <tokenId>", "Token ID to list", parseInt)
  .requiredOption("-p, --price <price>", "Sale price (ETH or SIM)")
  .option("-s, --seller <address>", "Seller address / username", "alice")
  .action(async (opts) => {
    try {
      if (isOnChain()) {
        const web3 = getWeb3();
        const hash = await web3.listForSale(opts.token, opts.price);
        success(`Listed token #${opts.token} at ${opts.price} ETH (tx: ${hash})`);
      } else {
        const nft = storage.getNFTByTokenId(opts.token);
        if (!nft) { error(`Token #${opts.token} not found`); process.exit(1); }
        market.list(nft.id, opts.seller, opts.price);
        success(`Listed "${nft.name}" (#${opts.token}) for ${opts.price} ${nft.currency}`);
        printNFT(storage.getNFTById(nft.id)!);
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── delist ───────────────────────────────────────────────────────────────────

program
  .command("delist")
  .description("Remove an NFT from sale")
  .requiredOption("-t, --token <tokenId>", "Token ID to delist", parseInt)
  .option("-o, --owner <address>", "Owner address / username", "alice")
  .action(async (opts) => {
    try {
      if (isOnChain()) {
        const web3 = getWeb3();
        const hash = await web3.delist(opts.token);
        success(`Delisted token #${opts.token} (tx: ${hash})`);
      } else {
        const nft = storage.getNFTByTokenId(opts.token);
        if (!nft) { error(`Token #${opts.token} not found`); process.exit(1); }
        market.delist(nft.id, opts.owner);
        success(`Delisted "${nft.name}" (#${opts.token})`);
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── buy ───────────────────────────────────────────────────────────────────────

program
  .command("buy")
  .description("Purchase a listed NFT. 50% of the price is distributed to all current holders")
  .requiredOption("-t, --token <tokenId>", "Token ID to buy", parseInt)
  .option("-b, --buyer <address>", "Buyer address / username (simulation only)", "bob")
  .action(async (opts) => {
    try {
      if (isOnChain()) {
        const web3 = getWeb3();
        const listing = await web3.getListing(opts.token);
        console.log(chalk.dim(`  Buying token #${opts.token} for ${listing.priceEth} ETH…`));
        const hash = await web3.buy(opts.token);
        success(`Purchased token #${opts.token} (tx: ${hash})`);
      } else {
        const nft = storage.getNFTByTokenId(opts.token);
        if (!nft) { error(`Token #${opts.token} not found`); process.exit(1); }
        const result = market.buy(nft.id, opts.buyer);
        success(
          `${opts.buyer} bought "${result.nft.name}" (#${opts.token}) for ${result.salePrice} ${result.nft.currency}\n` +
          `  Dividend paid to ${result.dividendRecipients} holder(s): ${result.dividendPerHolder} ${result.nft.currency} each`
        );
        printNFT(storage.getNFTById(nft.id)!);
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── transfer ─────────────────────────────────────────────────────────────────

program
  .command("transfer")
  .description("Transfer an NFT to another address (no sale)")
  .requiredOption("-t, --token <tokenId>", "Token ID to transfer", parseInt)
  .requiredOption("--to <address>", "Recipient address / username")
  .option("-f, --from <address>", "Sender address / username", "alice")
  .action(async (opts) => {
    try {
      const nft = storage.getNFTByTokenId(opts.token);
      if (!nft) { error(`Token #${opts.token} not found`); process.exit(1); }
      market.transfer(nft.id, opts.from, opts.to);
      success(`Transferred "#${opts.token}" from ${opts.from} to ${opts.to}`);
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── marketplace ────────────────────────────────────────────────────────────────

program
  .command("marketplace")
  .description("Show all NFTs currently listed for sale")
  .action(() => {
    const listed = market.getMarketplace();
    if (listed.length === 0) {
      info("No NFTs are currently listed for sale.");
    } else {
      printNFTTable(listed, `Marketplace — ${listed.length} listing(s)`);
    }
  });

// ── inventory ──────────────────────────────────────────────────────────────────

program
  .command("inventory")
  .description("Show NFTs owned by an address")
  .option("-o, --owner <address>", "Owner address / username", "alice")
  .action((opts) => {
    const nfts = market.getInventory(opts.owner);
    const user = market.getUser(opts.owner);
    if (user) printUser(user);
    if (nfts.length === 0) {
      info(`${opts.owner} does not own any NFTs.`);
    } else {
      printNFTTable(nfts, `${opts.owner}'s Inventory — ${nfts.length} NFT(s)`);
    }
  });

// ── view ───────────────────────────────────────────────────────────────────────

program
  .command("view")
  .description("View details of a single NFT")
  .requiredOption("-t, --token <tokenId>", "Token ID", parseInt)
  .action(async (opts) => {
    try {
      let nft = storage.getNFTByTokenId(opts.token);
      if (isOnChain()) {
        const web3 = getWeb3();
        const listing = await web3.getListing(opts.token);
        if (nft && listing.active) {
          nft.price = listing.priceEth;
          nft.status = "listed";
        }
      }
      if (!nft) { error(`Token #${opts.token} not found in local DB`); process.exit(1); }
      printNFT(nft);
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── all ──────────────────────────────────────────────────────────────────────

program
  .command("all")
  .description("List all NFTs in the database")
  .action(() => {
    const nfts = storage.getAllNFTs();
    if (nfts.length === 0) {
      info("No NFTs minted yet. Run: nft-bot mint -n 'My NFT' -d 'desc' -i 'http://...'");
    } else {
      printNFTTable(nfts, `All NFTs — ${nfts.length} total`);
    }
  });

// ── history ───────────────────────────────────────────────────────────────────

program
  .command("history")
  .description("Show transaction history")
  .action(() => {
    const txs = storage.getAllTransactions();
    printTransactionTable(txs);
  });

// ── account ───────────────────────────────────────────────────────────────────

program
  .command("account")
  .description("Show account/wallet info")
  .option("-a, --address <address>", "Address / username to inspect", "alice")
  .action(async (opts) => {
    try {
      if (isOnChain()) {
        const web3 = getWeb3();
        const addr = web3.walletAddress;
        const balance = await web3.getBalance();
        const network = await web3.getNetwork();
        const total = await web3.getTotalMinted();
        console.log();
        console.log(chalk.bold.cyan("  ┌─ Wallet ───────────────────────────────────────"));
        console.log(`  │  Address  : ${chalk.yellow(addr)}`);
        console.log(`  │  Balance  : ${chalk.green(`${balance} ETH`)}`);
        console.log(`  │  Network  : ${chalk.dim(network)}`);
        console.log(`  │  Total    : ${total} NFTs minted on-chain`);
        console.log(chalk.bold.cyan("  └───────────────────────────────────────────────"));
        console.log();
      } else {
        const user = market.getUser(opts.address);
        if (!user) {
          info(`No account found for "${opts.address}". Mint an NFT to create one.`);
        } else {
          printUser(user);
        }
      }
    } catch (e: unknown) {
      error((e as Error).message);
      process.exit(1);
    }
  });

// ── price-curve ───────────────────────────────────────────────────────────────

program
  .command("price-curve")
  .description("Show the price curve: how much each future token will cost")
  .option("-c, --count <n>", "How many upcoming tokens to preview", "10")
  .action((opts) => {
    const settings = storage.getSettings();
    const next = settings.nextTokenId;
    const count = parseInt(opts.count);
    console.log();
    console.log(chalk.bold.cyan("  Price Curve (simulation mode)"));
    console.log(chalk.dim("  Formula: price = BASE_PRICE + (tokenId - 1) × STEP\n"));
    for (let i = 0; i < count; i++) {
      const id = next + i;
      const price = MintService.priceForToken(id);
      const bar = "█".repeat(Math.min(Math.round(price * 2), 40));
      console.log(
        `  Token #${String(id).padStart(4, " ")} → ${chalk.green(`${price.toFixed(2)} SIM`)}  ${chalk.dim(bar)}`
      );
    }
    console.log();
  });

// ── reset ──────────────────────────────────────────────────────────────────────

program
  .command("reset")
  .description("Reset the simulation database (IRREVERSIBLE)")
  .option("--confirm", "Skip the confirmation prompt")
  .action(async (opts) => {
    if (!opts.confirm) {
      error("Pass --confirm to reset the database. This will delete all simulation data.");
      process.exit(1);
    }
    storage.reset();
    success("Simulation database has been reset.");
  });

// ── Parse ───────────────────────────────────────────────────────────────────

program.parse(process.argv);
