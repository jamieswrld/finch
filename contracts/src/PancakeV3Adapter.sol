// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IERC20} from "./Interfaces.sol";

interface IPancakeV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IPancakeV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// @title PancakeV3Adapter
/// @notice Swap adapter for BNB Smart Chain, routing through PancakeSwap v3.
///
///         Drop-in replacement for UniswapV4Adapter: same ISwapAdapter surface, so the
///         core can be pointed at it with `setModules` and nothing else changes.
///
///         Fee tiers are registered per pair rather than discovered. PancakeSwap deploys
///         a pool contract for any tier someone initialises, including empty ones, so
///         "the pool exists" is not evidence it can fill — picking a tier automatically
///         would happily route into a dead pool. An unregistered pair is simply not
///         swappable. Callers still enforce their own `minOut` (the core derives it from
///         Chainlink), so this adapter can never return less than the caller accepts.
contract PancakeV3Adapter is ISwapAdapter {
    IPancakeV3Router public immutable router;
    IPancakeV3Factory public immutable factory;
    address public owner;

    struct Route {
        uint24 fee;
        bool set;
    }

    /// @notice tokenIn => tokenOut => fee tier.
    mapping(address => mapping(address => Route)) public routeOf;

    event RouteSet(address indexed tokenIn, address indexed tokenOut, uint24 fee);

    error NotOwner();
    error NoRoute();
    error PoolMissing();
    error TooLittleOut();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPancakeV3Router _router, IPancakeV3Factory _factory) {
        router = _router;
        factory = _factory;
        owner = msg.sender;
    }

    receive() external payable {}

    /// @notice Register a fee tier for a pair, both directions so buys and sells work.
    /// @dev Reverts if PancakeSwap has no pool at that tier, which catches the common
    ///      case of registering a tier that was never initialised.
    function setRoute(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        if (factory.getPool(tokenA, tokenB, fee) == address(0)) revert PoolMissing();
        routeOf[tokenA][tokenB] = Route({fee: fee, set: true});
        routeOf[tokenB][tokenA] = Route({fee: fee, set: true});
        emit RouteSet(tokenA, tokenB, fee);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Swap `amountIn` of `tokenIn` for at least `minOut` of `tokenOut`.
    /// @dev The core transfers `tokenIn` here before calling, matching the v4 adapter's
    ///      flow. Approval is set per swap for the exact amount rather than left standing.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut)
    {
        Route memory r = routeOf[tokenIn][tokenOut];
        if (!r.set) revert NoRoute();

        if (!IERC20(tokenIn).approve(address(router), amountIn)) revert TransferFailed();

        amountOut = router.exactInputSingle(
            IPancakeV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: r.fee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );

        // exactInputSingle enforces amountOutMinimum itself; this is belt and braces in
        // case a future router revision loosens that.
        if (amountOut < minOut) revert TooLittleOut();
    }

    /// @notice Whether a route is configured for this pair.
    function isSupported(address tokenIn, address tokenOut) external view returns (bool) {
        return routeOf[tokenIn][tokenOut].set;
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
