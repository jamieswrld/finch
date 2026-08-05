// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IERC20, IPoolManager, IUnlockCallback, PoolKey, SwapParams, Currency, BalanceDelta
} from "./Interfaces.sol";

/// @title Swapper
/// @notice Owner-only utility for treasury swaps on Uniswap v4 (the Universal Router's
///         ERC-20 input path is unreliable on this chain). Holds nothing by design —
///         sweep whatever it ends up with.
contract Swapper is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public owner;

    error NotOwner();
    error NotPoolManager();
    error TooLittleOut();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager _pm) {
        poolManager = _pm;
        owner = msg.sender;
    }

    receive() external payable {}

    struct Ctx {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        PoolKey key;
        bool zeroForOne;
    }

    function swap(address tokenIn, address tokenOut, uint24 fee, int24 tickSpacing, uint256 amountIn, uint256 minOut)
        external
        payable
        onlyOwner
    {
        bool zeroForOne = uint160(tokenIn) < uint160(tokenOut);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(zeroForOne ? tokenIn : tokenOut),
            currency1: Currency.wrap(zeroForOne ? tokenOut : tokenIn),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0)
        });
        poolManager.unlock(
            abi.encode(
                Ctx({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amountIn,
                    minOut: minOut,
                    key: key,
                    zeroForOne: zeroForOne
                })
            )
        );
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Ctx memory c = abi.decode(data, (Ctx));

        BalanceDelta delta = poolManager.swap(
            c.key,
            SwapParams({
                zeroForOne: c.zeroForOne,
                amountSpecified: -int256(c.amountIn),
                sqrtPriceLimitX96: c.zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
            }),
            ""
        );

        int256 packed = BalanceDelta.unwrap(delta);
        int128 out = c.zeroForOne ? int128(packed) : int128(packed >> 128);
        if (out <= int128(0)) revert TooLittleOut();
        uint256 outAmount = uint256(uint128(out));
        if (outAmount < c.minOut) revert TooLittleOut();

        if (c.tokenIn == address(0)) {
            poolManager.settle{value: c.amountIn}();
        } else {
            poolManager.sync(Currency.wrap(c.tokenIn));
            if (!IERC20(c.tokenIn).transfer(address(poolManager), c.amountIn)) revert TransferFailed();
            poolManager.settle();
        }
        poolManager.take(Currency.wrap(c.tokenOut), address(this), outAmount);
        return "";
    }

    function sweep(address token, address to) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = to.call{value: address(this).balance}("");
            require(ok, "eth");
        } else {
            IERC20 t = IERC20(token);
            if (!t.transfer(to, t.balanceOf(address(this)))) revert TransferFailed();
        }
    }
}
