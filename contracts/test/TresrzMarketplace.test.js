const { expect } = require("chai");
const { ethers } = require("hardhat");

const ETH = (n) => ethers.parseEther(String(n));
const FEE_BPS = 250n;       // 2.5% marketplace fee
const ROYALTY_BPS = 500n;   // 5% creator royalty set at mint

// Secondary-market tests. A track is minted on TresrzMusic (primary), bought by
// `seller`, then traded on TresrzMarketplace via listings and offers. Every sale
// must split funds: royalty -> creator, fee -> feeRecipient, remainder -> seller.
describe("TresrzMarketplace", function () {
  let music, market, owner, feeRecipient, artist, seller, buyer, other;

  beforeEach(async function () {
    [owner, feeRecipient, artist, seller, buyer, other] = await ethers.getSigners();

    const Music = await ethers.getContractFactory("TresrzMusic");
    music = await Music.deploy(feeRecipient.address);
    await music.waitForDeployment();

    const Market = await ethers.getContractFactory("TresrzMarketplace");
    market = await Market.deploy(await music.getAddress(), feeRecipient.address);
    await market.waitForDeployment();

    // artist mints a 10-edition track @ 1 ETH, 5% royalty (trackId 1)
    await music.connect(artist).mintTrack(10, ETH("1"), ROYALTY_BPS, "ipfs://track");
    // seller buys 5 editions on the primary market to resell
    await music.connect(seller).buy(1, 5, { value: ETH("5") });
    // seller approves the marketplace to move their editions
    await music.connect(seller).setApprovalForAll(await market.getAddress(), true);
  });

  describe("deployment", function () {
    it("wires nft + feeRecipient and defaults the fee to 2.5%", async function () {
      expect(await market.nft()).to.equal(await music.getAddress());
      expect(await market.feeRecipient()).to.equal(feeRecipient.address);
      expect(await market.platformFeeBps()).to.equal(FEE_BPS);
    });
    it("rejects zero addresses in the constructor", async function () {
      const Market = await ethers.getContractFactory("TresrzMarketplace");
      await expect(Market.deploy(ethers.ZeroAddress, feeRecipient.address)).to.be.revertedWith("nft=0");
      await expect(Market.deploy(await music.getAddress(), ethers.ZeroAddress)).to.be.revertedWith("fee=0");
    });
  });

  describe("listings", function () {
    it("lists editions and emits Listed", async function () {
      await expect(market.connect(seller).list(1, 3, ETH("2")))
        .to.emit(market, "Listed")
        .withArgs(1n, seller.address, 1n, 3n, ETH("2"));
      const l = await market.listings(1);
      expect(l.seller).to.equal(seller.address);
      expect(l.qty).to.equal(3n);
      expect(l.pricePerUnit).to.equal(ETH("2"));
      expect(l.active).to.equal(true);
    });

    it("reverts listing without approval", async function () {
      await music.connect(seller).setApprovalForAll(await market.getAddress(), false);
      await expect(market.connect(seller).list(1, 1, ETH("2"))).to.be.revertedWith("not approved");
    });

    it("reverts listing more than owned / zero qty / zero price", async function () {
      await expect(market.connect(seller).list(1, 6, ETH("2"))).to.be.revertedWith("insufficient balance");
      await expect(market.connect(seller).list(1, 0, ETH("2"))).to.be.revertedWith("qty=0");
      await expect(market.connect(seller).list(1, 1, 0)).to.be.revertedWith("price=0");
    });

    it("updates a listing's qty and price (only by seller)", async function () {
      await market.connect(seller).list(1, 3, ETH("2"));
      await expect(market.connect(buyer).updateListing(1, 2, ETH("3"))).to.be.revertedWith("not seller");
      await expect(market.connect(seller).updateListing(1, 2, ETH("3")))
        .to.emit(market, "ListingUpdated").withArgs(1n, 2n, ETH("3"));
      const l = await market.listings(1);
      expect(l.qty).to.equal(2n);
      expect(l.pricePerUnit).to.equal(ETH("3"));
    });

    it("cancels a listing (seller or owner)", async function () {
      await market.connect(seller).list(1, 3, ETH("2"));
      await expect(market.connect(other).cancelListing(1)).to.be.revertedWith("auth");
      await expect(market.connect(seller).cancelListing(1)).to.emit(market, "ListingCancelled").withArgs(1n);
      expect((await market.listings(1)).active).to.equal(false);
      await expect(market.connect(buyer).buy(1, 1, { value: ETH("2") })).to.be.revertedWith("inactive");
    });
  });

  describe("buy", function () {
    beforeEach(async function () {
      await market.connect(seller).list(1, 3, ETH("2")); // listingId 1, 3 @ 2 ETH
    });

    it("transfers editions and splits funds (royalty + fee + seller)", async function () {
      const qty = 2n;
      const total = ETH("2") * qty;                 // 4 ETH
      const royalty = (total * ROYALTY_BPS) / 10000n; // 0.2 ETH -> artist
      const fee = (total * FEE_BPS) / 10000n;         // 0.1 ETH -> feeRecipient
      const toSeller = total - royalty - fee;

      const artistBefore = await ethers.provider.getBalance(artist.address);
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
      const sellerBefore = await ethers.provider.getBalance(seller.address);

      await expect(market.connect(buyer).buy(1, qty, { value: total }))
        .to.emit(market, "Sale")
        .withArgs(1n, seller.address, buyer.address, 1n, qty, total, royalty, fee);

      expect(await music.balanceOf(buyer.address, 1)).to.equal(qty);
      expect(await music.balanceOf(seller.address, 1)).to.equal(5n - qty);
      expect((await ethers.provider.getBalance(artist.address)) - artistBefore).to.equal(royalty);
      expect((await ethers.provider.getBalance(feeRecipient.address)) - feeBefore).to.equal(fee);
      expect((await ethers.provider.getBalance(seller.address)) - sellerBefore).to.equal(toSeller);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);

      const l = await market.listings(1);
      expect(l.qty).to.equal(1n);
      expect(l.active).to.equal(true);
    });

    it("deactivates the listing once fully sold", async function () {
      await market.connect(buyer).buy(1, 3, { value: ETH("6") });
      const l = await market.listings(1);
      expect(l.qty).to.equal(0n);
      expect(l.active).to.equal(false);
    });

    it("refunds overpayment", async function () {
      const total = ETH("2");
      const buyerBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await market.connect(buyer).buy(1, 1, { value: total + ETH("1") });
      const rcpt = await tx.wait();
      const gas = rcpt.gasUsed * rcpt.gasPrice;
      const spent = buyerBefore - (await ethers.provider.getBalance(buyer.address));
      expect(spent).to.equal(total + gas); // only paid `total` (+ gas), overpay refunded
    });

    it("reverts on bad qty / underpayment", async function () {
      await expect(market.connect(buyer).buy(1, 4, { value: ETH("8") })).to.be.revertedWith("bad qty");
      await expect(market.connect(buyer).buy(1, 0, { value: 0 })).to.be.revertedWith("bad qty");
      await expect(market.connect(buyer).buy(1, 1, { value: ETH("2") - 1n })).to.be.revertedWith("underpaid");
    });

    it("reverts if the seller moved their tokens away (stale listing)", async function () {
      await music.connect(seller).safeTransferFrom(seller.address, other.address, 1, 5, "0x");
      await expect(market.connect(buyer).buy(1, 1, { value: ETH("2") })).to.be.reverted; // ERC1155 insufficient balance
    });
  });

  describe("offers", function () {
    it("escrows exactly qty*price and emits OfferMade", async function () {
      const total = ETH("1.5") * 2n;
      await expect(market.connect(buyer).makeOffer(1, 2, ETH("1.5"), { value: total }))
        .to.emit(market, "OfferMade").withArgs(1n, buyer.address, 1n, 2n, ETH("1.5"));
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(total);
      const o = await market.offers(1);
      expect(o.buyer).to.equal(buyer.address);
      expect(o.escrow).to.equal(total);
      expect(o.active).to.equal(true);
    });

    it("reverts when escrow != qty*price", async function () {
      await expect(market.connect(buyer).makeOffer(1, 2, ETH("1.5"), { value: ETH("1.5") }))
        .to.be.revertedWith("wrong escrow");
    });

    it("lets the buyer cancel and reclaim escrow", async function () {
      const total = ETH("1.5") * 2n;
      await market.connect(buyer).makeOffer(1, 2, ETH("1.5"), { value: total });
      const before = await ethers.provider.getBalance(buyer.address);
      const tx = await market.connect(buyer).cancelOffer(1);
      const rcpt = await tx.wait();
      const gas = rcpt.gasUsed * rcpt.gasPrice;
      expect((await ethers.provider.getBalance(buyer.address)) - before).to.equal(total - gas);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
      expect((await market.offers(1)).active).to.equal(false);
    });

    it("only the buyer can cancel", async function () {
      await market.connect(buyer).makeOffer(1, 1, ETH("1.5"), { value: ETH("1.5") });
      await expect(market.connect(other).cancelOffer(1)).to.be.revertedWith("not buyer");
    });

    it("seller accepts: editions to buyer, escrow split royalty/fee/seller", async function () {
      const qty = 2n;
      const price = ETH("1.5");
      const total = price * qty; // 3 ETH
      const royalty = (total * ROYALTY_BPS) / 10000n;
      const fee = (total * FEE_BPS) / 10000n;
      const toSeller = total - royalty - fee;

      await market.connect(buyer).makeOffer(1, 2, price, { value: total });

      const artistBefore = await ethers.provider.getBalance(artist.address);
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
      const sellerBefore = await ethers.provider.getBalance(seller.address);

      const tx = await market.connect(seller).acceptOffer(1);
      const rcpt = await tx.wait();
      const gas = rcpt.gasUsed * rcpt.gasPrice;

      expect(await music.balanceOf(buyer.address, 1)).to.equal(qty);
      expect((await ethers.provider.getBalance(artist.address)) - artistBefore).to.equal(royalty);
      expect((await ethers.provider.getBalance(feeRecipient.address)) - feeBefore).to.equal(fee);
      expect((await ethers.provider.getBalance(seller.address)) - sellerBefore).to.equal(toSeller - gas);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
      expect((await market.offers(1)).active).to.equal(false);
    });

    it("reverts accept when acceptor lacks balance or approval", async function () {
      await market.connect(buyer).makeOffer(1, 1, ETH("1.5"), { value: ETH("1.5") });
      await expect(market.connect(other).acceptOffer(1)).to.be.revertedWith("insufficient balance");
      await music.connect(seller).setApprovalForAll(await market.getAddress(), false);
      await expect(market.connect(seller).acceptOffer(1)).to.be.revertedWith("not approved");
    });

    it("buyer cannot accept their own offer", async function () {
      await music.connect(buyer).buy(1, 1, { value: ETH("1") });
      await music.connect(buyer).setApprovalForAll(await market.getAddress(), true);
      await market.connect(buyer).makeOffer(1, 1, ETH("1.5"), { value: ETH("1.5") });
      await expect(market.connect(buyer).acceptOffer(1)).to.be.revertedWith("self");
    });

    it("cannot accept or cancel twice (escrow drained once)", async function () {
      await market.connect(buyer).makeOffer(1, 1, ETH("1.5"), { value: ETH("1.5") });
      await market.connect(seller).acceptOffer(1);
      await expect(market.connect(seller).acceptOffer(1)).to.be.revertedWith("inactive");
      await expect(market.connect(buyer).cancelOffer(1)).to.be.revertedWith("inactive");
    });
  });

  describe("admin", function () {
    it("owner sets fee and recipient within bounds", async function () {
      await market.connect(owner).setPlatformFee(500);
      expect(await market.platformFeeBps()).to.equal(500n);
      await expect(market.connect(owner).setPlatformFee(1001)).to.be.revertedWith(">10%");
      await market.connect(owner).setFeeRecipient(other.address);
      expect(await market.feeRecipient()).to.equal(other.address);
      await expect(market.connect(owner).setFeeRecipient(ethers.ZeroAddress)).to.be.revertedWith("fee=0");
    });
    it("non-owner cannot change fees", async function () {
      await expect(market.connect(buyer).setPlatformFee(100)).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });

  describe("reentrancy", function () {
    it("buy is guarded against a re-entering buyer (refund hook)", async function () {
      // A malicious buyer whose receive() re-enters buy() during the refund.
      const Mal = await ethers.getContractFactory("MaliciousMarketBuyer");
      const mal = await Mal.deploy(await market.getAddress());
      await mal.waitForDeployment();
      await market.connect(seller).list(1, 2, ETH("2")); // listingId 1
      await mal.setAttack(1, 1);
      // overpay so the refund path triggers receive() -> re-enter -> guard revert
      await expect(mal.attack({ value: ETH("3") })).to.be.revertedWith("refund fail");
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
    });
  });
});
