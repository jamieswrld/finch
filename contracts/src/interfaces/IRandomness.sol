// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRandomness
/// @notice Randomness source for pack settlement. Kept behind an interface so the
///         implementation can move from commit-reveal to Chainlink VRF without
///         redeploying or migrating the core sale contract.
interface IRandomness {
    /// @notice Bind a request to a future, unknowable value. Called at purchase.
    /// @param requestId Caller-scoped id (the purchase id).
    function commit(uint256 requestId) external;

    /// @notice True once the request can be revealed.
    function isReady(uint256 requestId) external view returns (bool);

    /// @notice True when the commitment expired and must be re-armed.
    function isExpired(uint256 requestId) external view returns (bool);

    /// @notice Re-bind an expired request to a fresh future value.
    function rearm(uint256 requestId) external;

    /// @notice The random word. Reverts unless `isReady`.
    function reveal(uint256 requestId) external view returns (uint256);
}
