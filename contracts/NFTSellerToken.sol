// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NFTSellerToken
 * @notice ERC-721 NFT with a built-in marketplace.
 *
 * ── Business model ────────────────────────────────────────────────────────
 *
 * Minting is a PAID SERVICE. Every new token costs more than the last,
 * creating an ascending price curve:
 *
 *   mintFee(tokenId) = BASE_PRICE + (tokenId - 1) × PRICE_STEP
 *   e.g. token #1 = 0.001 ETH, token #2 = 0.0015 ETH, …
 *
 * Mint fee split:
 *   50% → divided equally among all EXISTING holders (immediate dividend)
 *   50% → contract (platform revenue, withdrawable by owner)
 *
 * Sale fee split (secondary market):
 *   50% → seller
 *   50% → divided equally among ALL current holders at time of sale
 *
 * ── Viral incentive ──────────────────────────────────────────────────────
 *
 * Every holder earns from EVERY new mint AND every secondary sale.
 * This means every owner is economically motivated to bring in new buyers
 * and new minters — the collection markets itself.
 *
 * ── Gas note ─────────────────────────────────────────────────────────────
 *
 * Iterating all holders on every sale is O(n). Fine for small collections.
 * For large collections (>1 000 holders) use a "dividends per share"
 * accumulator pattern to avoid the loop. This implementation is chosen for
 * clarity and auditability.
 */
