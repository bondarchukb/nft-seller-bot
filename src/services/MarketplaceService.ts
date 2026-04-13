import { v4 as uuidv4 } from "uuid";
import { NFT } from "../models/NFT";
import { Transaction } from "../models/Transaction";
import { StorageService } from "./StorageService";

// ── Secondary sale revenue split ───────────────────────────────────────────
//
// Business model: the platform earns from mint fees (handled in MintService).
// On secondary sales the platform takes NO cut — the full incentive goes to
// the community to encourage more trading:
//
//   50% of sale price → seller (reward for holding and pricing well)
//   50% of sale price → split equally among ALL current NFT holders
//                        (reward for marketing the collection)
//
// Because every sale pays dividends to all holders, every owner is
// economically motivated to bring in new buyers.
const SELLER_SHARE   = 0.5;
const DIVIDEND_SHARE = 0.5;

export class MarketplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceError";
  }
}

export interface BuyResult {
  nft: NFT;
  salePrice: string;
  sellerProceeds: string;      // 50% of sale price → seller
  dividendPerHolder: string;   // 50% ÷ holder count → each holder
  dividendRecipients: number;
}

export class MarketplaceService {
  constructor(private storage: StorageService) {}

  // ── Listing ───────────────────────────────────────────────────────────────

