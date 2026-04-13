import { expect } from "chai";
import { ethers } from "hardhat";
import { NFTSellerToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("NFTSellerToken", function () {
  let contract: NFTSellerToken;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const URI1 = "ipfs://QmToken1";
  const URI2 = "ipfs://QmToken2";
  const URI3 = "ipfs://QmToken3";

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NFTSellerToken");
    contract = (await Factory.deploy(owner.address)) as NFTSellerToken;
    await contract.waitForDeployment();
  });

  // ── Price curve ──────────────────────────────────────────────────────────

  describe("Price curve", () => {
    it("token #1 costs BASE_PRICE", async () => {
      const base = await contract.BASE_PRICE();
      expect(await contract.mintPrice(1)).to.equal(base);
    });

    it("token #2 costs BASE_PRICE + PRICE_STEP", async () => {
      const base = await contract.BASE_PRICE();
      const step = await contract.PRICE_STEP();
      expect(await contract.mintPrice(2)).to.equal(base + step);
    });

    it("token #100 costs BASE_PRICE + 99 × PRICE_STEP", async () => {
      const base = await contract.BASE_PRICE();
      const step = await contract.PRICE_STEP();
      expect(await contract.mintPrice(100)).to.equal(base + 99n * step);
    });

    it("nextMintPrice() reflects next unminted token", async () => {
      const price1 = await contract.nextMintPrice();
      await contract.connect(alice).mint(alice.address, URI1, { value: price1 });
      const price2 = await contract.nextMintPrice();
      expect(price2).to.be.gt(price1);
    });
  });

  // ── Minting ───────────────────────────────────────────────────────────────

  describe("Minting", () => {
    it("mints token #1 with correct URI", async () => {
      const price = await contract.mintPrice(1);
      await contract.connect(alice).mint(alice.address, URI1, { value: price });
      expect(await contract.ownerOf(1)).to.equal(alice.address);
      expect(await contract.tokenURI(1)).to.equal(URI1);
    });

    it("reverts if wrong ETH sent", async () => {
      await expect(
        contract.connect(alice).mint(alice.address, URI1, { value: 0 })
      ).to.be.revertedWith("Incorrect ETH for mint price");
    });

    it("emits Minted event", async () => {
      const price = await contract.mintPrice(1);
      await expect(
        contract.connect(alice).mint(alice.address, URI1, { value: price })
      )
        .to.emit(contract, "Minted")
        .withArgs(alice.address, 1, URI1, price);
    });

    it("distributes 50% of mint price to existing holders", async () => {
      // Alice mints first (no holders yet)
      const p1 = await contract.mintPrice(1);
      await contract.connect(alice).mint(alice.address, URI1, { value: p1 });

      const aliceBefore = await contract.dividendBalance(alice.address);

      // Bob mints second — 50% of p2 should flow to Alice
      const p2 = await contract.mintPrice(2);
      const BASE_PRICE = await contract.BASE_PRICE();
      const PRICE_STEP = await contract.PRICE_STEP();
      expect(p2).to.equal(BASE_PRICE + PRICE_STEP);

      await contract.connect(bob).mint(bob.address, URI2, { value: p2 });

      const aliceAfter = await contract.dividendBalance(alice.address);
      const expectedDividend = p2 / 2n;   // 50% ÷ 1 holder = full 50%
      expect(aliceAfter - aliceBefore).to.equal(expectedDividend);
    });
  });

  // ── Marketplace ────────────────────────────────────────────────────────────

  describe("Marketplace", () => {
    beforeEach(async () => {
      const p1 = await contract.mintPrice(1);
      const p2 = await contract.mintPrice(2);
      await contract.connect(alice).mint(alice.address, URI1, { value: p1 });
      await contract.connect(bob).mint(bob.address, URI2, { value: p2 });
    });

    it("owner can list and delist", async () => {
      const listPrice = ethers.parseEther("0.01");
      await contract.connect(alice).listForSale(1, listPrice);
      let listing = await contract.listings(1);
      expect(listing.active).to.be.true;
      expect(listing.price).to.equal(listPrice);

      await contract.connect(alice).delist(1);
      listing = await contract.listings(1);
      expect(listing.active).to.be.false;
    });

    it("reverts if non-owner tries to list", async () => {
      await expect(
        contract.connect(bob).listForSale(1, ethers.parseEther("0.01"))
      ).to.be.revertedWith("Not the owner");
    });

    it("buy distributes 50% to all holders", async () => {
      const salePrice = ethers.parseEther("0.1");
      await contract.connect(alice).listForSale(1, salePrice);

      const aliceBefore = await contract.dividendBalance(alice.address);
      const bobBefore   = await contract.dividendBalance(bob.address);

      // Carol buys — alice and bob should each get 25% (50% ÷ 2 holders)
      await contract.connect(carol).buy(1, { value: salePrice });

      const aliceAfter = await contract.dividendBalance(alice.address);
      const bobAfter   = await contract.dividendBalance(bob.address);

      const sellerShare  = salePrice / 2n;
      const dividendPool = salePrice - sellerShare;
      const perHolder    = dividendPool / 2n;  // 2 holders

      expect(aliceAfter - aliceBefore).to.equal(perHolder);
      expect(bobAfter   - bobBefore).to.equal(perHolder);
      expect(await contract.ownerOf(1)).to.equal(carol.address);
    });

    it("reverts if buyer sends wrong ETH amount", async () => {
      await contract.connect(alice).listForSale(1, ethers.parseEther("0.1"));
      await expect(
        contract.connect(carol).buy(1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Incorrect ETH amount");
    });

    it("reverts if owner tries to buy own NFT", async () => {
      await contract.connect(alice).listForSale(1, ethers.parseEther("0.1"));
      await expect(
        contract.connect(alice).buy(1, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Cannot buy your own NFT");
    });
  });

  // ── Dividend claiming ──────────────────────────────────────────────────────

  describe("Dividend claiming", () => {
    it("holder can claim accumulated dividends", async () => {
      const p1 = await contract.mintPrice(1);
      await contract.connect(alice).mint(alice.address, URI1, { value: p1 });

      const p2 = await contract.mintPrice(2);
      await contract.connect(bob).mint(bob.address, URI2, { value: p2 });

      const dividend = await contract.dividendBalance(alice.address);
      expect(dividend).to.be.gt(0n);

      const aliceEthBefore = await ethers.provider.getBalance(alice.address);
      const tx = await contract.connect(alice).claimDividends();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const aliceEthAfter = await ethers.provider.getBalance(alice.address);
      expect(aliceEthAfter).to.be.closeTo(
        aliceEthBefore + dividend - gasUsed,
        ethers.parseEther("0.0001")
      );
      expect(await contract.dividendBalance(alice.address)).to.equal(0n);
    });

    it("reverts if no dividends to claim", async () => {
      await expect(contract.connect(alice).claimDividends()).to.be.revertedWith(
        "No dividends to claim"
      );
    });
  });

  // ── tokensOfOwner ────────────────────────────────────────────────────────

  describe("tokensOfOwner", () => {
    it("returns all tokens owned by an address", async () => {
      const p1 = await contract.mintPrice(1);
      const p2 = await contract.mintPrice(2);
      await contract.connect(alice).mint(alice.address, URI1, { value: p1 });
      await contract.connect(alice).mint(alice.address, URI2, { value: p2 });
      await contract.connect(bob).mint(bob.address, URI3, { value: await contract.mintPrice(3) });

      const aliceTokens = await contract.tokensOfOwner(alice.address);
      expect(aliceTokens.map(Number)).to.deep.equal([1, 2]);

      const bobTokens = await contract.tokensOfOwner(bob.address);
      expect(bobTokens.map(Number)).to.deep.equal([3]);
    });
  });
});
