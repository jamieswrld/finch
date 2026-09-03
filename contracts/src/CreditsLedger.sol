// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title CreditsLedger — DRAFT, NOT DEPLOYED
/// @notice ARCHITECTURAL SKETCH ONLY. $FINCH does not exist onchain yet and
///         no token-settled payments are live anywhere in Finch. This
///         contract pins down the intended shape of $FINCH network
///         consumption so the offchain accounting (@finch/db credits) and the
///         eventual onchain settlement share one model:
///
///           deposit $FINCH → CreditsPurchased event → offchain double-entry
///           credit issuance (user:<address> gets credits; deposits sit here
///           until swept to the treasury).
///
///         Covers, once live: compute credits, paid executions, premium APIs,
///         Aviary services, Swarm workloads, resource limits.
/// @dev    DO NOT DEPLOY without: economic review of the credit price oracle,
///         a full audit, and a live $FINCH token address.
contract CreditsLedger {
    /// @notice The $FINCH token. Zero until the token exists.
    IERC20 public immutable finch;
    /// @notice Destination for deposited tokens (FeeVault or treasury).
    address public immutable treasury;

    event CreditsPurchased(address indexed buyer, uint256 finchAmount, uint256 indexed nonce);

    error TokenNotLive();
    error TransferFailed();
    error ZeroAmount();

    uint256 public nonce;

    constructor(IERC20 finch_, address treasury_) {
        finch = finch_;
        treasury = treasury_;
    }

    /// @notice Deposit $FINCH to purchase compute credits. The credit amount
    ///         is resolved offchain from the emitted event at the prevailing
    ///         credit price — this contract only guarantees custody and an
    ///         auditable purchase trail.
    function purchaseCredits(uint256 finchAmount) external returns (uint256) {
        if (address(finch) == address(0)) revert TokenNotLive();
        if (finchAmount == 0) revert ZeroAmount();
        if (!finch.transferFrom(msg.sender, treasury, finchAmount)) revert TransferFailed();
        uint256 purchaseNonce = ++nonce;
        emit CreditsPurchased(msg.sender, finchAmount, purchaseNonce);
        return purchaseNonce;
    }
}
