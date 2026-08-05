// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRandomness} from "./interfaces/IRandomness.sol";

/// @title CommitRevealRandomness
/// @notice Binds each request to a future block hash. The outcome is fixed the moment
///         a pack is bought, but unknowable to everyone — buyer, operator, and builder
///         — until that block is mined.
///
///         Block hashes are only available for 256 blocks, so a request left unrevealed
///         past that window expires and must be re-armed against a fresh block. That is
///         not a loss: re-arming costs the buyer nothing and cannot be steered, because
///         reveal is permissionless and a keeper settles promptly.
///
///         Replaceable by a VRF-backed implementation behind the same interface.
contract CommitRevealRandomness is IRandomness {
    address public owner;
    /// @notice Contracts allowed to commit. Usually just the sale contract.
    mapping(address => bool) public authorized;
    /// @notice requestId => block whose hash decides the outcome, scoped per caller.
    mapping(address => mapping(uint256 => uint64)) public commitBlockOf;

    event Committed(address indexed caller, uint256 indexed requestId, uint64 commitBlock);
    event Rearmed(address indexed caller, uint256 indexed requestId, uint64 commitBlock);
    event AuthorizedSet(address indexed who, bool allowed);

    error NotOwner();
    error NotAuthorized();
    error NotCommitted();
    error NotReady();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setAuthorized(address who, bool allowed) external onlyOwner {
        authorized[who] = allowed;
        emit AuthorizedSet(who, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function commit(uint256 requestId) external override {
        if (!authorized[msg.sender]) revert NotAuthorized();
        commitBlockOf[msg.sender][requestId] = uint64(block.number);
        emit Committed(msg.sender, requestId, uint64(block.number));
    }

    function isReady(uint256 requestId) external view override returns (bool) {
        uint64 b = commitBlockOf[msg.sender][requestId];
        if (b == 0 || block.number <= b) return false;
        return blockhash(b) != bytes32(0);
    }

    function isExpired(uint256 requestId) external view override returns (bool) {
        uint64 b = commitBlockOf[msg.sender][requestId];
        if (b == 0 || block.number <= b) return false;
        return blockhash(b) == bytes32(0);
    }

    function rearm(uint256 requestId) external override {
        if (!authorized[msg.sender]) revert NotAuthorized();
        uint64 b = commitBlockOf[msg.sender][requestId];
        if (b == 0) revert NotCommitted();
        commitBlockOf[msg.sender][requestId] = uint64(block.number);
        emit Rearmed(msg.sender, requestId, uint64(block.number));
    }

    function reveal(uint256 requestId) external view override returns (uint256) {
        uint64 b = commitBlockOf[msg.sender][requestId];
        if (b == 0 || block.number <= b) revert NotReady();
        bytes32 bh = blockhash(b);
        if (bh == bytes32(0)) revert NotReady();
        return uint256(keccak256(abi.encode(bh, msg.sender, requestId)));
    }

    /// @notice Read helpers that work from off-chain callers (no msg.sender context).
    function isReadyFor(address caller, uint256 requestId) external view returns (bool) {
        uint64 b = commitBlockOf[caller][requestId];
        if (b == 0 || block.number <= b) return false;
        return blockhash(b) != bytes32(0);
    }

    function commitBlockFor(address caller, uint256 requestId) external view returns (uint64) {
        return commitBlockOf[caller][requestId];
    }
}
