const { expect } = require("chai");
const { ethers } = require("hardhat");

const ETH = (n) => ethers.parseEther(String(n));
const FEE_BPS = 250n; // 2.5% platform fee

describe("TresrzMusic", function () {
  let music, owner, feeRecipient, artist, buyer, other;

  beforeEach(async function () {
    [owner, feeRecipient, artist, buyer, other] = await ethers.getSigners();
    const Music = await ethers.getContractFactory("TresrzMusic");
    music = await Music.deploy(feeRecipient.address);
    await music.waitForDeployment();
  });

  describe("mintTrack", function () {
    it("mints a track, sets fields, emits event, increments nextTrackId", async function () {
      expect(await music.nextTrackId()).to.equal(1n);
      await expect(music.connect(artist).mintTrack(10, ETH("1"), 500, "ipfs://x"))
        .to.emit(music, "TrackMinted")
        .withArgs(1n, artist.address, 10n, ETH("1"), "ipfs://x");
      expect(await music.nextTrackId()).to.equal(2n);

      const t = await music.tracks(1);
      expect(t.artist).to.equal(artist.address);
      expect(t.price).to.equal(ETH("1"));
      expect(t.maxSupply).to.equal(10n);
      expect(t.minted).to.equal(0n);
      expect(t.active).to.equal(true);
      expect(await music.editionsLeft(1)).to.equal(10n);
    });

    it("sets the ERC-2981 royalty (bounds: accepts up to 10%)", async function () {
      await music.connect(artist).mintTrack(5, ETH("1"), 1000, "x"); // 10% — max allowed
      const [recv, amount] = await music.royaltyInfo(1, ETH("2"));
      expect(recv).to.equal(artist.address);
      expect(amount).to.equal(ETH("0.2")); // 10% of 2 ETH
    });

    it("reverts when maxSupply is 0", async function () {
      await expect(music.connect(artist).mintTrack(0, ETH("1"), 500, "x")).to.be.revertedWith("supply=0");
    });

    it("reverts when royalty exceeds 10%", async function () {
      await expect(music.connect(artist).mintTrack(5, ETH("1"), 1001, "x")).to.be.revertedWith("royalty>10%");
    });
  });

  describe("buy", function () {
    const PRICE = ETH("1");

    beforeEach(async function () {
      await music.connect(artist).mintTrack(3, PRICE, 500, "x"); // trackId 1, supply 3
    });

    it("mints editions to the buyer and emits TrackPurchased", async function () {
      await expect(music.connect(buyer).buy(1, 2, { value: PRICE * 2n }))
        .to.emit(music, "TrackPurchased")
        .withArgs(1n, buyer.address, 2n, PRICE * 2n);
      expect(await music.balanceOf(buyer.address, 1)).to.equal(2n);
      expect(await music.editionsLeft(1)).to.equal(1n);
    });

    it("splits funds: fee -> feeRecipient, remainder -> artist, nothing stuck", async function () {
      const qty = 2n;
      const total = PRICE * qty;
      const fee = (total * FEE_BPS) / 10000n;

      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
      const artistBefore = await ethers.provider.getBalance(artist.address);

      await music.connect(buyer).buy(1, qty, { value: total });

      expect((await ethers.provider.getBalance(feeRecipient.address)) - feeBefore).to.equal(fee);
      expect((await ethers.provider.getBalance(artist.address)) - artistBefore).to.equal(total - fee);
      // no ETH should remain in the contract
      expect(await ethers.provider.getBalance(await music.getAddress())).to.equal(0n);
    });

    it("refunds overpayment (buyer net cost == price, contract holds nothing)", async function () {
      const total = PRICE; // buying 1
      const overpay = ETH("0.5");
      const feeBefore = await ethers.provider.getBalance(feeRecipient.address);
      const artistBefore = await ethers.provider.getBalance(artist.address);

      const tx = await music.connect(buyer).buy(1, 1, { value: total + overpay });
      const rcpt = await tx.wait();
      const gas = rcpt.gasUsed * rcpt.gasPrice;

      // buyer only spent `total` + gas (overpayment refunded)
      // verify by recipients receiving exactly `total` and contract empty
      const fee = (total * FEE_BPS) / 10000n;
      expect((await ethers.provider.getBalance(feeRecipient.address)) - feeBefore).to.equal(fee);
      expect((await ethers.provider.getBalance(artist.address)) - artistBefore).to.equal(total - fee);
      expect(await ethers.provider.getBalance(await music.getAddress())).to.equal(0n);
      expect(gas).to.be.greaterThan(0n);
    });

    it("reverts when underpaid", async function () {
      await expect(music.connect(buyer).buy(1, 1, { value: PRICE - 1n })).to.be.revertedWith("underpaid");
    });

    it("reverts when sold out (qty exceeds remaining supply)", async function () {
      await expect(music.connect(buyer).buy(1, 4, { value: PRICE * 4n })).to.be.revertedWith("sold out");
    });

    it("reverts when buying an inactive track", async function () {
      await music.connect(artist).setActive(1, false);
      await expect(music.connect(buyer).buy(1, 1, { value: PRICE })).to.be.revertedWith("inactive");
    });

    it("reverts when buying a non-existent track (inactive by default)", async function () {
      await expect(music.connect(buyer).buy(999, 1, { value: PRICE })).to.be.revertedWith("inactive");
    });
  });

  describe("reentrancy", function () {
    it("blocks a malicious artist from re-entering buy() during payout", async function () {
      const Mal = await ethers.getContractFactory("MaliciousArtist");
      const mal = await Mal.deploy(await music.getAddress());
      await mal.waitForDeployment();

      // malicious contract becomes the artist of a track
      await mal.mint(5, ETH("1"));
      const trackId = await mal.trackId();
      await mal.setAttack(true);

      // buying triggers payout to `mal`, whose receive() re-enters buy() -> guard reverts,
      // so the artist payout call fails and the whole purchase reverts.
      await expect(music.connect(buyer).buy(trackId, 1, { value: ETH("1") })).to.be.revertedWith("artist pay fail");

      // state unchanged: nothing minted, no ETH stuck
      expect(await music.balanceOf(buyer.address, trackId)).to.equal(0n);
      expect(await music.editionsLeft(trackId)).to.equal(5n);
      expect(await ethers.provider.getBalance(await music.getAddress())).to.equal(0n);
    });
  });
});

