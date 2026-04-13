import { v4 as uuidv4 } from "uuid";
import { NFT, NFTAttribute } from "../models/NFT";
import { Transaction } from "../models/Transaction";
import { User } from "../models/User";
import { StorageService } from "./StorageService";

// ── Price curve ────────────────────────────────────────────────────────────
// Each successive token is more expensive.
// Formula: price = BASE_PRICE + (tokenId - 1) × STEP
//   Token #1  → 1.00 SIM
//   Token #2  → 1.50 SIM
//   Token #10 → 5.50 SIM
//   Token #100 → 50.50 SIM
const BASE_PRICE = 1.0;   // SIM
const STEP       = 0.5;   // SIM per token

export interface MintOptions {
  name: string;
  description: string;
  image: string;
  attributes?: NFTAttribute[];
  owner: string;
  currency?: string;
  metadataUri?: string;
}

export class MintService {
  constructor(private storage: StorageService) {}

  /**
   * Calculate the mint price for a given token ID.
   * Publicly accessible so the CLI "price-curve" command can use it.
   */
  static priceForToken(tokenId: number): number {
    return BASE_PRICE + (tokenId - 1) * STEP;
  }

  /**
   * Mint an NFT in simulation mode.
   * Price is auto-set based on the token ID — each new NFT costs more.
   * The NFT is immediately listed at its mint price.
   */
  mint(opts: MintOptions): NFT {
    const tokenId = this.storage.nextTokenId();
    const price   = MintService.priceForToken(tokenId);
    const now     = new Date().toISOString();

    const nft: NFT = {
      id: uuidv4(),
      tokenId,
      name: opts.name,
      description: opts.description,
      image: opts.image,
      attributes: opts.attributes ?? [],
      owner: opts.owner,
      creator: opts.owner,
      price: price.toFixed(4),
      currency: opts.currency ?? "SIM",
      status: "listed",    // Listed immediately at mint price
      mintedAt: now,
      listedAt: now,
      metadataUri: opts.metadataUri,
    };

    this.storage.saveNFT(nft);

    // Ensure owner record exists
    let user = this.storage.getUserByAddress(opts.owner);
    if (!user) {
      user = this.createUser(opts.owner);
    }
    if (!user.nftIds.includes(nft.id)) {
      user.nftIds.push(nft.id);
      this.storage.saveUser(user);
    }

    // Record transaction
    const tx: Transaction = {
      id: uuidv4(),
      type: "mint",
      nftId: nft.id,
      nftName: nft.name,
      from: opts.owner,
      price: nft.price,
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return nft;
  }

  /**
   * Batch mint multiple NFTs at once.
   */
  batchMint(items: MintOptions[]): NFT[] {
    return items.map((item) => this.mint(item));
  }

  private createUser(address: string): User {
    const user: User = {
      address,
      balance: "1000.0",  // Starting balance in simulation
      nftIds: [],
      createdAt: new Date().toISOString(),
    };
    this.storage.saveUser(user);
    return user;
  }

  /**
   * Build an OpenSea-compatible metadata JSON object.
   */
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
