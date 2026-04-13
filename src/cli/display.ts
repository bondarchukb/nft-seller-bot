import chalk from "chalk";
import { table } from "table";
import { NFT } from "../models/NFT";
import { Transaction } from "../models/Transaction";
import { User } from "../models/User";

// ── Formatters ─────────────────────────────────────────────────────────────

export function statusBadge(status: NFT["status"]): string {
  switch (status) {
    case "listed":     return chalk.green("● LISTED");
    case "sold":       return chalk.gray("✓ SOLD");
    case "transferred":return chalk.blue("→ TRANSFERRED");
    default:           return chalk.yellow("○ MINTED");
  }
}

export function printNFT(nft: NFT): void {
  console.log();
  console.log(chalk.bold.cyan(`  ┌─ NFT #${nft.tokenId} ─────────────────────────────────`));
  console.log(chalk.bold(`  │  ${nft.name}`));
  console.log(chalk.dim(`  │  ${nft.description}`));
  console.log(`  │  Status   : ${statusBadge(nft.status)}`);
  console.log(`  │  Owner    : ${chalk.yellow(nft.owner)}`);
  console.log(`  │  Creator  : ${chalk.dim(nft.creator)}`);
  if (nft.price) {
    console.log(`  │  Price    : ${chalk.green(`${nft.price} ${nft.currency}`)}`);
  }
  console.log(`  │  Image    : ${chalk.dim(nft.image)}`);
  if (nft.metadataUri) {
    console.log(`  │  Metadata : ${chalk.dim(nft.metadataUri)}`);
  }
  if (nft.mintTxHash) {
    console.log(`  │  Mint tx  : ${chalk.dim(nft.mintTxHash)}`);
  }
  if (nft.saleTxHash) {
    console.log(`  │  Sale tx  : ${chalk.dim(nft.saleTxHash)}`);
  }
  if (nft.attributes.length > 0) {
    console.log(`  │  Traits   :`);
    nft.attributes.forEach((a) => {
      console.log(`  │    ${chalk.dim(a.trait_type)}: ${chalk.white(String(a.value))}`);
    });
  }
  console.log(`  │  Minted   : ${chalk.dim(new Date(nft.mintedAt).toLocaleString())}`);
  console.log(`  │  ID       : ${chalk.dim(nft.id)}`);
  console.log(chalk.bold.cyan(`  └───────────────────────────────────────────────`));
  console.log();
}

export function printNFTTable(nfts: NFT[], title: string): void {
  if (nfts.length === 0) {
    console.log(chalk.dim(`  (no NFTs found)`));
    return;
  }

  const headers = [
    chalk.bold("#"),
    chalk.bold("Name"),
    chalk.bold("Status"),
    chalk.bold("Owner"),
    chalk.bold("Price"),
    chalk.bold("Minted"),
  ];

  const rows = nfts.map((nft) => [
    chalk.cyan(String(nft.tokenId ?? "-")),
    nft.name.substring(0, 28),
    statusBadge(nft.status),
    shortenAddress(nft.owner),
    nft.price ? chalk.green(`${nft.price} ${nft.currency}`) : chalk.dim("—"),
    chalk.dim(new Date(nft.mintedAt).toLocaleDateString()),
  ]);

  console.log();
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(table([headers, ...rows], {
    border: {
      topBody: "─", topJoin: "┬", topLeft: "  ┌", topRight: "┐",
      bottomBody: "─", bottomJoin: "┴", bottomLeft: "  └", bottomRight: "┘",
      bodyLeft: "  │", bodyRight: "│", bodyJoin: "│",
      joinBody: "─", joinLeft: "  ├", joinRight: "┤", joinJoin: "┼",
    },
    columns: { 3: { width: 20 } },
  }));
}

