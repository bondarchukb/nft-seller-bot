export type NFTStatus = "minted" | "listed" | "sold" | "transferred";

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
}

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;           // URL or IPFS URI
  external_url?: string;
  attributes: NFTAttribute[];
}

export interface NFT {
  id: string;              // Internal UUID
  tokenId?: number;        // On-chain ERC-721 token ID (set after minting on-chain)
  contractAddress?: string;
  name: string;
  description: string;
  image: string;
  attributes: NFTAttribute[];
  owner: string;           // Wallet address or username (simulation)
  creator: string;         // Original minter
  price?: string;          // Listing price in ETH (or sim-ETH)
  currency: string;        // "ETH" | "MATIC" | "SIM"
  status: NFTStatus;
  mintedAt: string;        // ISO date string
  listedAt?: string;
  soldAt?: string;
  mintTxHash?: string;     // On-chain transaction hash
  saleTxHash?: string;
  metadataUri?: string;    // IPFS URI for metadata
}
