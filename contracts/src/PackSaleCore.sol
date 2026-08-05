// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, IAggregatorV3, IJackpotVault} from "./Interfaces.sol";
import {IRandomness} from "./interfaces/IRandomness.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";

/// @title PackSaleCore
/// @notice Sale and settlement logic only. Randomness and swapping live behind
///         interfaces, so either can be replaced — commit-reveal to VRF, Uniswap v4 to
///         another venue — without migrating balances or re-registering stocks.
///
///           buy   -> USDG (or ETH, swapped in) splits: jackpot cut, protocol fee, rest held
///           open  -> randomness picks rarity and stock, the adapter buys exactly that much
///                    and sends it to the buyer
///
///         No stock inventory, no refund path. Swap minimums are derived from each
///         stock's Chainlink feed, so a thin or manipulated pool is rejected and the
///         next stock in the pack is tried instead.
contract PackSaleCore {
    IERC20 public immutable usdg;
    IJackpotVault public immutable vault;
    uint8 public immutable usdgDecimals;

    IRandomness public randomness;
    ISwapAdapter public swapAdapter;
    address public owner;

    uint16 public jackpotCutBps = 2_000;
    uint16 public feeBps = 100;
    uint16 public hiddenCardBps = 100;
    address public feeRecipient;
    uint256 public maxPriceAge = 3 days;
    uint16 public minSwapOutBps = 9_000;

    struct Pack {
        uint128 price;
        bool live;
        address[] pool;
    }

    Pack[] internal _packs;
    mapping(address => address) public feedOf;

    struct Purchase {
        address buyer;
        uint64 packId;
        bool settled;
    }

    Purchase[] public purchases;
    uint256 public reservedLiability;

    event PackAdded(uint256 indexed packId, uint128 price);
    event ModulesUpdated(address randomness, address swapAdapter);
    event Purchased(uint256 indexed purchaseId, address indexed buyer, uint256 indexed packId);
    event OpenedStock(
        uint256 indexed purchaseId,
        address indexed buyer,
        address stock,
        uint256 amount,
        uint256 valueUsdg,
        uint16 rarityBps
    );
    event OpenedJackpot(uint256 indexed purchaseId, address indexed buyer, uint256 pctBps, uint256 amountUsdg);
    event Rearmed(uint256 indexed purchaseId);

    error NotOwner();
    error PackNotLive();
    error AlreadySettled();
    error NotReady();
    error TransferFailed();
    error NoStockAvailable();
    error InsufficientPayment();
    error InsufficientReserves();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _usdg, IJackpotVault _vault, IRandomness _randomness, ISwapAdapter _swapAdapter) {
        usdg = _usdg;
        vault = _vault;
        randomness = _randomness;
        swapAdapter = _swapAdapter;
        usdgDecimals = _usdg.decimals();
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

    receive() external payable {}

    // ---------- admin ----------

    /// @notice Hot-swap either module. Balances, packs and feeds are untouched.
    function setModules(IRandomness _randomness, ISwapAdapter _swapAdapter) external onlyOwner {
        randomness = _randomness;
        swapAdapter = _swapAdapter;
        emit ModulesUpdated(address(_randomness), address(_swapAdapter));
    }

    function addPack(uint128 price, address[] calldata pool) external onlyOwner returns (uint256 packId) {
        packId = _packs.length;
        _packs.push();
        Pack storage p = _packs[packId];
        p.price = price;
        p.live = true;
        p.pool = pool;
        emit PackAdded(packId, price);
    }

    function setPackLive(uint256 packId, bool live) external onlyOwner {
        _packs[packId].live = live;
    }

    function setFeed(address stock, address feed) external onlyOwner {
        feedOf[stock] = feed;
    }

    function setParams(uint16 _jackpotCutBps, uint16 _hiddenCardBps, uint256 _maxPriceAge, uint16 _minSwapOutBps)
        external
        onlyOwner
    {
        require(_jackpotCutBps <= 5_000 && _hiddenCardBps <= 1_000 && _minSwapOutBps <= 10_000, "bounds");
        jackpotCutBps = _jackpotCutBps;
        hiddenCardBps = _hiddenCardBps;
        maxPriceAge = _maxPriceAge;
        minSwapOutBps = _minSwapOutBps;
    }

    function setFee(address _recipient, uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 500 && _recipient != address(0), "bounds");
        feeRecipient = _recipient;
        feeBps = _feeBps;
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(usdg) && usdg.balanceOf(address(this)) - amount < reservedLiability) {
            revert InsufficientReserves();
        }
        if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
    }

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ---------- views ----------

    function packCount() external view returns (uint256) {
        return _packs.length;
    }

    function purchaseCount() external view returns (uint256) {
        return purchases.length;
    }

    function getPack(uint256 packId) external view returns (uint128 price, bool live, address[] memory pool) {
        Pack storage p = _packs[packId];
        return (p.price, p.live, p.pool);
    }

    // ---------- buy ----------

    function buyPack(uint256 packId) external returns (uint256 purchaseId) {
        Pack storage p = _packs[packId];
        if (!p.live) revert PackNotLive();
        if (!usdg.transferFrom(msg.sender, address(this), p.price)) revert TransferFailed();
        return _record(packId, p.price, msg.sender);
    }

    /// @notice Buy with native ETH; surplus above the pack price returns as USDG change.
    function buyPackETH(uint256 packId) external payable returns (uint256 purchaseId) {
        Pack storage p = _packs[packId];
        if (!p.live) revert PackNotLive();
        if (msg.value == 0) revert InsufficientPayment();

        uint256 received =
            swapAdapter.swap{value: msg.value}(address(0), address(usdg), msg.value, 0, address(this));
        if (received < p.price) revert InsufficientPayment();

        uint256 change = received - p.price;
        if (change > 0 && !usdg.transfer(msg.sender, change)) revert TransferFailed();
        return _record(packId, p.price, msg.sender);
    }

    function _record(uint256 packId, uint256 price, address buyer) internal returns (uint256 purchaseId) {
        uint256 cut = (price * jackpotCutBps) / 10_000;
        uint256 fee = (price * feeBps) / 10_000;

        if (!usdg.transfer(address(vault), cut)) revert TransferFailed();
        if (fee > 0 && !usdg.transfer(feeRecipient, fee)) revert TransferFailed();
        vault.recordSale(buyer, cut);

        reservedLiability += (price * 30_000) / 10_000;
        if (usdg.balanceOf(address(this)) < reservedLiability) revert InsufficientReserves();

        purchaseId = purchases.length;
        purchases.push(Purchase({buyer: buyer, packId: uint64(packId), settled: false}));
        randomness.commit(purchaseId);
        emit Purchased(purchaseId, buyer, packId);
    }

    // ---------- open ----------

    function open(uint256 purchaseId) external {
        Purchase storage q = purchases[purchaseId];
        if (q.settled) revert AlreadySettled();

        if (randomness.isExpired(purchaseId)) {
            randomness.rearm(purchaseId);
            emit Rearmed(purchaseId);
            return;
        }
        if (!randomness.isReady(purchaseId)) revert NotReady();

        uint256 rand = randomness.reveal(purchaseId);
        Pack storage p = _packs[q.packId];

        uint16 rBps = _rollValueBps((rand >> 64) % 10_000, rand >> 96);
        uint256 value = (uint256(p.price) * rBps) / 10_000;

        (address stock, uint256 amount) = _buyStock(p.pool, rand >> 128, value);
        if (stock == address(0)) revert NoStockAvailable();

        q.settled = true;
        reservedLiability -= (uint256(p.price) * 30_000) / 10_000;

        if (rand % 10_000 < hiddenCardBps) {
            uint256 pctBps = _luckCurve((rand >> 16) % 10_000, rand >> 32);
            uint256 won = vault.awardHiddenCard(q.buyer, pctBps);
            emit OpenedJackpot(purchaseId, q.buyer, pctBps, won);
        }

        if (!IERC20(stock).transfer(q.buyer, amount)) revert TransferFailed();
        emit OpenedStock(purchaseId, q.buyer, stock, amount, value, rBps);
    }

    // ---------- internals ----------

    /// @dev Rarity picks a band; the value lands anywhere inside it, so a $10 pack pays
    ///      an uneven amount. Common 78% (0.60-0.85x), Rare 15% (0.85-1.20x),
    ///      Epic 5% (1.20-1.80x), Legendary 2% (1.80-3.00x).
    function _rollValueBps(uint256 tier, uint256 r) internal pure returns (uint16) {
        uint16 lo;
        uint16 hi;
        if (tier < 7_800) {
            lo = 6_000;
            hi = 8_500;
        } else if (tier < 9_300) {
            lo = 8_500;
            hi = 12_000;
        } else if (tier < 9_800) {
            lo = 12_000;
            hi = 18_000;
        } else {
            lo = 18_000;
            hi = 30_000;
        }
        return uint16(lo + (r % (hi - lo + 1)));
    }

    function _luckCurve(uint256 tier, uint256 r) internal pure returns (uint256) {
        if (tier < 7_000) return 50 + (r % 150);
        if (tier < 9_500) return 200 + (r % 300);
        if (tier < 9_950) return 500 + (r % 500);
        return 1_000 + (r % 1_500);
    }

    function _buyStock(address[] storage pool, uint256 r, uint256 spend) internal returns (address, uint256) {
        uint256 len = pool.length;
        uint256 start = r % len;
        for (uint256 i = 0; i < len; i++) {
            address stock = pool[(start + i) % len];
            if (!swapAdapter.isSupported(address(usdg), stock)) continue;

            uint256 minOut = _minOut(stock, spend);
            if (minOut == 0) continue;

            try this.routeSwap(stock, spend, minOut) returns (uint256 got) {
                if (got >= minOut) return (stock, got);
            } catch {
                continue;
            }
        }
        return (address(0), 0);
    }

    /// @dev External so a failed route can be caught without reverting the whole open.
    function routeSwap(address stock, uint256 spend, uint256 minOut) external returns (uint256) {
        require(msg.sender == address(this), "internal");
        if (!usdg.transfer(address(swapAdapter), spend)) revert TransferFailed();
        return swapAdapter.swap(address(usdg), stock, spend, minOut, address(this));
    }

    /// @dev Minimum acceptable output for `spend`, from the stock's Chainlink price.
    function _minOut(address stock, uint256 spend) internal view returns (uint256) {
        address feed = feedOf[stock];
        if (feed == address(0)) return 0;
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) return 0;
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxPriceAge) return 0;
        uint256 fair =
            (spend * (10 ** IAggregatorV3(feed).decimals()) * 1e18) / ((10 ** usdgDecimals) * uint256(answer));
        return (fair * minSwapOutBps) / 10_000;
    }
}
