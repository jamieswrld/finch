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

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
    function exactInput(ExactInputParams calldata p) external payable returns (uint256);
}

interface IPancakeV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @title PancakeAdapter
/// @notice Swap adapter for BNB Smart Chain, routing through PancakeSwap.
///
///         Implements ISwapAdapter, so the core is pointed at it with `setModules`
///         and nothing else changes.
///
///         BSC liquidity is not uniform: the majors have deep v3 pools against USDT,
///         but plenty of assets only trade against WBNB, and several of those are on
///         v2 rather than v3. A v3-single-hop-only adapter silently strands them. So a
///         route carries its own venue:
///
///           V3_SINGLE  one v3 pool          USDT -> asset
///           V3_PATH    multi-hop v3         USDT -> WBNB -> asset
///           V2_PATH    v2 router            USDT -> WBNB -> asset
///
///         Routes are registered explicitly, never discovered. PancakeSwap returns a
///         pool contract for any fee tier that was ever initialised, including empty
///         ones, so "a pool exists" is not evidence it can fill. An unregistered pair
///         is simply not swappable, which is the safe default.
///
///         Callers still enforce their own `minOut` — the core derives it from
///         Chainlink — so this adapter can never return less than the caller accepts.
contract PancakeAdapter is ISwapAdapter {
    enum Venue {
        NONE,
        V3_SINGLE,
        V3_PATH,
        V2_PATH
    }

    IPancakeV3Router public immutable v3Router;
    IPancakeV2Router public immutable v2Router;
    address public owner;

    struct Route {
        Venue venue;
        uint24 fee; // V3_SINGLE only
        bytes path; // V3_PATH: encoded (token,fee,token,fee,token)
        address[] hops; // V2_PATH: [tokenIn, ...intermediates, tokenOut]
    }

    mapping(address => mapping(address => Route)) internal routes;

    event RouteSet(address indexed tokenIn, address indexed tokenOut, Venue venue);

    error NotOwner();
    error NoRoute();
    error TooLittleOut();
    error TransferFailed();
    error BadPath();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPancakeV3Router _v3, IPancakeV2Router _v2) {
        v3Router = _v3;
        v2Router = _v2;
        owner = msg.sender;
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /// @notice Register a single-hop v3 pool for a pair, both directions.
    function setV3Single(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        routes[tokenA][tokenB] = Route(Venue.V3_SINGLE, fee, "", new address[](0));
        routes[tokenB][tokenA] = Route(Venue.V3_SINGLE, fee, "", new address[](0));
        emit RouteSet(tokenA, tokenB, Venue.V3_SINGLE);
    }

    /// @notice Register a multi-hop v3 route. `path` is directional, so the reverse
    ///         must be registered separately with its own reversed encoding.
    function setV3Path(address tokenIn, address tokenOut, bytes calldata path) external onlyOwner {
        if (path.length < 43) revert BadPath(); // 20 + 3 + 20 minimum
        routes[tokenIn][tokenOut] = Route(Venue.V3_PATH, 0, path, new address[](0));
        emit RouteSet(tokenIn, tokenOut, Venue.V3_PATH);
    }

    /// @notice Register a v2 route. Registered both ways, reversing the hop list.
    function setV2Path(address[] calldata hops) external onlyOwner {
        if (hops.length < 2) revert BadPath();
        address tokenIn = hops[0];
        address tokenOut = hops[hops.length - 1];

        routes[tokenIn][tokenOut] = Route(Venue.V2_PATH, 0, "", hops);

        address[] memory rev = new address[](hops.length);
        for (uint256 i = 0; i < hops.length; i++) {
            rev[i] = hops[hops.length - 1 - i];
        }
        routes[tokenOut][tokenIn] = Route(Venue.V2_PATH, 0, "", rev);

        emit RouteSet(tokenIn, tokenOut, Venue.V2_PATH);
    }

    function routeVenue(address tokenIn, address tokenOut) external view returns (Venue) {
        return routes[tokenIn][tokenOut].venue;
    }

    function isSupported(address tokenIn, address tokenOut) external view returns (bool) {
        return routes[tokenIn][tokenOut].venue != Venue.NONE;
    }

    /// @notice Swap `amountIn` of `tokenIn` for at least `minOut` of `tokenOut`.
    /// @dev The core transfers `tokenIn` here before calling. Approval is granted per
    ///      swap for the exact amount rather than left standing.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        payable
        returns (uint256 amountOut)
    {
        Route storage r = routes[tokenIn][tokenOut];
        if (r.venue == Venue.NONE) revert NoRoute();

        address spender = r.venue == Venue.V2_PATH ? address(v2Router) : address(v3Router);
        if (!IERC20(tokenIn).approve(spender, amountIn)) revert TransferFailed();

        if (r.venue == Venue.V3_SINGLE) {
            amountOut = v3Router.exactInputSingle(
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
        } else if (r.venue == Venue.V3_PATH) {
            amountOut = v3Router.exactInput(
                IPancakeV3Router.ExactInputParams({
                    path: r.path,
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minOut
                })
            );
        } else {
            uint256[] memory amounts =
                v2Router.swapExactTokensForTokens(amountIn, minOut, r.hops, recipient, block.timestamp);
            amountOut = amounts[amounts.length - 1];
        }

        // The routers enforce their own minimum; this is belt and braces in case a
        // future router revision loosens that.
        if (amountOut < minOut) revert TooLittleOut();
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
