// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, IAggregatorV3, IJackpotVault} from "./Interfaces.sol";

/// @title PackSale
/// @notice Sells packs for USDG. A cut of every sale goes to the JackpotVault; the rest
///         stays here as treasury backing the stock inventory this contract holds.
///         Opening uses commit-reveal randomness on a future blockhash:
///           buy → wait ≥1 block → open (callable by anyone, outcome goes to the buyer).
///         Outcomes: a rarity-weighted amount of a random stock from the pack's pool
///         (priced via Chainlink), a hidden jackpot card (% of the vault), or a USDG
///         refund of the card value if inventory can't cover any pool stock.
/// @dev    Blockhash randomness is v1 — swap for VRF when it lands on Robinhood Chain.
///         open() being permissionless lets keeper bots settle packs whose buyers wait
///         out the 256-block blockhash window hoping to re-roll.
contract PackSale {
    IERC20 public immutable usdg;
    IJackpotVault public immutable vault;
    uint8 public immutable usdgDecimals;
    address public owner;

    uint16 public jackpotCutBps = 2_000; // 20% of every sale → vault
    uint16 public hiddenCardBps = 100; // 1% of opens are hidden jackpot cards
    uint16 public feeBps = 100; // 1% protocol fee on every purchase
    address public feeRecipient;
    uint256 public maxPriceAge = 3 days; // generous: equity feeds run 24/5, pause weekends

    struct Pack {
        uint128 price; // in USDG base units
        bool live;
        address[] pool;
    }

    Pack[] internal _packs;

    /// @notice Chainlink feed (USD) per stock token.
    mapping(address => address) public feedOf;

    struct Purchase {
        address buyer;
        uint64 packId;
        uint64 commitBlock;
        bool settled;
    }

    Purchase[] public purchases;

    /// @notice USDG reserved for the worst-case payout of every unsettled pack.
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
    event Refunded(uint256 indexed purchaseId, address indexed buyer, uint256 amountUsdg);
    event Rearmed(uint256 indexed purchaseId, uint64 newCommitBlock);

    error NotOwner();
    error PackNotLive();
    error AlreadySettled();
    error TooEarly();
    error StalePrice();
    error TransferFailed();
    error InsufficientReserves();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 _usdg, IJackpotVault _vault) {
        usdg = _usdg;
        vault = _vault;
        usdgDecimals = _usdg.decimals();
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

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

    function setFeed(address stock, address feed) external onlyOwner {
        feedOf[stock] = feed;
    }

    function setParams(uint16 _jackpotCutBps, uint16 _hiddenCardBps, uint256 _maxPriceAge) external onlyOwner {
        require(_jackpotCutBps <= 5_000 && _hiddenCardBps <= 1_000, "bounds");
        jackpotCutBps = _jackpotCutBps;
        hiddenCardBps = _hiddenCardBps;
        maxPriceAge = _maxPriceAge;
    }

    function setFee(address _recipient, uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 500 && _recipient != address(0), "bounds");
        feeRecipient = _recipient;
        feeBps = _feeBps;
    }

    /// @notice Withdraw treasury USDG or excess stock inventory. USDG withdrawals can
    ///         never dip below the reserve backing unsettled packs.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(usdg) && usdg.balanceOf(address(this)) - amount < reservedLiability) {
            revert InsufficientReserves();
        }
        if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
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

    // ---------- buy / open ----------

    function buyPack(uint256 packId) external returns (uint256 purchaseId) {
        Pack storage p = _packs[packId];
        if (!p.live) revert PackNotLive();

        uint256 cut = (uint256(p.price) * jackpotCutBps) / 10_000;
        uint256 fee = (uint256(p.price) * feeBps) / 10_000;
        if (!usdg.transferFrom(msg.sender, address(vault), cut)) revert TransferFailed();
        if (fee > 0 && !usdg.transferFrom(msg.sender, feeRecipient, fee)) revert TransferFailed();
        if (!usdg.transferFrom(msg.sender, address(this), p.price - cut - fee)) revert TransferFailed();
        vault.recordSale(msg.sender, cut);

        // Solvency guarantee: every unsettled pack reserves its worst-case card (3x
        // legendary) in USDG. A pack can only be sold while the treasury covers ALL
        // outstanding packs at once — even with zero stock inventory, every sold pack
        // is fully payable through the refund path.
        reservedLiability += (uint256(p.price) * 30_000) / 10_000;
        if (usdg.balanceOf(address(this)) < reservedLiability) revert InsufficientReserves();

        purchaseId = purchases.length;
        purchases.push(
            Purchase({buyer: msg.sender, packId: uint64(packId), commitBlock: uint64(block.number), settled: false})
        );
        emit Purchased(purchaseId, msg.sender, packId);
    }

    /// @notice Settle a purchase. Permissionless; the card always goes to the buyer.
    function open(uint256 purchaseId) external {
        Purchase storage q = purchases[purchaseId];
        if (q.settled) revert AlreadySettled();
        if (block.number <= q.commitBlock) revert TooEarly();

        bytes32 bh = blockhash(q.commitBlock);
        if (bh == bytes32(0)) {
            // commit expired (>256 blocks) — re-arm on a fresh future blockhash
            q.commitBlock = uint64(block.number);
            emit Rearmed(purchaseId, uint64(block.number));
            return;
        }

        q.settled = true;
        uint256 rand = uint256(keccak256(abi.encode(bh, purchaseId)));
        Pack storage p = _packs[q.packId];
        reservedLiability -= (uint256(p.price) * 30_000) / 10_000;

        if (rand % 10_000 < hiddenCardBps) {
            uint256 pctBps = _luckCurve((rand >> 16) % 10_000, rand >> 32);
            uint256 won = vault.awardHiddenCard(q.buyer, pctBps);
            emit OpenedJackpot(purchaseId, q.buyer, pctBps, won);
            return;
        }

        uint16 rarityBps = _rollRarity((rand >> 64) % 10_000);
        uint256 value = (uint256(p.price) * rarityBps) / 10_000;

        (address stock, uint256 amount) = _pickStock(p.pool, rand >> 128, value);
        if (stock == address(0)) {
            if (!usdg.transfer(q.buyer, value)) revert TransferFailed();
            emit Refunded(purchaseId, q.buyer, value);
            return;
        }

        if (!IERC20(stock).transfer(q.buyer, amount)) revert TransferFailed();
        emit OpenedStock(purchaseId, q.buyer, stock, amount, value, rarityBps);
    }

    // ---------- internals ----------

    /// @dev Weights match the site: Common 78% ×0.7, Rare 15% ×1.0, Epic 5% ×1.5, Legendary 2% ×3.0.
    function _rollRarity(uint256 r) internal pure returns (uint16) {
        if (r < 7_800) return 7_000;
        if (r < 9_300) return 10_000;
        if (r < 9_800) return 15_000;
        return 30_000;
    }

    /// @dev Hidden-card payout curve, in bps of the open vault: mostly 0.5–2%, fat tail to 25%.
    function _luckCurve(uint256 tier, uint256 r) internal pure returns (uint256) {
        if (tier < 7_000) return 50 + (r % 150); // 0.5% – 2%
        if (tier < 9_500) return 200 + (r % 300); // 2% – 5%
        if (tier < 9_950) return 500 + (r % 500); // 5% – 10%
        return 1_000 + (r % 1_500); // 10% – 25%
    }

    /// @dev Random start index, then first pool stock whose inventory covers the card value.
    function _pickStock(address[] storage pool, uint256 r, uint256 value)
        internal
        view
        returns (address, uint256)
    {
        uint256 len = pool.length;
        uint256 start = r % len;
        for (uint256 i = 0; i < len; i++) {
            address stock = pool[(start + i) % len];
            uint256 amount = _stockAmount(stock, value);
            if (IERC20(stock).balanceOf(address(this)) >= amount) return (stock, amount);
        }
        return (address(0), 0);
    }

    /// @dev Convert a USDG value into stock token units (18 dec) via the Chainlink USD feed.
    function _stockAmount(address stock, uint256 value) internal view returns (uint256) {
        IAggregatorV3 feed = IAggregatorV3(feedOf[stock]);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0 || block.timestamp - updatedAt > maxPriceAge) revert StalePrice();
        return (value * (10 ** feed.decimals()) * 1e18) / ((10 ** usdgDecimals) * uint256(answer));
    }
}
