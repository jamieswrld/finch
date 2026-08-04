// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./Interfaces.sol";

/// @title PonsAirdrop
/// @notice Distributes PONS creator fees back to holders as RWA airdrops (stock tokens
///         or USDG), in epochs. Each epoch is a merkle tree over (holder, amount) built
///         from a public snapshot with a fixed, published split:
///
///           95% → the top 10 PONS wallets at snapshot, weighted by balance
///            5% → every other holder, pro-rata
///
///         The split lives in `TOP_SHARE_BPS` so the docs can point at the chain, and the
///         full snapshot + tree is published with every epoch (see scripts/build-airdrop.mjs).
///         Funding an epoch escrows the tokens here; only holders in the tree can pull them.
contract PonsAirdrop {
    /// @notice Share of every epoch that goes to the top TOP_COUNT wallets, in bps.
    uint16 public constant TOP_SHARE_BPS = 9_500;
    uint8 public constant TOP_COUNT = 10;

    address public owner;

    struct Epoch {
        address token; // RWA / USDG being dropped
        bytes32 merkleRoot;
        uint256 total;
        uint256 claimed;
    }

    Epoch[] public epochs;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event EpochCreated(uint256 indexed epochId, address indexed token, bytes32 merkleRoot, uint256 total);
    event Claimed(uint256 indexed epochId, address indexed account, uint256 amount);

    error NotOwner();
    error AlreadyClaimed();
    error InvalidProof();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function epochCount() external view returns (uint256) {
        return epochs.length;
    }

    /// @notice Publish an epoch and escrow its full amount in the same transaction.
    function createEpoch(address token, bytes32 merkleRoot, uint256 total)
        external
        onlyOwner
        returns (uint256 epochId)
    {
        if (!IERC20(token).transferFrom(msg.sender, address(this), total)) revert TransferFailed();
        epochId = epochs.length;
        epochs.push(Epoch({token: token, merkleRoot: merkleRoot, total: total, claimed: 0}));
        emit EpochCreated(epochId, token, merkleRoot, total);
    }

    /// @notice Claim an epoch allocation. Permissionless — anyone can claim on a holder's
    ///         behalf; tokens always go to the snapshotted account.
    function claim(uint256 epochId, address account, uint256 amount, bytes32[] calldata proof) external {
        Epoch storage e = epochs[epochId];
        if (claimed[epochId][account]) revert AlreadyClaimed();

        bytes32 node = keccak256(abi.encodePacked(account, amount));
        if (!_verify(proof, e.merkleRoot, node)) revert InvalidProof();

        claimed[epochId][account] = true;
        e.claimed += amount;
        if (!IERC20(e.token).transfer(account, amount)) revert TransferFailed();
        emit Claimed(epochId, account, amount);
    }

    /// @dev Standard sorted-pair merkle verification.
    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            computed = computed <= p
                ? keccak256(abi.encodePacked(computed, p))
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == root;
    }
}
