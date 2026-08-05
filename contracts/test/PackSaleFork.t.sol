// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {PackSale} from "../src/PackSale.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {IERC20, IJackpotVault, IPoolManager} from "../src/Interfaces.sol";

/// Fork tests against the real Uniswap v4 deployment and real Robinhood stock tokens.
///   forge test --match-path test/PackSaleFork.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com
contract PackSaleForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant USDG_WHALE = 0x2d4d2A025b10C09BDbd794B4FCe4F7ea8C7d7bB4;

    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant MSFT_FEED = 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant TSLA_FEED = 0x4A1166a659A55625345e9515b32adECea5547C38;

    JackpotVault vault;
    PackSale sale;
    address buyer = makeAddr("buyer");

    function setUp() public {
        vault = new JackpotVault(IERC20(USDG));
        sale = new PackSale(IERC20(USDG), IJackpotVault(address(vault)), IPoolManager(POOL_MANAGER));
        vault.setPackSale(address(sale));

        sale.setStock(NVDA, NVDA_FEED, 3000, 60);
        sale.setStock(MSFT, MSFT_FEED, 3000, 60);
        sale.setStock(TSLA, TSLA_FEED, 3000, 60);

        address[] memory pool = new address[](3);
        pool[0] = NVDA;
        pool[1] = MSFT;
        pool[2] = TSLA;
        sale.addPack(10e6, pool);

        // float so packs can settle, and money for the buyer
        vm.startPrank(USDG_WHALE);
        IERC20(USDG).transfer(address(sale), 500e6);
        IERC20(USDG).transfer(buyer, 100e6);
        vm.stopPrank();

        vm.prank(buyer);
        IERC20(USDG).approve(address(sale), type(uint256).max);
    }

    function test_buyAndOpenBuysRealStock() public {
        vm.prank(buyer);
        uint256 id = sale.buyPack(0);

        assertEq(IERC20(USDG).balanceOf(address(vault)), 2e6, "20% to vault");
        assertEq(vault.totalAccrued(), 2e6);

        vm.roll(block.number + 1);
        sale.open(id);

        uint256 got = IERC20(NVDA).balanceOf(buyer) + IERC20(MSFT).balanceOf(buyer) + IERC20(TSLA).balanceOf(buyer);
        assertGt(got, 0, "buyer received a real stock token");
        assertEq(sale.reservedLiability(), 0, "liability released");
        console.log("stock received (wei):", got);
    }

    function test_buyWithEth() public {
        vm.deal(buyer, 1 ether);
        uint256 before = IERC20(USDG).balanceOf(buyer);

        vm.prank(buyer);
        uint256 id = sale.buyPackETH{value: 0.01 ether}(0);

        // surplus above the pack price comes back as USDG change
        assertGt(IERC20(USDG).balanceOf(buyer), before, "change returned");

        vm.roll(block.number + 1);
        sale.open(id);
        uint256 got = IERC20(NVDA).balanceOf(buyer) + IERC20(MSFT).balanceOf(buyer) + IERC20(TSLA).balanceOf(buyer);
        assertGt(got, 0, "eth buyer received a real stock token");
    }

    function test_noRefundPathExists() public {
        // even with zero stock inventory held, the open buys the card on the fly
        assertEq(IERC20(NVDA).balanceOf(address(sale)), 0);
        vm.prank(buyer);
        uint256 id = sale.buyPack(0);
        vm.roll(block.number + 1);
        uint256 usdgBefore = IERC20(USDG).balanceOf(buyer);
        sale.open(id);
        assertEq(IERC20(USDG).balanceOf(buyer), usdgBefore, "buyer got stock, not a USDG refund");
    }
}
