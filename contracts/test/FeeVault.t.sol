// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FeeVault, IERC20} from "../src/FeeVault.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract FeeVaultTest is Test {
    FeeVault internal vault;
    MockToken internal token;
    address internal treasury = makeAddr("treasury");
    address internal payer = makeAddr("payer");
    address internal anyone = makeAddr("anyone");

    function setUp() public {
        vault = new FeeVault(treasury);
        token = new MockToken();
        vm.deal(payer, 10 ether);
    }

    function test_constructorRejectsZeroTreasury() public {
        vm.expectRevert(FeeVault.ZeroTreasury.selector);
        new FeeVault(address(0));
    }

    function test_receiveEmitsAndHolds() public {
        vm.prank(payer);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 1 ether);
    }

    function test_sweepNativeGoesOnlyToTreasury() public {
        vm.prank(payer);
        (bool ok,) = address(vault).call{value: 2 ether}("");
        assertTrue(ok);

        // Anyone can sweep; destination is fixed at the treasury.
        vm.prank(anyone);
        vault.sweepNative();
        assertEq(treasury.balance, 2 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_sweepNativeRevertsWhenEmpty() public {
        vm.expectRevert(FeeVault.NothingToSweep.selector);
        vault.sweepNative();
    }

    function test_sweepERC20GoesOnlyToTreasury() public {
        token.mint(address(vault), 500e18);

        vm.prank(anyone);
        vault.sweepERC20(IERC20(address(token)));
        assertEq(token.balanceOf(treasury), 500e18);
        assertEq(token.balanceOf(address(vault)), 0);
    }
}
