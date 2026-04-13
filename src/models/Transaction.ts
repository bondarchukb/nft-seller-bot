export type TxType = "mint" | "list" | "delist" | "sale" | "transfer";

export interface Transaction {
  id: string;
  type: TxType;
  nftId: string;
  nftName: string;
  from: string;
  to?: string;
  price?: string;
  currency: string;
  txHash?: string;         // On-chain hash (undefined in simulation)
  timestamp: string;
}