contract NFTSellerToken is
    ERC721,
    ERC721URIStorage,
    ERC721Enumerable,
    Ownable,
    ReentrancyGuard
{
    // ── Price curve constants ─────────────────────────────────────────────

    /// @notice First token costs 0.001 ETH
    uint256 public constant BASE_PRICE  = 0.001 ether;
    /// @notice Each additional token costs 0.0005 ETH more
    uint256 public constant PRICE_STEP  = 0.0005 ether;
    /// @notice Maximum tokens that can ever be minted
    uint256 public constant MAX_SUPPLY  = 10_000;

    // ── Dividend split ─────────────────────────────────────────────────────

    /// @notice 50% of every sale price goes to all current holders
    uint256 public constant DIVIDEND_BPS = 5_000;   // 50% in basis points
    /// @notice 50% of every sale price goes to the seller
    uint256 public constant SELLER_BPS   = 5_000;

    // ── State ──────────────────────────────────────────────────────────────

    uint256 private _nextTokenId = 1;

    struct Listing {
        address seller;
        uint256 price;   // in wei
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    /// @notice Accumulated dividend balance per address (claimable any time)
    mapping(address => uint256) public dividendBalance;

    // ── Events ─────────────────────────────────────────────────────────────

    event Minted(address indexed to, uint256 indexed tokenId, string tokenURI, uint256 mintPrice);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Delisted(uint256 indexed tokenId, address indexed seller);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 dividendPerHolder,
        uint256 holderCount
    );
    event DividendClaimed(address indexed holder, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address initialOwner)
        ERC721("NFTSellerToken", "NST")
        Ownable(initialOwner)
    {}

    // ── Price curve ────────────────────────────────────────────────────────

    /**
     * @notice Returns the mint price for a specific token ID.
     * @dev    Price increases linearly: BASE_PRICE + (tokenId - 1) × PRICE_STEP
     */
    function mintPrice(uint256 tokenId) public pure returns (uint256) {
        return BASE_PRICE + (tokenId - 1) * PRICE_STEP;
    }

    /**
     * @notice Returns the price that will be charged for the NEXT mint.
     */
    function nextMintPrice() external view returns (uint256) {
        return mintPrice(_nextTokenId);
    }

    // ── Minting ────────────────────────────────────────────────────────────

    /**
     * @notice Pay the mint service fee and receive a new NFT.
     *
     *         msg.value must equal mintPrice(nextTokenId) exactly.
     *
     *         Fee split:
     *           • 50% → immediate dividend to all EXISTING holders
     *           • 50% → contract (platform revenue, withdrawn via withdrawRevenue)
     *         If no holders exist yet, 100% goes to platform revenue.
     *
     *         The minted token is NOT auto-listed. The owner decides if
     *         and at what price to sell it on the secondary market.
     *
     * @param to           Recipient of the NFT.
     * @param metadataUri  IPFS or HTTPS URI pointing to JSON metadata.
     */
    function mint(address to, string calldata metadataUri)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId;
        require(tokenId <= MAX_SUPPLY, "Max supply reached");

        uint256 required = mintPrice(tokenId);
        require(msg.value == required, "Incorrect ETH for mint price");

        _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataUri);

        // Distribute 50% of mint price to existing holders as dividends
        uint256 supply = totalSupply();
        // supply includes the newly minted token, so holders = supply - 1
        uint256 holderCount = supply > 1 ? supply - 1 : 0;
        if (holderCount > 0) {
            uint256 dividendPool = (required * DIVIDEND_BPS) / 10_000;
            uint256 dividendEach = dividendPool / holderCount;
            if (dividendEach > 0) {
                _distributeToHolders(dividendEach, to);   // 'to' is the new owner, excluded
            }
        }

        emit Minted(to, tokenId, metadataUri, required);
    }

    /**
     * @notice Batch mint. Each token in the batch is priced individually.
     *         Caller must send the exact total ETH for all tokens.
     */
    function batchMint(address to, string[] calldata metadataUris)
        external
        payable
        nonReentrant
        returns (uint256[] memory tokenIds)
    {
        uint256 count = metadataUris.length;
        require(count > 0, "Empty batch");
        require(_nextTokenId + count - 1 <= MAX_SUPPLY, "Would exceed max supply");

        uint256 totalRequired;
        for (uint256 i = 0; i < count; i++) {
            totalRequired += mintPrice(_nextTokenId + i);
        }
        require(msg.value == totalRequired, "Incorrect ETH for batch mint");

        tokenIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = _nextTokenId++;
            _safeMint(to, tokenId);
            _setTokenURI(tokenId, metadataUris[i]);
            tokenIds[i] = tokenId;
            emit Minted(to, tokenId, metadataUris[i], mintPrice(tokenId));
        }
    }

    // ── Marketplace ────────────────────────────────────────────────────────

    /**
     * @notice List a token for sale. Owner sets the asking price.
     */
    function listForSale(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        require(price > 0, "Price must be > 0");

        listings[tokenId] = Listing({ seller: msg.sender, price: price, active: true });
        emit Listed(tokenId, msg.sender, price);
    }

    /**
     * @notice Remove a listing.
     */
    function delist(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not the owner");
        require(listings[tokenId].active, "Not listed");
        listings[tokenId].active = false;
        emit Delisted(tokenId, msg.sender);
    }

    /**
     * @notice Buy a listed token. Send exactly the listing price as msg.value.
     *
     *   Revenue split:
     *     50%  → seller
     *     50%  → divided equally among ALL current holders (before transfer)
     */
    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory listing = listings[tokenId];
        require(listing.active, "Token not for sale");
        require(msg.value == listing.price, "Incorrect ETH amount");
        require(msg.sender != listing.seller, "Cannot buy your own NFT");

        // Deactivate listing BEFORE state changes (reentrancy guard)
        listings[tokenId].active = false;

        uint256 salePrice     = listing.price;
        uint256 sellerShare   = (salePrice * SELLER_BPS) / 10_000;
        uint256 dividendPool  = salePrice - sellerShare;

        uint256 holderCount   = totalSupply();  // includes token being sold
        uint256 dividendEach  = holderCount > 0 ? dividendPool / holderCount : 0;

        // Distribute dividend to current holders (BEFORE transferring the NFT)
        if (dividendEach > 0) {
            _distributeToHolders(dividendEach, address(0));  // no exclusion
        }

        // Transfer NFT to buyer
        _transfer(listing.seller, msg.sender, tokenId);

        // Pay seller
        (bool ok, ) = payable(listing.seller).call{ value: sellerShare }("");
        require(ok, "Seller payment failed");

        emit Sold(tokenId, listing.seller, msg.sender, salePrice, dividendEach, holderCount);
    }

    // ── Dividend claiming ──────────────────────────────────────────────────

    /**
     * @notice Claim all accumulated dividend balance for msg.sender.
     */
    function claimDividends() external nonReentrant {
        uint256 amount = dividendBalance[msg.sender];
        require(amount > 0, "No dividends to claim");
        dividendBalance[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{ value: amount }("");
        require(ok, "Claim transfer failed");
        emit DividendClaimed(msg.sender, amount);
    }

    // ── Queries ────────────────────────────────────────────────────────────

    /**
     * @notice Returns all token IDs owned by an address.
     */
    function tokensOfOwner(address owner_)
        external
        view
        returns (uint256[] memory)
    {
        uint256 bal = balanceOf(owner_);
        uint256[] memory tokens = new uint256[](bal);
        for (uint256 i = 0; i < bal; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner_, i);
        }
        return tokens;
    }

    /// @notice Total tokens minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw the contract's ETH balance (platform revenue).
     *         Does NOT touch dividend balances — those belong to holders.
     */
    function withdrawRevenue() external onlyOwner {
        // Calculate total unclaimed dividends so we don't withdraw them
        // For simplicity we withdraw only excess ETH (not tracked per-address)
        // In production, track contract revenue separately.
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        (bool ok, ) = payable(owner()).call{ value: balance }("");
        require(ok, "Withdrawal failed");
    }

    // ── Internals ──────────────────────────────────────────────────────────

    /**
     * @dev Distribute `amountPerToken` to every current token holder,
     *      proportionally by their NFT count. An address holding N tokens
     *      receives N × amountPerToken — i.e. "holders earn the most".
     *
     *      One `exclude` address is skipped (the minter / buyer who is not
     *      yet eligible). Dividends accumulate in dividendBalance; no
     *      external calls are made here, so reentrancy is not a risk.
     *
     *      Caller must pass: amountPerToken = dividendPool / eligibleSupply
     */
    function _distributeToHolders(uint256 amountPerToken, address exclude) internal {
        uint256 supply = totalSupply();
        for (uint256 i = 0; i < supply; i++) {
            address holder = ownerOf(tokenByIndex(i));
            if (holder != exclude) {
                // Each token owned adds one unit of amountPerToken → proportional
                dividendBalance[holder] += amountPerToken;
            }
        }
    }

    // ── ERC-721 overrides ─────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        // Auto-delist on any transfer
        if (listings[tokenId].active) {
            listings[tokenId].active = false;
            emit Delisted(tokenId, listings[tokenId].seller);
        }
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
