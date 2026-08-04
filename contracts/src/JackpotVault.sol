// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./Interfaces.sol";

/// @title JackpotVault
/// @notice Holds the jackpot: 20% of every pack sale accrues here in USDG, and the
///         site displays this balance as the live jackpot. Hidden cards pay out of it
///         instantly and automatically. Everything else is distributed manually by the
///         operator — there is no on-chain claim mechanism and no automatic payout.
contract JackpotVault {
    IERC20 public immutable usdg;
    address public owner;
    address public packSale;

    /// @notice Lifetime USDG accrued from pack sales (never decreases) — the volume figure.
    uint256 public totalAccrued;
    /// @notice Lifetime USDG paid out to hidden-card winners.
    uint256 public totalHiddenCardPaid;
    /// @notice Lifetime USDG withdrawn by the operator for manual distribution.
    uint256 public totalWithdrawn;

    event Accrued(address indexed buyer, uint256 amount, uint256 totalAccrued);
    event HiddenCardAward(address indexed user, uint256 pctBps, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error NotPackSale();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPackSale() {
        if (msg.sender != packSale) revert NotPackSale();
        _;
    }

    constructor(IERC20 _usdg) {
        usdg = _usdg;
        owner = msg.sender;
    }

    /// @notice Current jackpot balance — what the site shows.
    function available() public view returns (uint256) {
        return usdg.balanceOf(address(this));
    }

    function setPackSale(address _packSale) external onlyOwner {
        packSale = _packSale;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Called by PackSale on every purchase to record volume.
    function recordSale(address buyer, uint256 amount) external onlyPackSale {
        totalAccrued += amount;
        emit Accrued(buyer, amount, totalAccrued);
    }

    /// @notice Hidden cards pay a % of the current jackpot, instantly, to the puller.
    function awardHiddenCard(address user, uint256 pctBps) external onlyPackSale returns (uint256 amount) {
        amount = (available() * pctBps) / 10_000;
        if (amount > 0) {
            totalHiddenCardPaid += amount;
            if (!usdg.transfer(user, amount)) revert TransferFailed();
        }
        emit HiddenCardAward(user, pctBps, amount);
    }

    /// @notice Operator withdraws to distribute the jackpot manually.
    function withdraw(address to, uint256 amount) external onlyOwner {
        totalWithdrawn += amount;
        if (!usdg.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount);
    }
}
