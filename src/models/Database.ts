import { NFT } from "./NFT";
import { User } from "./User";
import { Transaction } from "./Transaction";

export interface DatabaseSchema {
  nfts: NFT[];
  users: User[];
  transactions: Transaction[];
  settings: {
    nextTokenId: number;
    contractAddress?: string;
    network?: string;
  };
}
