// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {
    IERC20, IPoolManager, IUnlockCallback, PoolKey, SwapParams, Currency, BalanceDelta
} from "./Interfaces.sol";

/// @title UniswapV4Adapter
/// @notice Swaps through Uniswap v4's PoolManager using the unlock/callback pattern.
///
///         Routes are registered per pair, because pool tiers on this chain vary and
///         several pools are badly mispriced — an unregistered pair simply is not
///         swappable rather than silently routing somewhere harmful. Callers still
///         enforce their own `minOut` (the core derives it from Chainlink), so this
///         adapter cannot hand back less than the caller accepts.
contract UniswapV4Adapter is ISwapAdapter, IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public owner;

    struct Route {
        uint24 fee;
        int24 tickSpacing;
        bool set;
    }

    /// @notice tokenIn => tokenOut => pool parameters.
    mapping(address => mapping(address => Route)) public routeOf;

    event RouteSet(address indexed tokenIn, address indexed tokenOut, uint24 fee, int24 tickSpacing);

    error NotOwner();
    error NotPoolManager();
    error NoRoute();
    error TooLittleOut();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        owner = msg.sender;
    }

    receive() external payable {}

    /// @notice Register a pool for a pair. Registered both ways so buys and sells work.
    function setRoute(address tokenA, address tokenB, uint24 fee, int24 tickSpacing) external onlyOwner {
        routeOf[tokenA][tokenB] = Route({fee: fee, tickSpacing: tickSpacing, set: true});
        routeOf[tokenB][tokenA] = Route({fee: fee, tickSpacing: tickSpacing, set: true});
        emit RouteSet(tokenA, tokenB, fee, tickSpacing);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function isSupported(address tokenIn, address tokenOut) external view override returns (bool) {
        return routeOf[tokenIn][tokenOut].set;
    }

    struct Ctx {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        address recipient;
        PoolKey key;
        bool zeroForOne;
        uint256 out;
    }

    /// @inheritdoc ISwapAdapter
    /// @dev Caller must have transferred `amountIn` of `tokenIn` here first, or sent
    ///      it as value for native ETH.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        Route memory r = routeOf[tokenIn][tokenOut];
        if (!r.set) revert NoRoute();

        bool zeroForOne = uint160(tokenIn) < uint160(tokenOut);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(zeroForOne ? tokenIn : tokenOut),
            currency1: Currency.wrap(zeroForOne ? tokenOut : tokenIn),
            fee: r.fee,
            tickSpacing: r.tickSpacing,
            hooks: address(0)
        });

        bytes memory result = poolManager.unlock(
            abi.encode(
                Ctx({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    amountIn: amountIn,
                    minOut: minOut,
                    recipient: recipient,
                    key: key,
                    zeroForOne: zeroForOne,
                    out: 0
                })
            )
        );
        amountOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Ctx memory c = abi.decode(data, (Ctx));

        BalanceDelta delta = poolManager.swap(
            c.key,
            SwapParams({
                zeroForOne: c.zeroForOne,
                amountSpecified: -int256(c.amountIn), // negative = exact input
                sqrtPriceLimitX96: c.zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
            }),
            ""
        );

        int256 packed = BalanceDelta.unwrap(delta);
        int128 out = c.zeroForOne ? int128(packed) : int128(packed >> 128);
        if (out <= int128(0)) revert TooLittleOut();
        uint256 amountOut = uint256(uint128(out));
        if (amountOut < c.minOut) revert TooLittleOut();

        if (c.tokenIn == address(0)) {
            poolManager.settle{value: c.amountIn}();
        } else {
            poolManager.sync(Currency.wrap(c.tokenIn));
            if (!IERC20(c.tokenIn).transfer(address(poolManager), c.amountIn)) revert TransferFailed();
            poolManager.settle();
        }

        poolManager.take(Currency.wrap(c.tokenOut), c.recipient, amountOut);
        return abi.encode(amountOut);
    }

    /// @notice Recover anything stranded here.
    function rescue(address token, address to) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = to.call{value: address(this).balance}("");
            require(ok, "eth");
        } else {
            IERC20 t = IERC20(token);
            if (!t.transfer(to, t.balanceOf(address(this)))) revert TransferFailed();
        }
    }
}
