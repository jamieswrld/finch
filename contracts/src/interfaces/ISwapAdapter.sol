// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISwapAdapter
/// @notice Venue-agnostic swapping for card settlement. Behind an interface so the
///         protocol can move venues (or route across several) without touching the
///         core sale logic.
interface ISwapAdapter {
    /// @notice Swap an exact amount in, sending the output to `recipient`.
    /// @dev Must revert if the output would be below `minOut`. The caller transfers
    ///      `amountIn` of `tokenIn` to the adapter first (or sends value for native).
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut);

    /// @notice Whether a route is configured for this token pair.
    function isSupported(address tokenIn, address tokenOut) external view returns (bool);
}
