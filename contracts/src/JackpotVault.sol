// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./Interfaces.sol";

/// @title JackpotVault
/// @notice Accrues a USDG cut of every pack sale. Pays hidden-card winners a % of the
///         open pot immediately, and distributes the remaining pot pro-rata to ticket
///         holders after each round's payout date. Tickets = USDG spent on packs.
contract JackpotVault {
    IERC20 public immutable usdg;
    address public owner;
    address public packSale;

    struct Round {
        uint64 payoutDate;
        bool closed;
        uint256 snapshot; // pot frozen for this round's claims
        uint256 totalTickets;
    }

    uint256 public currentRound = 1;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => uint256)) public tickets;
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice USDG earmarked for closed-round claims; hidden cards can't touch it.
    uint256 public reserved;

    event TicketsAdded(uint256 indexed round, address indexed user, uint256 amount);
    event HiddenCardAward(address indexed user, uint256 pctBps, uint256 amount);
    event RoundClosed(uint256 indexed round, uint256 snapshot, uint256 totalTickets);
    event Claimed(uint256 indexed round, address indexed user, uint256 amount);

    error NotOwner();
    error NotPackSale();
    error RoundNotClaimable();
    error AlreadyClaimed();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPackSale() {
        if (msg.sender != packSale) revert NotPackSale();
        _;
    }

    constructor(IERC20 _usdg, uint64 firstPayoutDate) {
        usdg = _usdg;
        owner = msg.sender;
        rounds[1].payoutDate = firstPayoutDate;
    }

    /// @notice Open pot available for hidden cards / the next snapshot.
    function available() public view returns (uint256) {
        return usdg.balanceOf(address(this)) - reserved;
    }

    function setPackSale(address _packSale) external onlyOwner {
        packSale = _packSale;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function addTickets(address user, uint256 amount) external onlyPackSale {
        Round storage r = rounds[currentRound];
        r.totalTickets += amount;
        tickets[currentRound][user] += amount;
        emit TicketsAdded(currentRound, user, amount);
    }

    function awardHiddenCard(address user, uint256 pctBps) external onlyPackSale returns (uint256 amount) {
        amount = (available() * pctBps) / 10_000;
        if (amount > 0 && !usdg.transfer(user, amount)) revert TransferFailed();
        emit HiddenCardAward(user, pctBps, amount);
    }

    /// @notice After the payout date, freeze the open pot for pro-rata claims and roll
    ///         into the next round.
    function closeRound(uint64 nextPayoutDate) external onlyOwner {
        Round storage r = rounds[currentRound];
        if (r.closed || block.timestamp < r.payoutDate) revert RoundNotClaimable();
        r.closed = true;
        r.snapshot = available();
        reserved += r.snapshot;
        emit RoundClosed(currentRound, r.snapshot, r.totalTickets);
        currentRound += 1;
        rounds[currentRound].payoutDate = nextPayoutDate;
    }

    function claimable(uint256 roundId, address user) public view returns (uint256) {
        Round storage r = rounds[roundId];
        if (!r.closed || r.totalTickets == 0 || claimed[roundId][user]) return 0;
        return (r.snapshot * tickets[roundId][user]) / r.totalTickets;
    }

    function claim(uint256 roundId) external {
        Round storage r = rounds[roundId];
        if (!r.closed) revert RoundNotClaimable();
        if (claimed[roundId][msg.sender]) revert AlreadyClaimed();
        uint256 share = claimable(roundId, msg.sender);
        claimed[roundId][msg.sender] = true;
        if (share > 0) {
            reserved -= share;
            if (!usdg.transfer(msg.sender, share)) revert TransferFailed();
        }
        emit Claimed(roundId, msg.sender, share);
    }
}
