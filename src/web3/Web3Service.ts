import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { NFT, NFTAttribute } from "../models/NFT";
import { StorageService } from "../services/StorageService";
import { v4 as uuidv4 } from "uuid";

// ABI for NFTSellerToken — only the functions we use from the bot
const NFT_ABI = [
  "function mint(address to, string calldata metadataUri) external returns (uint256)",
  "function batchMint(address to, string[] calldata metadataUris) external returns (uint256[])",
  "function listForSale(uint256 tokenId, uint256 price) external",
  "function delist(uint256 tokenId) external",
  "function buy(uint256 tokenId) external payable",
  "function tokensOfOwner(address owner) external view returns (uint256[])",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalMinted() external view returns (uint256)",
  "function listings(uint256 tokenId) external view returns (address seller, uint256 price, bool active)",
  "function platformFeeBps() external view returns (uint256)",
  "event Minted(address indexed to, uint256 indexed tokenId, string tokenURI)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Delisted(uint256 indexed tokenId, address indexed seller)",
  "event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)",
];

export interface Web3MintOptions {
  name: string;
  description: string;
  image: string;
  attributes?: NFTAttribute[];
  metadataUri: string;     // IPFS URI (caller must pin metadata first)
}

export class Web3Service {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private contract: ethers.Contract;

