import { v4 as uuidv4 } from "uuid";
import { NFT, NFTAttribute } from "../models/NFT";
import { Transaction } from "../models/Transaction";
import { User } from "../models/User";
import { StorageService } from "./StorageService";

// ── Mint fee (service fee) price curve ──────────────────────────────────────
//
// Minting an NFT is a paid service. The fee rises with each new token.
//
//   fee(tokenId) = BASE_FEE + (tokenId - 1) × FEE_STEP
//
//   Token #1  → 1.00 SIM
//   Token #2  → 1.50 SIM
//   Token #10 → 5.50 SIM
//
// On every mint, the fee is split:
//   50% → distributed PROPORTIONALLY to all existing holders
//          (weighted by how many NFTs each address holds)
//   50% → platform revenue
//
// "Holders earn the most" — owning more NFTs means a larger share of every
// future mint fee AND every future sale dividend. Early, heavy holders
// are the most incentivised to market the collection.

const BASE_FEE = 1.0;    // SIM
const FEE_STEP = 0.5;    // SIM per additional token

// Platform keeps 50% of each mint fee
const PLATFORM_SHARE  = 0.5;
// Existing holders share the other 50%
const DIVIDEND_SHARE  = 0.5;

export interface MintOptions {
  name: string;
  description: string;
  image: string;
  attributes?: NFTAttribute[];
  owner: string;           // Who is paying for and receiving the NFT
  currency?: string;
  metadataUri?: string;
}

export interface MintResult {
  nft: NFT;
  mintFee: string;
  dividendPool: string;         // 50% of mint fee distributed to holders
  dividendPerToken: string;     // pool ÷ total existing supply
  totalSupplyBefore: number;    // existing NFT count before this mint
  uniqueHolders: number;        // number of distinct holder addresses
  platformFee: string;          // 50% of mint fee kept by platform
  generatedBy?: "llm" | "fallback";
}

export class MintService {
  constructor(private storage: StorageService) {}

  /**
   * Returns the mint service fee for a given token ID.
   */
  static feeForToken(tokenId: number): number {
    return BASE_FEE + (tokenId - 1) * FEE_STEP;
  }

  /** Alias kept for backward compat (CLI price-curve command). */
  static priceForToken(tokenId: number): number {
    return MintService.feeForToken(tokenId);
  }

  /**
   * Mint an NFT.
   *
   * The caller pays the mint service fee. The fee is split:
   *   • 50% → distributed PROPORTIONALLY to all existing holders
   *            (share = holder's NFT count / total existing supply)
   *   • 50% → platform revenue
   *
   * The new NFT is NOT auto-listed. The owner sets their own resale price.
   * "Holders earn the most" — the more NFTs an address holds, the larger
   * its share of every future dividend.
   */
  mint(opts: MintOptions): MintResult {
    const tokenId  = this.storage.nextTokenId();
    const mintFee  = MintService.feeForToken(tokenId);
    const now      = new Date().toISOString();

    // ── Charge the minting user ──────────────────────────────────────
    let minter = this.storage.getUserByAddress(opts.owner);
    if (!minter) {
      minter = this.createUser(opts.owner);
    }
    const minterBalance = parseFloat(minter.balance);
    if (minterBalance < mintFee) {
      throw new Error(
        `Insufficient balance to mint. Need ${mintFee.toFixed(4)} SIM, have ${minter.balance} SIM`
      );
    }
    minter.balance = (minterBalance - mintFee).toFixed(4);

    // ── Snapshot existing supply BEFORE adding the new token ─────────
    const allNFTs      = this.storage.getAllNFTs();
    const totalSupply  = allNFTs.length;          // existing tokens only
    const dividendPool = mintFee * DIVIDEND_SHARE;
    const platformCut  = mintFee * PLATFORM_SHARE;

    // ── Distribute proportionally by NFT count held ───────────────────
    // Build address → nft count map from existing supply
    const holdingsMap = new Map<string, number>();
    for (const n of allNFTs) {
      const addr = n.owner.toLowerCase();
      holdingsMap.set(addr, (holdingsMap.get(addr) ?? 0) + 1);
    }

    // dividendPerToken = dividendPool / totalSupply
    // each holder receives: dividendPerToken × their token count
    const dividendPerToken = totalSupply > 0 ? dividendPool / totalSupply : 0;

    if (dividendPerToken > 0) {
      for (const [holderAddr, count] of holdingsMap) {
        const share = dividendPerToken * count;
        let holderUser = this.storage.getUserByAddress(holderAddr);
        if (!holderUser) {
          holderUser = this.createUser(holderAddr);
        }
        holderUser.balance = (parseFloat(holderUser.balance) + share).toFixed(4);
        this.storage.saveUser(holderUser);
      }
    }

    // ── Credit platform revenue ──────────────────────────────────────
    const settings = this.storage.getSettings();
    const newRevenue = parseFloat(settings.platformRevenue ?? "0") + (totalSupply > 0 ? platformCut : mintFee);
    this.storage.updateSettings({ platformRevenue: newRevenue.toFixed(4) });

    // ── Create the NFT (unlisted — owner sets their own price) ───────
    const nft: NFT = {
      id: uuidv4(),
      tokenId,
      name: opts.name,
      description: opts.description,
      image: opts.image,
      attributes: opts.attributes ?? [],
      owner: opts.owner,
      creator: opts.owner,
      currency: opts.currency ?? "SIM",
      status: "minted",
      mintedAt: now,
      metadataUri: opts.metadataUri,
    };

    this.storage.saveNFT(nft);

    // Add to minter's NFT list (balance was already debited above)
    if (!minter.nftIds.includes(nft.id)) {
      minter.nftIds.push(nft.id);
    }
    this.storage.saveUser(minter);

    // ── Record transaction ────────────────────────────────────────────
    const tx: Transaction = {
      id: uuidv4(),
      type: "mint",
      nftId: nft.id,
      nftName: nft.name,
      from: opts.owner,
      price: mintFee.toFixed(4),
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return {
      nft,
      mintFee: mintFee.toFixed(4),
      dividendPool: (totalSupply > 0 ? dividendPool : 0).toFixed(4),
      dividendPerToken: dividendPerToken.toFixed(6),
      totalSupplyBefore: totalSupply,
      uniqueHolders: holdingsMap.size,
      platformFee: (totalSupply > 0 ? platformCut : mintFee).toFixed(4),
    };
  }

  /**
   * Batch mint. Each token is individually priced (ascending curve).
   */
  batchMint(items: MintOptions[]): MintResult[] {
    return items.map((item) => this.mint(item));
  }

  private createUser(address: string): User {
    const user: User = {
      address,
      balance: "1000.0",
      nftIds: [],
      createdAt: new Date().toISOString(),
    };
    this.storage.saveUser(user);
    return user;
  }

  static buildMetadata(nft: NFT): object {
    return {
      name: nft.name,
      description: nft.description,
      image: nft.image,
      external_url: `https://nft-bot.example.com/nft/${nft.tokenId}`,
      attributes: nft.attributes,
    };
  }
}
