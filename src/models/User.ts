export interface User {
  address: string;         // Wallet address or sim username
  username?: string;
  balance: string;         // ETH or SIM balance
  nftIds: string[];        // Owned NFT internal IDs
  createdAt: string;
}
