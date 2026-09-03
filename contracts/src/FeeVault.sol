// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title FeeVault
/// @notice Receiving address for Finch's 3% Pons creator tax (and any other
///         protocol revenue). Funds can only ever move to the immutable
///         Finch treasury wallet — sweeping ("claiming") is permissionless
///         because the destination is fixed. Emits indexable events for the
///         public treasury ledger ("The Nest").
/// @dev    Pons' own protocol fee never touches this vault; Finch revenue is
///         the creator tax only.
contract FeeVault {
    /// @notice The flat Finch treasury wallet. Immutable by design.
    address public immutable treasury;

    event NativeReceived(address indexed from, uint256 amount);
    event FeesSwept(address indexed token, uint256 amount, address indexed to);

    error ZeroTreasury();
    error NothingToSweep();
    error SweepFailed();

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        treasury = treasury_;
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    /// @notice Move the full native balance to the treasury. Callable by anyone.
    function sweepNative() external {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToSweep();
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert SweepFailed();
        emit FeesSwept(address(0), amount, treasury);
    }

    /// @notice Move the full balance of an ERC20 to the treasury. Callable by anyone.
    function sweepERC20(IERC20 token) external {
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingToSweep();
        bool ok = token.transfer(treasury, amount);
        if (!ok) revert SweepFailed();
        emit FeesSwept(address(token), amount, treasury);
    }
}