  list(nftId: string, seller: string, price: string): NFT {
    const nft = this.storage.getNFTById(nftId);
    if (!nft) throw new MarketplaceError(`NFT not found: ${nftId}`);
    if (nft.owner.toLowerCase() !== seller.toLowerCase()) {
      throw new MarketplaceError("Only the owner can list this NFT");
    }
    if (nft.status === "listed") {
      throw new MarketplaceError("NFT is already listed");
    }
    if (parseFloat(price) <= 0) {
      throw new MarketplaceError("Price must be greater than 0");
    }

    const now = new Date().toISOString();
    nft.price = price;
    nft.status = "listed";
    nft.listedAt = now;
    this.storage.saveNFT(nft);

    const tx: Transaction = {
      id: uuidv4(),
      type: "list",
      nftId: nft.id,
      nftName: nft.name,
      from: seller,
      price,
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return nft;
  }

  delist(nftId: string, owner: string): NFT {
    const nft = this.storage.getNFTById(nftId);
    if (!nft) throw new MarketplaceError(`NFT not found: ${nftId}`);
    if (nft.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new MarketplaceError("Only the owner can delist this NFT");
    }
    if (nft.status !== "listed") {
      throw new MarketplaceError("NFT is not listed");
    }

    const now = new Date().toISOString();
    nft.status = "minted";
    nft.price = undefined;
    nft.listedAt = undefined;
    this.storage.saveNFT(nft);

    const tx: Transaction = {
      id: uuidv4(),
      type: "delist",
      nftId: nft.id,
      nftName: nft.name,
      from: owner,
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return nft;
  }

  // ── Buying — with 50 / 50 dividend split ─────────────────────────────────

  /**
   * Purchase a listed NFT.
   *
   * Sale price split:
   *   • 50% → seller (reward for holding and pricing the NFT)
   *   • 50% → divided equally among ALL current holders at time of sale
   *            (viral incentive: every holder profits when someone buys ANY NFT)
   *
   * The buyer is NOT yet a holder at the point of distribution.
   * The seller IS included in the holder pool, so a long-term holder who
   * also sells receives proceeds + dividend share.
   */
  buy(nftId: string, buyer: string): BuyResult {
    const nft = this.storage.getNFTById(nftId);
    if (!nft) throw new MarketplaceError(`NFT not found: ${nftId}`);
    if (nft.status !== "listed") {
      throw new MarketplaceError("NFT is not listed for sale");
    }
    if (nft.owner.toLowerCase() === buyer.toLowerCase()) {
      throw new MarketplaceError("You already own this NFT");
    }

    const salePrice = parseFloat(nft.price!);

    // Check buyer's balance
    let buyerUser = this.storage.getUserByAddress(buyer);
    if (!buyerUser) {
      buyerUser = {
        address: buyer,
        balance: "1000.0",
        nftIds: [],
        createdAt: new Date().toISOString(),
      };
      this.storage.saveUser(buyerUser);
    }

    if (parseFloat(buyerUser.balance) < salePrice) {
      throw new MarketplaceError(
        `Insufficient balance. Have ${buyerUser.balance} ${nft.currency}, need ${nft.price} ${nft.currency}`
      );
    }

    const seller = nft.owner;
    const now    = new Date().toISOString();

    // ── Snapshot ALL current NFT owners BEFORE the sale ───────────────────
    // Each unique owner gets a dividend share.
    const allNFTs   = this.storage.getAllNFTs();
    const holderSet = new Set<string>();
    for (const n of allNFTs) {
      // Count owners of any NFT (including the one being sold)
      holderSet.add(n.owner.toLowerCase());
    }
    const holders = Array.from(holderSet);

    // ── Calculate payments ────────────────────────────────────────────────
    const sellerProceeds = salePrice * SELLER_SHARE;
    const dividendPool   = salePrice * DIVIDEND_SHARE;
    const dividendEach   = holders.length > 0 ? dividendPool / holders.length : 0;

    // ── Debit buyer ───────────────────────────────────────────────────────
    buyerUser.balance = (parseFloat(buyerUser.balance) - salePrice).toFixed(4);
    this.storage.saveUser(buyerUser);

    // ── Credit seller (proceeds) ──────────────────────────────────────────
    const sellerUser = this.storage.getUserByAddress(seller);
    if (sellerUser) {
      sellerUser.balance = (parseFloat(sellerUser.balance) + sellerProceeds).toFixed(4);
      sellerUser.nftIds  = sellerUser.nftIds.filter((id) => id !== nft.id);
      this.storage.saveUser(sellerUser);
    }

    // ── Distribute dividends to all holders ───────────────────────────────
    if (dividendEach > 0) {
      for (const holderAddr of holders) {
        // Skip if this holder is the buyer (they don't hold yet)
        if (holderAddr === buyer.toLowerCase()) continue;

        let holderUser = this.storage.getUserByAddress(holderAddr);
        if (!holderUser) {
          holderUser = {
            address: holderAddr,
            balance: "0",
            nftIds: [],
            createdAt: now,
          };
        }
        holderUser.balance = (parseFloat(holderUser.balance) + dividendEach).toFixed(4);
        this.storage.saveUser(holderUser);
      }
    }

    // ── Transfer NFT ──────────────────────────────────────────────────────
    const priceSnapshot = nft.price!;
    nft.owner  = buyer;
    nft.status = "sold";
    nft.soldAt = now;
    nft.price  = undefined;
    this.storage.saveNFT(nft);

    // Add NFT to buyer's record
    buyerUser.nftIds.push(nft.id);
    this.storage.saveUser(buyerUser);

    // ── Record transaction ─────────────────────────────────────────────────
    const tx: Transaction = {
      id: uuidv4(),
      type: "sale",
      nftId: nft.id,
      nftName: nft.name,
      from: seller,
      to: buyer,
      price: priceSnapshot,
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return {
      nft,
      salePrice: priceSnapshot,
      sellerProceeds: sellerProceeds.toFixed(4),
      dividendPerHolder: dividendEach.toFixed(4),
      dividendRecipients: holders.length,
    };
  }

  // ── Transfer ──────────────────────────────────────────────────────────────

  transfer(nftId: string, from: string, to: string): NFT {
    const nft = this.storage.getNFTById(nftId);
    if (!nft) throw new MarketplaceError(`NFT not found: ${nftId}`);
    if (nft.owner.toLowerCase() !== from.toLowerCase()) {
      throw new MarketplaceError("Only the owner can transfer this NFT");
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      throw new MarketplaceError("Cannot transfer to yourself");
    }

    const now = new Date().toISOString();

    // Remove from sender
    const fromUser = this.storage.getUserByAddress(from);
    if (fromUser) {
      fromUser.nftIds = fromUser.nftIds.filter((id) => id !== nft.id);
      this.storage.saveUser(fromUser);
    }

    // Add to recipient
    let toUser = this.storage.getUserByAddress(to);
    if (!toUser) {
      toUser = {
        address: to,
        balance: "1000.0",
        nftIds: [],
        createdAt: now,
      };
    }
    toUser.nftIds.push(nft.id);
    this.storage.saveUser(toUser);

    // Update NFT
    nft.owner  = to;
    nft.status = "transferred";
    nft.price  = undefined;
    this.storage.saveNFT(nft);

    const tx: Transaction = {
      id: uuidv4(),
      type: "transfer",
      nftId: nft.id,
      nftName: nft.name,
      from,
      to,
      currency: nft.currency,
      timestamp: now,
    };
    this.storage.saveTransaction(tx);

    return nft;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getMarketplace() {
    return this.storage.getListedNFTs();
  }

  getInventory(owner: string) {
    return this.storage.getNFTsByOwner(owner);
  }

  getNFT(id: string) {
    return this.storage.getNFTById(id);
  }

  getNFTByTokenId(tokenId: number) {
    return this.storage.getNFTByTokenId(tokenId);
  }

  getHistory() {
    return this.storage.getAllTransactions();
  }

  getUser(address: string) {
    return this.storage.getUserByAddress(address);
  }
}
