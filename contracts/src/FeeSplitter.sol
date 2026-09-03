// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title FeeSplitter — immutable 90/10 fee distribution
/// @notice Point the $FINCH creator-tax recipient at this contract and the
///         split happens on receipt, with no signer and no schedule: 90% to
///         the prize wallet, 10% to operating cost. Both recipients and both
///         ratios are immutable, so what this contract will do with the next
///         wei is fully knowable from its bytecode and constructor args —
///         which is the property a distribution rule needs to be trusted.
///
///         Native ETH forwards in receive(). ERC20 fees cannot trigger code on
///         transfer, so they accumulate here until anyone calls sweepERC20(),
///         which applies the same split. Sweeping is permissionless: there is
///         nothing to gain by calling it, and nothing to lose by anyone doing so.
///
/// @dev    No owner, no pause, no upgrade. If the split must change, deploy a
///         new splitter and re-point the fee recipient.
contract FeeSplitter {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public immutable prize;
    address public immutable ops;
    uint256 public immutable prizeBps;
    uint256 public immutable opsBps;

    event NativeSplit(address indexed from, uint256 amount, uint256 toPrize, uint256 toOps);
    event ERC20Split(address indexed token, uint256 amount, uint256 toPrize, uint256 toOps);

    error ZeroAddress();
    error BadSplit();
    error NothingToSweep();
    error TransferFailed();

    /// @param prize_    receives prizeBps_ of every fee
    /// @param ops_      receives the remainder (operating cost)
    /// @param prizeBps_ basis points to prize; ops receives 10_000 - prizeBps_
    constructor(address prize_, address ops_, uint256 prizeBps_) {
        if (prize_ == address(0) || ops_ == address(0)) revert ZeroAddress();
        if (prizeBps_ == 0 || prizeBps_ >= BPS_DENOMINATOR) revert BadSplit();
        prize = prize_;
        ops = ops_;
        prizeBps = prizeBps_;
        opsBps = BPS_DENOMINATOR - prizeBps_;
    }

    /// @notice Native fees split the moment they arrive.
    receive() external payable {
        _splitNative(msg.value);
    }

    /// @notice Forward any native balance that landed without triggering receive()
    ///         (e.g. via selfdestruct or a coinbase transfer). Callable by anyone.
    function sweepNative() external {
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToSweep();
        _splitNative(amount);
    }

    /// @notice Split the full balance of an ERC20 held here. Callable by anyone.
    function sweepERC20(IERC20 token) external {
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) revert NothingToSweep();
        uint256 toPrize = (amount * prizeBps) / BPS_DENOMINATOR;
        uint256 toOps = amount - toPrize; // remainder to ops so nothing is stranded by rounding
        if (!token.transfer(prize, toPrize)) revert TransferFailed();
        if (!token.transfer(ops, toOps)) revert TransferFailed();
        emit ERC20Split(address(token), amount, toPrize, toOps);
    }

    function _splitNative(uint256 amount) internal {
        uint256 toPrize = (amount * prizeBps) / BPS_DENOMINATOR;
        uint256 toOps = amount - toPrize;
        (bool okPrize,) = prize.call{value: toPrize}("");
        if (!okPrize) revert TransferFailed();
        (bool okOps,) = ops.call{value: toOps}("");
        if (!okOps) revert TransferFailed();
        emit NativeSplit(msg.sender, amount, toPrize, toOps);
    }
}
