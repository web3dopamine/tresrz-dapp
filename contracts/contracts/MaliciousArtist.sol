// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMusic {
    function mintTrack(uint64 maxSupply, uint96 price, uint96 royaltyBps, string calldata uri) external returns (uint256);
    function buy(uint256 trackId, uint64 qty) external payable;
}

/// @notice Test-only: becomes a track artist, then tries to re-enter buy() when it
/// receives its sale payout. Used to prove TresrzMusic's nonReentrant guard holds.
contract MaliciousArtist {
    IMusic public immutable music;
    uint256 public trackId;
    bool public attack;

    constructor(address _music) { music = IMusic(_music); }

    function mint(uint64 supply, uint96 price) external {
        trackId = music.mintTrack(supply, price, 0, "x");
    }

    function setAttack(bool a) external { attack = a; }

    receive() external payable {
        if (attack) {
            // re-enter the primary sale; the ReentrancyGuard must make this revert
            music.buy{value: msg.value}(trackId, 1);
        }
    }
}