  constructor(
    rpcUrl: string,
    privateKey: string,
    contractAddress: string,
    private storage: StorageService
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, NFT_ABI, this.signer);
  }

  get walletAddress(): string {
    return this.signer.address;
  }

  // ── Network info ──────────────────────────────────────────────────

  async getBalance(): Promise<string> {
    const balance = await this.provider.getBalance(this.signer.address);
    return ethers.formatEther(balance);
  }

  async getNetwork(): Promise<string> {
    const network = await this.provider.getNetwork();
    return `${network.name} (chainId: ${network.chainId})`;
  }

  // ── Minting ───────────────────────────────────────────────────────

  async mint(opts: Web3MintOptions): Promise<NFT> {
    const tx = await this.contract.mint(this.signer.address, opts.metadataUri);
    const receipt = await tx.wait();

    // Parse tokenId from Minted event
    const mintedEvent = receipt.logs
      .map((log: ethers.Log) => {
        try { return this.contract.interface.parseLog(log); } catch { return null; }
      })
      .find((e: ethers.LogDescription | null) => e?.name === "Minted");

    const tokenId = mintedEvent
      ? Number(mintedEvent.args.tokenId)
      : Number(await this.contract.totalMinted());

    const nft: NFT = {
      id: uuidv4(),
      tokenId,
      contractAddress: await this.contract.getAddress(),
      name: opts.name,
      description: opts.description,
      image: opts.image,
      attributes: opts.attributes ?? [],
      owner: this.signer.address,
      creator: this.signer.address,
      currency: "ETH",
      status: "minted",
      mintedAt: new Date().toISOString(),
      metadataUri: opts.metadataUri,
      mintTxHash: receipt.hash,
    };

    this.storage.saveNFT(nft);
    this.syncOwnerRecord(this.signer.address, nft.id);

    return nft;
  }

  async batchMint(items: Web3MintOptions[]): Promise<NFT[]> {
    const uris = items.map((i) => i.metadataUri);
    const tx = await this.contract.batchMint(this.signer.address, uris);
    const receipt = await tx.wait();

    const mintedEvents = receipt.logs
      .map((log: ethers.Log) => {
        try { return this.contract.interface.parseLog(log); } catch { return null; }
      })
      .filter((e: ethers.LogDescription | null) => e?.name === "Minted");

    return mintedEvents.map((event: ethers.LogDescription, i: number) => {
      const tokenId = Number(event.args.tokenId);
      const nft: NFT = {
        id: uuidv4(),
        tokenId,
        contractAddress: this.contract.target as string,
        name: items[i].name,
        description: items[i].description,
        image: items[i].image,
        attributes: items[i].attributes ?? [],
        owner: this.signer.address,
        creator: this.signer.address,
        currency: "ETH",
        status: "minted",
        mintedAt: new Date().toISOString(),
        metadataUri: items[i].metadataUri,
        mintTxHash: receipt.hash,
      };
      this.storage.saveNFT(nft);
      this.syncOwnerRecord(this.signer.address, nft.id);
      return nft;
    });
  }

  // ── Marketplace ────────────────────────────────────────────────────

  async listForSale(tokenId: number, priceEth: string): Promise<string> {
    const priceWei = ethers.parseEther(priceEth);
    const tx = await this.contract.listForSale(tokenId, priceWei);
    const receipt = await tx.wait();

    // Update local DB
    const nft = this.storage.getNFTByTokenId(tokenId);
    if (nft) {
      nft.price = priceEth;
      nft.status = "listed";
      nft.listedAt = new Date().toISOString();
      this.storage.saveNFT(nft);
    }

    return receipt.hash;
  }

  async delist(tokenId: number): Promise<string> {
    const tx = await this.contract.delist(tokenId);
    const receipt = await tx.wait();

    const nft = this.storage.getNFTByTokenId(tokenId);
    if (nft) {
      nft.status = "minted";
      nft.price = undefined;
      this.storage.saveNFT(nft);
    }

    return receipt.hash;
  }

  async buy(tokenId: number): Promise<string> {
    const listing = await this.contract.listings(tokenId);
    if (!listing.active) throw new Error("Token is not listed for sale");

    const tx = await this.contract.buy(tokenId, { value: listing.price });
    const receipt = await tx.wait();

    const nft = this.storage.getNFTByTokenId(tokenId);
    if (nft) {
      const previousOwner = nft.owner;
      nft.owner = this.signer.address;
      nft.status = "sold";
      nft.soldAt = new Date().toISOString();
      nft.price = undefined;
      nft.saleTxHash = receipt.hash;
      this.storage.saveNFT(nft);

      // Update user records
      const seller = this.storage.getUserByAddress(previousOwner);
      if (seller) {
        seller.nftIds = seller.nftIds.filter((id) => id !== nft.id);
        this.storage.saveUser(seller);
      }
      this.syncOwnerRecord(this.signer.address, nft.id);
    }

    return receipt.hash;
  }

  // ── Queries ───────────────────────────────────────────────────────

  async getListing(tokenId: number): Promise<{ seller: string; priceEth: string; active: boolean }> {
    const listing = await this.contract.listings(tokenId);
    return {
      seller: listing.seller,
      priceEth: ethers.formatEther(listing.price),
      active: listing.active,
    };
  }

  async getOnChainOwner(tokenId: number): Promise<string> {
    return this.contract.ownerOf(tokenId);
  }

  async getTotalMinted(): Promise<number> {
    return Number(await this.contract.totalMinted());
  }

  async getTokenURI(tokenId: number): Promise<string> {
    return this.contract.tokenURI(tokenId);
  }

  async getOwnedTokenIds(address?: string): Promise<number[]> {
    const addr = address ?? this.signer.address;
    const ids = await this.contract.tokensOfOwner(addr);
    return ids.map(Number);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private syncOwnerRecord(address: string, nftId: string): void {
    let user = this.storage.getUserByAddress(address);
    if (!user) {
      user = {
        address,
        balance: "0",
        nftIds: [],
        createdAt: new Date().toISOString(),
      };
    }
    if (!user.nftIds.includes(nftId)) {
      user.nftIds.push(nftId);
    }
    this.storage.saveUser(user);
  }

  /**
   * Load the compiled ABI and bytecode from Hardhat artifacts.
   * Useful for deploying from within the bot.
   */
  static loadArtifact(): { abi: object[]; bytecode: string } | null {
    const artifactPath = path.resolve(
      process.cwd(),
      "artifacts/contracts/NFTSellerToken.sol/NFTSellerToken.json"
    );
    if (!fs.existsSync(artifactPath)) return null;
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    return { abi: artifact.abi, bytecode: artifact.bytecode };
  }
}
