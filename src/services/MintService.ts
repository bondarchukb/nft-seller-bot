import { v4 as uuidv4 } from "uuid";
import { NFT, NFTAttribute } from "../models/NFT";
import { Transaction } from "../models/Transaction";
import { User } from "../models/User";
import { StorageService } from "./StorageService";

// ── Mint fee (service fee) price curve ──────────────────────────────────────
//
// Minting an NFT is a paid service. The fee rises with each new token
// to reflect growing demand and to reward early adopters.
//
//   fee(tokenId) = BASE_FEE + (tokenId - 1) × FEE_STEP
//
//   Token #1  → 1.00 SIM   (early-adopter price)
//   Token #2  → 1.50 SIM
//   Token #10 → 5.50 SIM
//   Token #100 → 50.50 SIM
//
// On every mint, the fee is split:
//   50% → distributed equally to ALL existing NFT holders (dividend)
//   50% → platform revenue
//
// This creates a built-in viral incentive: every holder earns from every
// new mint, so existing owners are motivated to bring in new buyers.

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
  dividendPerHolder: string;
  dividendRecipients: number;
  platformFee: string;
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
   *   • 50% → divided equally among all EXISTING holders (paid immediately)
   *   • 50% → platform revenue
   *
   * The new NFT is NOT auto-listed. The owner decides if/when to sell it
   * and at what price — they are incentivised to do so because every
   * sale also earns all holders a dividend.
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

    // ── Snapshot existing holders BEFORE adding the new token ────────
    const allNFTs   = this.storage.getAllNFTs();
    const holderSet = new Set<string>();
    for (const n of allNFTs) {
      holderSet.add(n.owner.toLowerCase());
    }
    const holders      = Array.from(holderSet);
    const dividendPool = mintFee * DIVIDEND_SHARE;
    const platformCut  = mintFee * PLATFORM_SHARE;
    const dividendEach = holders.length > 0 ? dividendPool / holders.length : 0;

    // ── Distribute dividends to existing holders ─────────────────────
    if (dividendEach > 0) {
      for (const holderAddr of holders) {
        let holderUser = this.storage.getUserByAddress(holderAddr);
        if (!holderUser) {
          holderUser = this.createUser(holderAddr);
        }
        holderUser.balance = (parseFloat(holderUser.balance) + dividendEach).toFixed(4);
        this.storage.saveUser(holderUser);
      }
    } else {
      // No existing holders — full fee goes to platform
      // (already handled: platformCut accounts for the whole fee)
    }

    // ── Credit platform revenue ──────────────────────────────────────
    const settings = this.storage.getSettings();
    const newRevenue = parseFloat(settings.platformRevenue ?? "0") + (holders.length > 0 ? platformCut : mintFee);
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
      dividendPerHolder: dividendEach.toFixed(4),
      dividendRecipients: holders.length,
      platformFee: (holders.length > 0 ? platformCut : mintFee).toFixed(4),
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
