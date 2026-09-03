// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title OperatorBudget
/// @notice The onchain half of Finch's treasury security model:
///
///           Finch treasury wallet (owner)
///                     ↓ funds a bounded float + sets budgets
///           OperatorBudget (this contract)
///                     ↓ per-operator, per-token, per-epoch allowances
///           restricted operator wallets (automation / agents)
///
///         Automation can spend within predefined budgets; it can never touch
///         the treasury itself, raise its own limits, or drain the float —
///         the treasury owner can pause, revoke, or sweep at any time.
contract OperatorBudget {
    struct Budget {
        uint128 amountPerEpoch;
        uint128 spentInEpoch;
        uint64 epochLength;
        uint64 epochStart;
        bool active;
    }

    address public owner;
    address public pendingOwner;
    bool public paused;

    /// operator => token (address(0) = native) => budget
    mapping(address => mapping(address => Budget)) public budgets;

    event OwnershipTransferStarted(address indexed currentOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event BudgetSet(address indexed operator, address indexed token, uint128 amountPerEpoch, uint64 epochLength);
    event BudgetRevoked(address indexed operator, address indexed token);
    event PausedSet(bool paused);
    event Spent(
        address indexed operator, address indexed token, address indexed to, uint256 amount, bytes32 category
    );
    event Swept(address indexed token, address indexed to, uint256 amount);
    event NativeReceived(address indexed from, uint256 amount);

    error NotOwner();
    error NotPendingOwner();
    error ContractPaused();
    error NoBudget();
    error BudgetExceeded(uint256 requested, uint256 remaining);
    error AmountTooLarge();
    error InvalidEpoch();
    error ZeroAddress();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    // ── Ownership (two-step, treasury-held) ──────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ── Budget administration (treasury owner only) ──────────────────────

    function setBudget(address operator, address token, uint128 amountPerEpoch, uint64 epochLength)
        external
        onlyOwner
    {
        if (operator == address(0)) revert ZeroAddress();
        if (epochLength == 0) revert InvalidEpoch();
        budgets[operator][token] = Budget({
            amountPerEpoch: amountPerEpoch,
            spentInEpoch: 0,
            epochLength: epochLength,
            epochStart: uint64(block.timestamp),
            active: true
        });
        emit BudgetSet(operator, token, amountPerEpoch, epochLength);
    }

    function revokeBudget(address operator, address token) external onlyOwner {
        delete budgets[operator][token];
        emit BudgetRevoked(operator, token);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Recover any part of the float back to the treasury.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        }
        emit Swept(token, to, amount);
    }

    // ── Operator spending ────────────────────────────────────────────────

    /// @notice Spend within budget. `category` tags the public ledger entry
    ///         (e.g. "compute", "grants", "subsidized-executions").
    function spend(address token, address to, uint256 amount, bytes32 category) external {
        if (paused) revert ContractPaused();
        if (to == address(0)) revert ZeroAddress();
        if (amount > type(uint128).max) revert AmountTooLarge();

        Budget storage budget = budgets[msg.sender][token];
        if (!budget.active) revert NoBudget();

        // Roll the epoch window forward if one or more epochs have elapsed.
        if (block.timestamp >= budget.epochStart + budget.epochLength) {
            uint64 elapsed = uint64(block.timestamp) - budget.epochStart;
            uint64 epochs = elapsed / budget.epochLength;
            budget.epochStart += epochs * budget.epochLength;
            budget.spentInEpoch = 0;
        }

        uint128 remaining = budget.amountPerEpoch - budget.spentInEpoch;
        if (uint128(amount) > remaining) revert BudgetExceeded(amount, remaining);
        budget.spentInEpoch += uint128(amount);

        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        }
        emit Spent(msg.sender, token, to, amount, category);
    }

    /// @notice Remaining allowance for an operator in the current epoch.
    function remainingBudget(address operator, address token) external view returns (uint256) {
        Budget memory budget = budgets[operator][token];
        if (!budget.active) return 0;
        if (block.timestamp >= budget.epochStart + budget.epochLength) {
            return budget.amountPerEpoch;
        }
        return budget.amountPerEpoch - budget.spentInEpoch;
    }
}
