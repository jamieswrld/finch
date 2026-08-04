// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PackSale} from "../src/PackSale.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {IERC20, IJackpotVault} from "../src/Interfaces.sol";
import {MockERC20, MockFeed} from "./Mocks.sol";

contract PackSaleTest is Test {
    MockERC20 usdg;
    MockERC20 aapl;
    MockERC20 nvda;
    MockFeed aaplFeed;
    MockFeed nvdaFeed;
    JackpotVault vault;
    PackSale sale;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address fees = makeAddr("fees");

    uint128 constant PRICE = 10e6; // $10, USDG has 6 decimals

    function setUp() public {
        vm.warp(1_760_000_000);

        usdg = new MockERC20("Global Dollar", "USDG", 6);
        aapl = new MockERC20("Apple Stock Token", "AAPL", 18);
        nvda = new MockERC20("NVIDIA Stock Token", "NVDA", 18);
        aaplFeed = new MockFeed(8, 200e8); // $200
        nvdaFeed = new MockFeed(8, 1000e8); // $1000

        vault = new JackpotVault(IERC20(address(usdg)));
        sale = new PackSale(IERC20(address(usdg)), IJackpotVault(address(vault)));
        vault.setPackSale(address(sale));
        sale.setFee(fees, 100); // 1% protocol fee

        sale.setFeed(address(aapl), address(aaplFeed));
        sale.setFeed(address(nvda), address(nvdaFeed));

        address[] memory pool = new address[](2);
        pool[0] = address(aapl);
        pool[1] = address(nvda);
        sale.addPack(PRICE, pool);

        // inventory + USDG float backing the solvency reserve
        aapl.mint(address(sale), 1000e18);
        nvda.mint(address(sale), 1000e18);
        usdg.mint(address(sale), 500e6);

        usdg.mint(alice, 1000e6);
        usdg.mint(bob, 1000e6);
        vm.prank(alice);
        usdg.approve(address(sale), type(uint256).max);
        vm.prank(bob);
        usdg.approve(address(sale), type(uint256).max);
    }

    // Replicates PackSale's rand derivation so tests can pick block hashes that
    // force a specific branch.
    function _findHash(uint256 purchaseId, bool wantHidden) internal pure returns (bytes32) {
        for (uint256 i = 1; i < 50_000; i++) {
            bytes32 bh = keccak256(abi.encode("seed", i));
            uint256 rand = uint256(keccak256(abi.encode(bh, purchaseId)));
            bool hidden = rand % 10_000 < 100;
            if (hidden == wantHidden) return bh;
        }
        revert("no hash found");
    }

    function _buyAndArm(address buyer, bool wantHidden) internal returns (uint256 id) {
        vm.prank(buyer);
        id = sale.buyPack(0);
        (,, uint64 commitBlock,) = sale.purchases(id);
        vm.setBlockhash(commitBlock, _findHash(id, wantHidden));
        vm.roll(block.number + 1);
    }

    function test_buySplitsFundsAndAddsTickets() public {
        vm.prank(alice);
        sale.buyPack(0);
        assertEq(usdg.balanceOf(address(vault)), 2e6); // 20% cut
        assertEq(usdg.balanceOf(fees), 0.1e6); // 1% protocol fee
        assertEq(usdg.balanceOf(address(sale)), 500e6 + 7.9e6);
        assertEq(vault.tickets(1, alice), PRICE);
        assertEq(sale.reservedLiability(), 30e6); // 3x worst case reserved
    }

    function test_buyBlockedWhenUnderfunded() public {
        // drain the float so the treasury can't cover a worst-case card
        sale.withdraw(address(usdg), address(this), 500e6);
        vm.prank(alice);
        vm.expectRevert(PackSale.InsufficientReserves.selector);
        sale.buyPack(0);
    }

    function test_withdrawCannotBreakReserve() public {
        vm.prank(alice);
        sale.buyPack(0); // reserves 30e6
        vm.expectRevert(PackSale.InsufficientReserves.selector);
        sale.withdraw(address(usdg), address(this), 490e6); // would leave < 30e6
        sale.withdraw(address(usdg), address(this), 470e6); // leaves 37.9e6 >= 30e6, fine
    }

    function test_liabilityReleasedOnSettle() public {
        uint256 id = _buyAndArm(alice, false);
        assertEq(sale.reservedLiability(), 30e6);
        sale.open(id);
        assertEq(sale.reservedLiability(), 0);
    }

    function test_openDeliversStock() public {
        uint256 id = _buyAndArm(alice, false);
        sale.open(id);

        (,,, bool settled) = sale.purchases(id);
        assertTrue(settled);
        uint256 got = aapl.balanceOf(alice) + nvda.balanceOf(alice);
        assertGt(got, 0, "alice should hold a stock token");
        // card value is 0.7x–3x of $10; at $200–$1000/share amount is bounded
        assertLt(got, 1e18, "amount sanity");
    }

    function test_openCannotSettleTwice() public {
        uint256 id = _buyAndArm(alice, false);
        sale.open(id);
        vm.expectRevert(PackSale.AlreadySettled.selector);
        sale.open(id);
    }

    function test_openTooEarlyReverts() public {
        vm.prank(alice);
        uint256 id = sale.buyPack(0);
        vm.expectRevert(PackSale.TooEarly.selector);
        sale.open(id);
    }

    function test_hiddenCardPaysFromVault() public {
        // seed the vault pot with someone else's purchases
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(bob);
            sale.buyPack(0);
        }
        uint256 pot = usdg.balanceOf(address(vault));
        assertEq(pot, 20e6);

        uint256 id = _buyAndArm(alice, true);
        pot = usdg.balanceOf(address(vault));
        sale.open(id);

        uint256 won = usdg.balanceOf(alice) - (1000e6 - 10e6);
        assertGt(won, 0, "hidden card should pay out");
        // curve caps at 25% of the open pot
        assertLe(won, pot / 4);
        assertEq(aapl.balanceOf(alice) + nvda.balanceOf(alice), 0, "no stock on jackpot pulls");
    }

    function test_refundWhenNoInventory() public {
        uint256 id = _buyAndArm(alice, false);
        // drain inventory
        sale.withdraw(address(aapl), address(this), aapl.balanceOf(address(sale)));
        sale.withdraw(address(nvda), address(this), nvda.balanceOf(address(sale)));

        uint256 before = usdg.balanceOf(alice);
        sale.open(id);
        assertGt(usdg.balanceOf(alice), before, "refund paid in USDG");
    }

    function test_rearmAfterBlockhashWindow() public {
        vm.prank(alice);
        uint256 id = sale.buyPack(0);
        vm.roll(block.number + 300); // past the 256-block window, hash reads zero

        sale.open(id);
        (,, uint64 commitBlock, bool settled) = sale.purchases(id);
        assertFalse(settled);
        assertEq(commitBlock, uint64(block.number));

        vm.setBlockhash(commitBlock, _findHash(id, false));
        vm.roll(block.number + 1);
        sale.open(id);
        (,,, settled) = sale.purchases(id);
        assertTrue(settled);
    }

    function test_roundCloseAndProRataClaims() public {
        vm.prank(alice);
        sale.buyPack(0); // 10 tickets-worth
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(bob);
            sale.buyPack(0); // 30 tickets-worth
        }
        uint256 pot = usdg.balanceOf(address(vault));
        assertEq(pot, 8e6);

        vm.prank(alice);
        vm.expectRevert(JackpotVault.NotOwner.selector);
        vault.closeRound();

        // owner closes whenever the team decides — no schedule
        vault.closeRound();

        assertEq(vault.claimable(1, alice), pot / 4);
        assertEq(vault.claimable(1, bob), (pot * 3) / 4);

        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        vault.claim(1);
        assertEq(usdg.balanceOf(alice) - before, pot / 4);

        vm.prank(alice);
        vm.expectRevert(JackpotVault.AlreadyClaimed.selector);
        vault.claim(1);

        // new round keeps accruing separately
        vm.prank(bob);
        sale.buyPack(0);
        assertEq(vault.tickets(2, bob), PRICE);
    }

    function test_onlyPackSaleCanAward() public {
        vm.expectRevert(JackpotVault.NotPackSale.selector);
        vault.awardHiddenCard(alice, 1000);
    }

    function test_stalePriceReverts() public {
        uint256 id = _buyAndArm(alice, false);
        vm.warp(block.timestamp + 4 days); // past maxPriceAge
        vm.expectRevert(PackSale.StalePrice.selector);
        sale.open(id);
    }
}
