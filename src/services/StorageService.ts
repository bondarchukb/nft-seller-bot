import * as fs from "fs";
import * as path from "path";
import { DatabaseSchema } from "../models/Database";

const DB_PATH = path.resolve(process.cwd(), "db.json");

const DEFAULT_DB: DatabaseSchema = {
  nfts: [],
  users: [],
  transactions: [],
  settings: {
    nextTokenId: 1,
  },
};

export class StorageService {
  private db: DatabaseSchema;

  constructor() {
    this.db = this.load();
  }

  private load(): DatabaseSchema {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    try {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      return JSON.parse(raw) as DatabaseSchema;
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
  }

  private save(): void {
    fs.writeFileSync(DB_PATH, JSON.stringify(this.db, null, 2));
  }

  // ── NFTs ──────────────────────────────────────────────────────────

  getAllNFTs() {
    return this.db.nfts;
  }

  getNFTById(id: string) {
    return this.db.nfts.find((n) => n.id === id);
  }

  getNFTByTokenId(tokenId: number) {
    return this.db.nfts.find((n) => n.tokenId === tokenId);
  }

  getNFTsByOwner(owner: string) {
    return this.db.nfts.filter(
      (n) => n.owner.toLowerCase() === owner.toLowerCase()
    );
  }

  getListedNFTs() {
    return this.db.nfts.filter((n) => n.status === "listed");
  }

  saveNFT(nft: import("../models/NFT").NFT): void {
    const idx = this.db.nfts.findIndex((n) => n.id === nft.id);
    if (idx === -1) {
      this.db.nfts.push(nft);
    } else {
      this.db.nfts[idx] = nft;
    }
    this.save();
  }

  // ── Users ─────────────────────────────────────────────────────────

  getAllUsers() {
    return this.db.users;
  }

  getUserByAddress(address: string) {
    return this.db.users.find(
      (u) => u.address.toLowerCase() === address.toLowerCase()
    );
  }

  saveUser(user: import("../models/User").User): void {
    const idx = this.db.users.findIndex(
      (u) => u.address.toLowerCase() === user.address.toLowerCase()
    );
    if (idx === -1) {
      this.db.users.push(user);
    } else {
      this.db.users[idx] = user;
    }
    this.save();
  }

  // ── Transactions ──────────────────────────────────────────────────

  getAllTransactions() {
    return this.db.transactions;
  }

  saveTransaction(tx: import("../models/Transaction").Transaction): void {
    this.db.transactions.push(tx);
    this.save();
  }

  // ── Settings ──────────────────────────────────────────────────────

  getSettings() {
    return this.db.settings;
  }

  updateSettings(patch: Partial<DatabaseSchema["settings"]>): void {
    this.db.settings = { ...this.db.settings, ...patch };
    this.save();
  }

  nextTokenId(): number {
    const id = this.db.settings.nextTokenId;
    this.db.settings.nextTokenId = id + 1;
    this.save();
    return id;
  }

  // ── Reset ─────────────────────────────────────────────────────────

  reset(): void {
    this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
    this.save();
  }
}
