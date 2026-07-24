// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMarket {
    function buy(uint256 listingId, uint64 qty) external payable;
}

/// @notice Test-only: a buyer contract whose receive() re-enters Marketplace.buy()
/// during the overpayment refund. Proves the nonReentrant guard holds.
contract MaliciousMarketBuyer {
    IMarket public immutable market;
    uint256 public listingId;
    uint64  public qty;
    bool    public attacking;

    constructor(address _market) { market = IMarket(_market); }

    function setAttack(uint256 _listingId, uint64 _qty) external {
        listingId = _listingId;
        qty = _qty;
    }

    function attack() external payable {
        attacking = true;
        market.buy{value: msg.value}(listingId, qty);
    }

    // Must accept ERC-1155 transfers (it is the buyer receiving editions).
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    receive() external payable {
        if (attacking) {
            attacking = false; // re-enter exactly once
            market.buy{value: 0}(listingId, 1); // guard must revert this
        }
    }
}
