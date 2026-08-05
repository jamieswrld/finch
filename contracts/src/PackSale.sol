// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IERC20,
    IAggregatorV3,
    IJackpotVault,
    IPoolManager,
    IUnlockCallback,
    PoolKey,
    SwapParams,
    Currency,
    BalanceDelta
} from "./Interfaces.sol";

/// @title PackSale
/// @notice Packs are paid for in USDG or ETH and settled by buying the card on-chain at
///         open time:
///
///           buy   -> USDG (or ETH, swapped to USDG on the way in) splits
///                    jackpotCut -> vault, fee -> treasury, remainder held here
///           open  -> rarity sets the card's USD value, the contract swaps exactly that
///                    much USDG for a random stock on Uniswap v4 and sends it to the buyer
///
///         There is no stock inventory to maintain and no refund path: a card is always
///         a real stock. If no pool can fill the swap the open simply reverts and can be
///         retried, leaving the purchase valid.
///
///         Every swap's minimum output is derived from the stock's Chainlink price, so a
///         thin or manipulated pool cannot hand a buyer a worthless amount — that swap is
///         rejected and the next stock in the pack's pool is tried instead.
contract PackSale is IUnlockCallback {
    IERC20 public immutable usdg;
    IJackpotVault public immutable vault;
    IPoolManager public immutable poolManager;
    uint8 public immutable usdgDecimals;
    address public owner;

    uint16 public jackpotCutBps = 2_000; // 20% of every sale -> vault
    uint16 public feeBps = 100; // 1% protocol fee
    uint16 public hiddenCardBps = 100; // 1% of opens are hidden jackpot cards
    address public feeRecipient;
    uint256 public maxPriceAge = 3 days;
    /// @notice Worst acceptable swap output vs the Chainlink price, in bps.
    uint16 public minSwapOutBps = 9_000;

    struct Pack {
        uint128 price;
        bool live;
        address[] pool;
    }

    Pack[] internal _packs;

    mapping(address => address) public feedOf;

    struct PoolCfg {
        uint24 fee;
        int24 tickSpacing;
        bool set;
    }

    mapping(address => PoolCfg) public poolCfgOf;
    /// @notice v4 pool used to convert incoming ETH into USDG.
    PoolCfg public ethUsdgCfg = PoolCfg({fee: 500, tickSpacing: 10, set: true});

    struct Purchase {
        address buyer;
        uint64 packId;
        uint64 commitBlock;
        bool settled;
    }

    Purchase[] public purchases;

    /// @notice USDG reserved against the worst-case card of every unsettled pack.
    uint256 public reservedLiability;

    event PackAdded(uint256 indexed packId, uint128 price);
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
    event Rearmed(uint256 indexed purchaseId, uint64 newCommitBlock);

    error NotOwner();
    error PackNotLive();
    error AlreadySettled();
    error TooEarly();
    error StalePrice();
    error TransferFailed();
    error NoPoolConfigured();
    error NoStockAvailable();
    error InsufficientPayment();
    error InsufficientReserves();
    error NotPoolManager();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _usdg, IJackpotVault _vault, IPoolManager _poolManager) {
        usdg = _usdg;
        vault = _vault;
        poolManager = _poolManager;
        usdgDecimals = _usdg.decimals();
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

    receive() external payable {}

    // ---------- admin ----------

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

    /// @notice Register a stock: its Chainlink feed and the v4 pool used to buy it.
    function setStock(address stock, address feed, uint24 fee, int24 tickSpacing) external onlyOwner {
        feedOf[stock] = feed;
        poolCfgOf[stock] = PoolCfg({fee: fee, tickSpacing: tickSpacing, set: true});
    }

    function setEthPool(uint24 fee, int24 tickSpacing) external onlyOwner {
        ethUsdgCfg = PoolCfg({fee: fee, tickSpacing: tickSpacing, set: true});
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
        if (token == address(usdg)) {
            if (usdg.balanceOf(address(this)) - amount < reservedLiability) revert InsufficientReserves();
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
        return _recordPurchase(packId, p.price, msg.sender);
    }

    /// @notice Buy with native ETH — swapped to USDG on the way in. Send a little extra
    ///         to absorb price movement; the surplus comes straight back as USDG.
    function buyPackETH(uint256 packId) external payable returns (uint256 purchaseId) {
        Pack storage p = _packs[packId];
        if (!p.live) revert PackNotLive();
        if (msg.value == 0) revert InsufficientPayment();

        uint256 before = usdg.balanceOf(address(this));
        _swap(address(0), address(usdg), ethUsdgCfg, msg.value, 0);
        uint256 received = usdg.balanceOf(address(this)) - before;
        if (received < p.price) revert InsufficientPayment();

        uint256 change = received - p.price;
        if (change > 0 && !usdg.transfer(msg.sender, change)) revert TransferFailed();
        return _recordPurchase(packId, p.price, msg.sender);
    }

    function _recordPurchase(uint256 packId, uint256 price, address buyer) internal returns (uint256 purchaseId) {
        uint256 cut = (price * jackpotCutBps) / 10_000;
        uint256 fee = (price * feeBps) / 10_000;

        if (!usdg.transfer(address(vault), cut)) revert TransferFailed();
        if (fee > 0 && !usdg.transfer(feeRecipient, fee)) revert TransferFailed();
        vault.recordSale(buyer, cut);

        // reserve the largest card this pack could produce so it can always settle
        reservedLiability += (price * 30_000) / 10_000;
        if (usdg.balanceOf(address(this)) < reservedLiability) revert InsufficientReserves();

        purchaseId = purchases.length;
        purchases.push(
            Purchase({buyer: buyer, packId: uint64(packId), commitBlock: uint64(block.number), settled: false})
        );
        emit Purchased(purchaseId, buyer, packId);
    }

    // ---------- open ----------

    function open(uint256 purchaseId) external {
        Purchase storage q = purchases[purchaseId];
        if (q.settled) revert AlreadySettled();
        if (block.number <= q.commitBlock) revert TooEarly();

        bytes32 bh = blockhash(q.commitBlock);
        if (bh == bytes32(0)) {
            q.commitBlock = uint64(block.number);
            emit Rearmed(purchaseId, uint64(block.number));
            return;
        }

        uint256 rand = uint256(keccak256(abi.encode(bh, purchaseId)));
        Pack storage p = _packs[q.packId];

        uint16 rBps = _rollValueBps((rand >> 64) % 10_000, rand >> 96);
        uint256 value = (uint256(p.price) * rBps) / 10_000;

        // buy the card with the contract's USDG — never a refund
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

    /// @dev Rarity picks a band, then the card's value lands anywhere inside it — so a
    ///      $10 pack pays out an uneven number like $8.43 rather than a flat multiple.
    ///      Common 78% (0.60x-0.85x), Rare 15% (0.85x-1.20x),
    ///      Epic 5% (1.20x-1.80x), Legendary 2% (1.80x-3.00x).
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

    /// @notice The rarity label a given value falls into, for front-ends.
    function rarityOf(uint16 valueBps) external pure returns (string memory) {
        if (valueBps < 8_500) return "Common";
        if (valueBps < 12_000) return "Rare";
        if (valueBps < 18_000) return "Epic";
        return "Legendary";
    }

    function _luckCurve(uint256 tier, uint256 r) internal pure returns (uint256) {
        if (tier < 7_000) return 50 + (r % 150);
        if (tier < 9_500) return 200 + (r % 300);
        if (tier < 9_950) return 500 + (r % 500);
        return 1_000 + (r % 1_500);
    }

    /// @dev Try each stock from a random start until one swaps successfully.
    function _buyStock(address[] storage pool, uint256 r, uint256 spend) internal returns (address, uint256) {
        uint256 len = pool.length;
        uint256 start = r % len;
        for (uint256 i = 0; i < len; i++) {
            address stock = pool[(start + i) % len];
            PoolCfg memory cfg = poolCfgOf[stock];
            if (!cfg.set) continue;

            uint256 minOut = _minOut(stock, spend);
            if (minOut == 0) continue;

            uint256 before = IERC20(stock).balanceOf(address(this));
            try this.swapExternal(address(usdg), stock, cfg, spend, minOut) {
                uint256 got = IERC20(stock).balanceOf(address(this)) - before;
                if (got >= minOut) return (stock, got);
            } catch {
                continue;
            }
        }
        return (address(0), 0);
    }

    /// @dev External wrapper so a failed swap can be caught without reverting the open.
    function swapExternal(address tokenIn, address tokenOut, PoolCfg memory cfg, uint256 amountIn, uint256 minOut)
        external
    {
        require(msg.sender == address(this), "internal");
        _swap(tokenIn, tokenOut, cfg, amountIn, minOut);
    }

    /// @dev Minimum acceptable output for `spend` USDG, from the Chainlink price.
    function _minOut(address stock, uint256 spend) internal view returns (uint256) {
        address feed = feedOf[stock];
        if (feed == address(0)) return 0;
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > maxPriceAge) return 0;
        uint256 fair =
            (spend * (10 ** IAggregatorV3(feed).decimals()) * 1e18) / ((10 ** usdgDecimals) * uint256(answer));
        return (fair * minSwapOutBps) / 10_000;
    }

    // ---------- uniswap v4 ----------

    struct SwapCtx {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        PoolKey key;
        bool zeroForOne;
    }

    function _swap(address tokenIn, address tokenOut, PoolCfg memory cfg, uint256 amountIn, uint256 minOut)
        internal
    {
        if (!cfg.set) revert NoPoolConfigured();
        bool zeroForOne = uint160(tokenIn) < uint160(tokenOut);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(zeroForOne ? tokenIn : tokenOut),
            currency1: Currency.wrap(zeroForOne ? tokenOut : tokenIn),
            fee: cfg.fee,
            tickSpacing: cfg.tickSpacing,
            hooks: address(0)
        });
        poolManager.unlock(
            abi.encode(
                SwapCtx({
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
        SwapCtx memory c = abi.decode(data, (SwapCtx));

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
        int128 amount0 = int128(packed >> 128);
        int128 amount1 = int128(packed);
        // the currency we owe is negative, the one we receive is positive
        int128 outDelta = c.zeroForOne ? amount1 : amount0;
        if (outDelta < int128(0)) revert TransferFailed();
        uint256 outAmount = uint256(uint128(outDelta));
        if (outAmount < c.minOut) revert TransferFailed();

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
}
