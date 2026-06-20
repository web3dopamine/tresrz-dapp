// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TresrzMarketplace
 * @notice Secondary market for TresrzMusic (ERC-1155) editions.
 *
 *  - Listings: a holder lists `qty` editions of a tokenId at a fixed price per
 *    unit. Buyers purchase any amount up to the listed quantity. Tokens stay in
 *    the seller's wallet (escrow-free) and are pulled via `safeTransferFrom`
 *    on purchase, so the seller must `setApprovalForAll(marketplace, true)`.
 *  - Offers: a buyer escrows ETH for `qty` editions at a price per unit. Any
 *    holder of that tokenId can accept, transferring editions to the buyer and
 *    receiving the escrowed funds (minus royalty + platform fee).
 *  - Royalties (EIP-2981) are honoured on every secondary sale: the creator's
 *    `royaltyInfo` cut is paid first, then the platform fee, then the seller.
 *
 *  This contract never custodies tokens and only escrows ETH for open offers,
 *  which the offerer can reclaim at any time by cancelling.
 */
contract TresrzMarketplace is Ownable, ReentrancyGuard {
    IERC1155 public immutable nft;

    uint16  public platformFeeBps = 250; // 2.5% on secondary sales
    address public feeRecipient;

    struct Listing {
        address seller;
        uint256 tokenId;
        uint64  qty;          // editions still available in this listing
        uint96  pricePerUnit; // wei
        bool    active;
    }

    struct Offer {
        address buyer;
        uint256 tokenId;
        uint64  qty;
        uint96  pricePerUnit; // wei
        uint256 escrow;       // total wei locked = qty * pricePerUnit
        bool    active;
    }

    uint256 public nextListingId = 1;
    uint256 public nextOfferId = 1;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer)   public offers;

    event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint64 qty, uint96 pricePerUnit);
    event ListingUpdated(uint256 indexed listingId, uint64 qty, uint96 pricePerUnit);
    event ListingCancelled(uint256 indexed listingId);
    event Sale(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 tokenId, uint64 qty, uint256 paid, uint256 royalty, uint256 fee);

    event OfferMade(uint256 indexed offerId, address indexed buyer, uint256 indexed tokenId, uint64 qty, uint96 pricePerUnit);
    event OfferCancelled(uint256 indexed offerId);
    event OfferAccepted(uint256 indexed offerId, address indexed seller, address indexed buyer, uint256 tokenId, uint64 qty, uint256 paid, uint256 royalty, uint256 fee);

    constructor(address _nft, address _feeRecipient) Ownable(msg.sender) {
        require(_nft != address(0), "nft=0");
        require(_feeRecipient != address(0), "fee=0");
        nft = IERC1155(_nft);
        feeRecipient = _feeRecipient;
    }

    // ----------------------------------------------------------------- listings

    /// @notice List `qty` editions of `tokenId` at `pricePerUnit` wei each.
    function list(uint256 tokenId, uint64 qty, uint96 pricePerUnit) external returns (uint256 listingId) {
        require(qty > 0, "qty=0");
        require(pricePerUnit > 0, "price=0");
        require(nft.balanceOf(msg.sender, tokenId) >= qty, "insufficient balance");
        require(nft.isApprovedForAll(msg.sender, address(this)), "not approved");

        listingId = nextListingId++;
        listings[listingId] = Listing(msg.sender, tokenId, qty, pricePerUnit, true);
        emit Listed(listingId, msg.sender, tokenId, qty, pricePerUnit);
    }

    /// @notice Change the remaining quantity and/or price of an active listing.
    function updateListing(uint256 listingId, uint64 qty, uint96 pricePerUnit) external {
        Listing storage l = listings[listingId];
        require(l.active, "inactive");
        require(l.seller == msg.sender, "not seller");
        require(qty > 0, "qty=0");
        require(pricePerUnit > 0, "price=0");
        require(nft.balanceOf(msg.sender, l.tokenId) >= qty, "insufficient balance");
        l.qty = qty;
        l.pricePerUnit = pricePerUnit;
        emit ListingUpdated(listingId, qty, pricePerUnit);
    }

    function cancelListing(uint256 listingId) external {
        Listing storage l = listings[listingId];
        require(l.active, "inactive");
        require(l.seller == msg.sender || msg.sender == owner(), "auth");
        l.active = false;
        emit ListingCancelled(listingId);
    }

    /// @notice Buy `qty` editions from a listing. Overpayment is refunded.
    function buy(uint256 listingId, uint64 qty) external payable nonReentrant {
        Listing storage l = listings[listingId];
        require(l.active, "inactive");
        require(qty > 0 && qty <= l.qty, "bad qty");

        uint256 total = uint256(l.pricePerUnit) * qty;
        require(msg.value >= total, "underpaid");

        address seller = l.seller;
        uint256 tokenId = l.tokenId;

        // effects before interactions
        l.qty -= qty;
        if (l.qty == 0) l.active = false;

        // pull editions from seller -> buyer (seller must stay approved/solvent)
        nft.safeTransferFrom(seller, msg.sender, tokenId, qty, "");

        (uint256 royalty, uint256 fee) = _settle(tokenId, total, seller);

        if (msg.value > total) {
            (bool r, ) = msg.sender.call{value: msg.value - total}("");
            require(r, "refund fail");
        }
        emit Sale(listingId, seller, msg.sender, tokenId, qty, total, royalty, fee);
    }

    // ------------------------------------------------------------------- offers

    /// @notice Make an offer for `qty` editions of `tokenId` at `pricePerUnit`,
    ///         escrowing the full amount until accepted or cancelled.
    function makeOffer(uint256 tokenId, uint64 qty, uint96 pricePerUnit) external payable returns (uint256 offerId) {
        require(qty > 0, "qty=0");
        require(pricePerUnit > 0, "price=0");
        uint256 total = uint256(pricePerUnit) * qty;
        require(msg.value == total, "wrong escrow");

        offerId = nextOfferId++;
        offers[offerId] = Offer(msg.sender, tokenId, qty, pricePerUnit, total, true);
        emit OfferMade(offerId, msg.sender, tokenId, qty, pricePerUnit);
    }

    /// @notice Offerer reclaims their escrow and closes the offer.
    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage o = offers[offerId];
        require(o.active, "inactive");
        require(o.buyer == msg.sender, "not buyer");
        o.active = false;
        uint256 amount = o.escrow;
        o.escrow = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "refund fail");
        emit OfferCancelled(offerId);
    }

    /// @notice A holder accepts an open offer, delivering editions to the buyer
    ///         and receiving the escrow minus royalty and platform fee.
    function acceptOffer(uint256 offerId) external nonReentrant {
        Offer storage o = offers[offerId];
        require(o.active, "inactive");
        require(o.buyer != msg.sender, "self");
        require(nft.balanceOf(msg.sender, o.tokenId) >= o.qty, "insufficient balance");
        require(nft.isApprovedForAll(msg.sender, address(this)), "not approved");

        o.active = false;
        uint256 total = o.escrow;
        o.escrow = 0;
        uint256 tokenId = o.tokenId;
        uint64 qty = o.qty;
        address buyer = o.buyer;

        nft.safeTransferFrom(msg.sender, buyer, tokenId, qty, "");
        (uint256 royalty, uint256 fee) = _settle(tokenId, total, msg.sender);
        emit OfferAccepted(offerId, msg.sender, buyer, tokenId, qty, total, royalty, fee);
    }

    // -------------------------------------------------------------------- admin

    function setPlatformFee(uint16 bps) external onlyOwner {
        require(bps <= 1000, ">10%");
        platformFeeBps = bps;
    }

    function setFeeRecipient(address r) external onlyOwner {
        require(r != address(0), "fee=0");
        feeRecipient = r;
    }

    // ----------------------------------------------------------------- internal

    /// @dev Pay royalty (EIP-2981) then platform fee, then the seller. Returns
    ///      the royalty and fee amounts actually paid.
    function _settle(uint256 tokenId, uint256 total, address seller) internal returns (uint256 royalty, uint256 fee) {
        // resolve EIP-2981 royalty defensively (NFT may not implement it)
        address royaltyReceiver = address(0);
        try IERC2981(address(nft)).royaltyInfo(tokenId, total) returns (address recv, uint256 amount) {
            if (recv != address(0) && amount > 0 && amount < total) {
                royaltyReceiver = recv;
                royalty = amount;
            }
        } catch {}

        fee = (total * platformFeeBps) / 10_000;
        // guard against fee + royalty exceeding the sale (only possible with
        // pathological royalty values, which we already bounded out above)
        require(royalty + fee <= total, "fees>total");

        if (royalty > 0) {
            (bool ro, ) = royaltyReceiver.call{value: royalty}("");
            require(ro, "royalty pay fail");
        }
        if (fee > 0) {
            (bool fo, ) = feeRecipient.call{value: fee}("");
            require(fo, "fee pay fail");
        }
        uint256 toSeller = total - royalty - fee;
        (bool so, ) = seller.call{value: toSeller}("");
        require(so, "seller pay fail");
    }
}
