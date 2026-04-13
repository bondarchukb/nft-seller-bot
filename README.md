# NFT Seller Bot

A complete NFT minting and marketplace bot with two operating modes:

| Mode | Description |
|------|-------------|
| **Simulation** | No wallet, no blockchain needed. Local JSON database. Great for testing. |
| **On-chain** | Mint and trade real ERC-721 tokens on Ethereum / Polygon testnets (or mainnet). |

---

## Economics

Two built-in mechanics make the collection self-reinforcing:

### 1. Ascending Price Curve
Every new NFT is more expensive than the last.

```
mintPrice(tokenId) = BASE_PRICE + (tokenId - 1) × PRICE_STEP
```

| Token | Simulation | On-chain (ETH) |
|------:|------------|----------------|
| #1    | 1.00 SIM   | 0.001 ETH      |
| #2    | 1.50 SIM   | 0.0015 ETH     |
| #10   | 5.50 SIM   | 0.0055 ETH     |
| #100  | 50.50 SIM  | 0.0505 ETH     |

### 2. Holder Dividend (50 / 50 split)
On every sale, revenue is split:
- **50%** → seller
- **50%** → divided equally among **all current NFT holders** at the time of sale

This means the longer you hold, the more dividends you accumulate from every subsequent sale. On-chain dividends are stored per-address and claimed by calling `claimDividends()`.

---

## Quick Start — Simulation Mode

```bash
npm install

# Mint your first NFT (auto-priced at 1.00 SIM)
npm run dev -- mint -n "Genesis" -d "First NFT" -i "https://example.com/img.png" -o alice

# Mint a second (1.50 SIM) and a third (2.00 SIM)
npm run dev -- mint -n "Rare One" -d "Very rare" -i "https://example.com/rare.png" -o bob
npm run dev -- mint -n "Epic" -d "Even rarer" -i "https://example.com/epic.png" -o carol

# View the marketplace (all NFTs are listed at mint price automatically)
npm run dev -- marketplace

# Bob buys "Genesis" from Alice
# → Alice receives 50% of the sale price
# → Bob and Carol each receive a dividend share from the other 50%
npm run dev -- buy -t 1 -b bob

# Check balances
npm run dev -- account -a alice
npm run dev -- account -a bob

# See the price curve for the next 10 tokens
npm run dev -- price-curve

# Full transaction history
npm run dev -- history
```

---

## On-Chain Mode

### Prerequisites

1. Copy `.env.example` to `.env` and fill in:
   - `RPC_URL` — Alchemy / Infura URL for Sepolia (or any EVM network)
   - `PRIVATE_KEY` — deployer wallet private key
   - `ETHERSCAN_API_KEY` — for contract verification (optional)

2. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```

3. Start a local Hardhat node (optional, for local testing):
   ```bash
   npm run node
   # In another terminal:
   npm run deploy:local
   ```

4. Deploy to Sepolia testnet:
   ```bash
   npm run deploy:sepolia
   # NFT_CONTRACT_ADDRESS is written to .env automatically
   ```

5. Set `BOT_MODE=sepolia` in `.env`, then run the bot:
   ```bash
   npm run dev -- mint -n "My NFT" -d "On-chain!" -i "ipfs://..." --uri "ipfs://QmMetadata..."
   npm run dev -- marketplace
   ```

### Run Tests

```bash
npm test
```

---

## CLI Reference

```
nft-bot <command> [options]
```

| Command | Description |
|---------|-------------|
| `mint` | Mint a new NFT (auto-priced by token ID) |
| `batch-mint -f items.json` | Batch mint from a JSON file |
| `list -t <id> -p <price>` | List an owned NFT for sale |
| `delist -t <id>` | Remove listing |
| `buy -t <id> [-b buyer]` | Purchase a listed NFT + distribute dividends |
| `transfer -t <id> --to <addr>` | Transfer without sale |
| `marketplace` | Show all active listings |
| `inventory [-o owner]` | Show NFTs owned by an address |
| `view -t <id>` | Full details of one NFT |
| `all` | All NFTs in the database |
| `history` | Transaction log |
| `account [-a addr]` | Account balance and NFT count |
| `price-curve [-c N]` | Preview upcoming mint prices |
| `reset --confirm` | Wipe the simulation database |

---

## Project Structure

```
nft-seller-bot/
├── contracts/
│   └── NFTSellerToken.sol      ERC-721 with price curve + dividends
├── scripts/
│   └── deploy.ts               Hardhat deployment script
├── test/
│   └── NFTSellerToken.test.ts  Full test suite (price curve, mint, buy, dividends)
├── src/
│   ├── models/                 TypeScript data models
│   │   ├── NFT.ts
│   │   ├── User.ts
│   │   ├── Transaction.ts
│   │   └── Database.ts
│   ├── services/
│   │   ├── StorageService.ts   Local JSON DB
│   │   ├── MintService.ts      Simulation minting (price curve)
│   │   └── MarketplaceService.ts  Simulation marketplace (50/50 split)
│   ├── web3/
│   │   └── Web3Service.ts      ethers.js on-chain integration
│   └── cli/
│       ├── index.ts            Commander.js CLI entry point
│       └── display.ts          Chalk/table terminal UI
├── hardhat.config.ts
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Contract — NFTSellerToken

| Feature | Detail |
|---------|--------|
| Standard | ERC-721 + ERC-721Enumerable + ERC-721URIStorage |
| Price curve | `BASE_PRICE=0.001 ETH`, `PRICE_STEP=0.0005 ETH` |
| Dividend split | 50% seller / 50% all holders |
| Max supply | 10,000 tokens |
| Dividend claim | `claimDividends()` — pull pattern, no re-entrancy risk |
| Admin | `withdrawRevenue()`, `setPlatformFee()` |
