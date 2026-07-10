// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TresrzMusic
 * @notice Each tokenId is a music track. `maxSupply` = number of editions.
 *         Artists mint a track (defining editions + price + royalty), buyers
 *         purchase editions on the primary market. Royalties via ERC-2981.
 */
contract TresrzMusic is ERC1155, ERC2981, Ownable, ReentrancyGuard {
    struct Track {
        address artist;
        uint96  price;        // wei per edition
        uint64  maxSupply;
        uint64  minted;
        string  uri;          // metadata URI (IPFS / https)
        bool    active;
    }

    uint256 public nextTrackId = 1;
    uint16  public platformFeeBps = 250; // 2.5%
    address public feeRecipient;

    mapping(uint256 => Track) public tracks;

    event TrackMinted(uint256 indexed trackId, address indexed artist, uint64 maxSupply, uint96 price, string uri);
    event TrackPurchased(uint256 indexed trackId, address indexed buyer, uint64 qty, uint256 paid);

    constructor(address _feeRecipient) ERC1155("") Ownable(msg.sender) {
        feeRecipient = _feeRecipient;
    }

    /// @notice Artist registers a new track and its edition run.
    function mintTrack(
        uint64 maxSupply,
        uint96 price,
        uint96 royaltyBps,
        string calldata metadataUri
    ) external returns (uint256 trackId) {
        require(maxSupply > 0, "supply=0");
        require(royaltyBps <= 1000, "royalty>10%");
        trackId = nextTrackId++;
        tracks[trackId] = Track(msg.sender, price, maxSupply, 0, metadataUri, true);
        _setTokenRoyalty(trackId, msg.sender, uint96(royaltyBps));
        emit TrackMinted(trackId, msg.sender, maxSupply, price, metadataUri);
    }

    /// @notice Register many tracks in a single transaction (bulk collection
    ///         import). One base tx cost instead of N, and ~100x fewer txs.
    ///         All four arrays must be the same length. Returns the first
    ///         assigned trackId and the count minted (ids are contiguous).
    function batchMintTracks(
        uint64[] calldata maxSupplies,
        uint96[] calldata prices,
        uint96[] calldata royaltyBpsList,
        string[] calldata metadataUris
    ) external returns (uint256 firstTrackId, uint256 count) {
        count = metadataUris.length;
        require(count > 0, "empty");
        require(maxSupplies.length == count && prices.length == count && royaltyBpsList.length == count, "len mismatch");
        firstTrackId = nextTrackId;
        for (uint256 i = 0; i < count; i++) {
            require(maxSupplies[i] > 0, "supply=0");
            require(royaltyBpsList[i] <= 1000, "royalty>10%");
            uint256 trackId = nextTrackId++;
            tracks[trackId] = Track(msg.sender, prices[i], maxSupplies[i], 0, metadataUris[i], true);
            _setTokenRoyalty(trackId, msg.sender, royaltyBpsList[i]);
            emit TrackMinted(trackId, msg.sender, maxSupplies[i], prices[i], metadataUris[i]);
        }
    }

    /// @notice Buy `qty` editions of a track on the primary market.
    function buy(uint256 trackId, uint64 qty) external payable nonReentrant {
        Track storage t = tracks[trackId];
        require(t.active, "inactive");
        require(qty > 0 && t.minted + qty <= t.maxSupply, "sold out");
        uint256 total = uint256(t.price) * qty;
        require(msg.value >= total, "underpaid");

        t.minted += qty;
        _mint(msg.sender, trackId, qty, "");

        uint256 fee = (total * platformFeeBps) / 10_000;
        (bool a, ) = t.artist.call{value: total - fee}("");
        require(a, "artist pay fail");
        if (fee > 0) {
            (bool f, ) = feeRecipient.call{value: fee}("");
            require(f, "fee pay fail");
        }
        if (msg.value > total) {
            (bool r, ) = msg.sender.call{value: msg.value - total}("");
            require(r, "refund fail");
        }
        emit TrackPurchased(trackId, msg.sender, qty, total);
    }

    function editionsLeft(uint256 trackId) external view returns (uint64) {
        Track storage t = tracks[trackId];
        return t.maxSupply - t.minted;
    }

    function uri(uint256 trackId) public view override returns (string memory) {
        return tracks[trackId].uri;
    }

    // --- admin ---
    function setPlatformFee(uint16 bps) external onlyOwner { require(bps <= 1000, ">10%"); platformFeeBps = bps; }
    function setFeeRecipient(address r) external onlyOwner { feeRecipient = r; }
    function setActive(uint256 trackId, bool v) external {
        require(msg.sender == tracks[trackId].artist || msg.sender == owner(), "auth");
        tracks[trackId].active = v;
    }

    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}