export function printTransactionTable(txs: Transaction[]): void {
  if (txs.length === 0) {
    console.log(chalk.dim("  (no transactions yet)"));
    return;
  }

  const headers = [
    chalk.bold("Type"),
    chalk.bold("NFT"),
    chalk.bold("From"),
    chalk.bold("To"),
    chalk.bold("Price"),
    chalk.bold("Time"),
  ];

  const typeColor: Record<string, (s: string) => string> = {
    mint: (s) => chalk.yellow(s),
    list: (s) => chalk.blue(s),
    delist: (s) => chalk.dim(s),
    sale: (s) => chalk.green(s),
    transfer: (s) => chalk.cyan(s),
  };

  const rows = txs
    .slice()
    .reverse()
    .slice(0, 20)
    .map((tx) => [
      (typeColor[tx.type] ?? chalk.white)(tx.type.toUpperCase()),
      tx.nftName.substring(0, 20),
      shortenAddress(tx.from),
      tx.to ? shortenAddress(tx.to) : chalk.dim("—"),
      tx.price ? chalk.green(`${tx.price} ${tx.currency}`) : chalk.dim("—"),
      chalk.dim(new Date(tx.timestamp).toLocaleString()),
    ]);

  console.log();
  console.log(chalk.bold.cyan("  Transaction History (last 20)"));
  console.log(table([headers, ...rows], {
    border: {
      topBody: "─", topJoin: "┬", topLeft: "  ┌", topRight: "┐",
      bottomBody: "─", bottomJoin: "┴", bottomLeft: "  └", bottomRight: "┘",
      bodyLeft: "  │", bodyRight: "│", bodyJoin: "│",
      joinBody: "─", joinLeft: "  ├", joinRight: "┤", joinJoin: "┼",
    },
  }));
}

export function printUser(user: User): void {
  console.log();
  console.log(chalk.bold.cyan("  ┌─ Account ─────────────────────────────────────"));
  console.log(`  │  Address : ${chalk.yellow(user.address)}`);
  if (user.username) console.log(`  │  Name    : ${user.username}`);
  console.log(`  │  Balance : ${chalk.green(`${user.balance} SIM`)}`);
  console.log(`  │  NFTs    : ${user.nftIds.length}`);
  console.log(`  │  Since   : ${chalk.dim(new Date(user.createdAt).toLocaleDateString())}`);
  console.log(chalk.bold.cyan("  └───────────────────────────────────────────────"));
  console.log();
}

export interface PlatformStats {
  totalMinted: number;
  listedNow: number;
  uniqueHolders: number;
  totalUsers: number;
  salesCount: number;
  totalVolume: string;
  platformRevenue: string;
  nextMintFee: string;
  nextTokenId: number;
}

export function printStats(s: PlatformStats): void {
  console.log();
  console.log(chalk.bold.cyan("  ┌─ Platform Statistics ───────────────────────────"));
  console.log(`  │`);
  console.log(`  │  NFTs minted         : ${chalk.yellow(String(s.totalMinted))}`);
  console.log(`  │  Currently listed    : ${chalk.green(String(s.listedNow))}`);
  console.log(`  │  Unique holders      : ${chalk.cyan(String(s.uniqueHolders))}`);
  console.log(`  │  Registered users    : ${chalk.dim(String(s.totalUsers))}`);
  console.log(`  │`);
  console.log(`  │  Total sales         : ${chalk.yellow(String(s.salesCount))}`);
  console.log(`  │  Total sale volume   : ${chalk.green(`${s.totalVolume} SIM`)}`);
  console.log(`  │  Platform revenue    : ${chalk.blue(`${s.platformRevenue} SIM`)}`);
  console.log(`  │`);
  console.log(`  │  Next token ID       : #${chalk.white(String(s.nextTokenId))}`);
  console.log(`  │  Next mint fee       : ${chalk.yellow(`${s.nextMintFee} SIM`)}`);
  console.log(`  │    └─ holder dividend: ${chalk.green(`${(parseFloat(s.nextMintFee) * 0.5).toFixed(4)} SIM`)} split among ${s.uniqueHolders} holder(s)`);
  console.log(`  │    └─ platform cut  : ${chalk.blue(`${(parseFloat(s.nextMintFee) * 0.5).toFixed(4)} SIM`)}`);
  console.log(`  │`);
  console.log(chalk.bold.cyan("  └───────────────────────────────────────────────"));
  console.log();
}

export function success(msg: string): void {
  console.log(chalk.green(`\n  ✓ ${msg}\n`));
}

export function error(msg: string): void {
  console.error(chalk.red(`\n  ✗ ${msg}\n`));
}

export function info(msg: string): void {
  console.log(chalk.dim(`\n  ℹ ${msg}\n`));
}

function shortenAddress(addr: string): string {
  if (addr.startsWith("0x") && addr.length === 42) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  return addr.length > 16 ? `${addr.slice(0, 14)}…` : addr;
}