describe("TresrzMusic — setPrice / batchSetPrice", function () {
  const ETH2 = (n) => ethers.parseEther(String(n));
  let music, owner, feeRecipient, artist, buyer, other;

  beforeEach(async function () {
    [owner, feeRecipient, artist, buyer, other] = await ethers.getSigners();
    const Music = await ethers.getContractFactory("TresrzMusic");
    music = await Music.deploy(feeRecipient.address);
    await music.waitForDeployment();
    await music.connect(artist).mintTrack(10, ETH2("1"), 500, "ipfs://a");
    await music.connect(artist).mintTrack(10, ETH2("2"), 500, "ipfs://b");
  });

  it("artist can re-price; buy() then charges the NEW price", async function () {
    await expect(music.connect(artist).setPrice(1, ETH2("0.25")))
      .to.emit(music, "TrackPriceUpdated").withArgs(1n, ETH2("1"), ETH2("0.25"));
    expect((await music.tracks(1)).price).to.equal(ETH2("0.25"));
    // paying the new price succeeds
    await expect(music.connect(buyer).buy(1, 1, { value: ETH2("0.25") })).to.not.be.reverted;
  });

  it("owner can re-price too", async function () {
    await music.connect(owner).setPrice(1, ETH2("5"));
    expect((await music.tracks(1)).price).to.equal(ETH2("5"));
  });

  it("rejects a stranger and an unknown track", async function () {
    await expect(music.connect(other).setPrice(1, ETH2("0.1"))).to.be.revertedWith("auth");
    await expect(music.connect(owner).setPrice(999, ETH2("1"))).to.be.revertedWith("no track");
  });

  it("underpaying after a price RAISE reverts", async function () {
    await music.connect(artist).setPrice(1, ETH2("3"));
    await expect(music.connect(buyer).buy(1, 1, { value: ETH2("1") })).to.be.revertedWith("underpaid");
  });

  it("batchSetPrice updates many at once and enforces length match", async function () {
    await music.connect(artist).batchSetPrice([1, 2], [ETH2("0.01"), ETH2("0.25")]);
    expect((await music.tracks(1)).price).to.equal(ETH2("0.01"));
    expect((await music.tracks(2)).price).to.equal(ETH2("0.25"));
    await expect(music.connect(artist).batchSetPrice([1, 2], [ETH2("1")])).to.be.revertedWith("len mismatch");
  });
});
