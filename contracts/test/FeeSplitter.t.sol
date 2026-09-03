// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FeeSplitter, IERC20} from "../src/FeeSplitter.sol";

contract SplitMockERC20 is IERC20 {
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

/// A recipient that refuses ETH, to prove a failed leg reverts the whole split
/// rather than leaving funds half-distributed.
contract Refuser {
    receive() external payable {
        revert("no");
    }
}

contract FeeSplitterTest is Test {
    address prize = makeAddr("prize");
    address ops = makeAddr("ops");
    FeeSplitter splitter;

    function setUp() public {
        splitter = new FeeSplitter(prize, ops, 9_000);
    }

    function test_constructorPinsImmutableSplit() public view {
        assertEq(splitter.prize(), prize);
        assertEq(splitter.ops(), ops);
        assertEq(splitter.prizeBps(), 9_000);
        assertEq(splitter.opsBps(), 1_000);
    }

    function test_rejectsZeroAddresses() public {
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(address(0), ops, 9_000);
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(prize, address(0), 9_000);
    }

    function test_rejectsDegenerateSplit() public {
        vm.expectRevert(FeeSplitter.BadSplit.selector);
        new FeeSplitter(prize, ops, 0);
        vm.expectRevert(FeeSplitter.BadSplit.selector);
        new FeeSplitter(prize, ops, 10_000);
        vm.expectRevert(FeeSplitter.BadSplit.selector);
        new FeeSplitter(prize, ops, 15_000);
    }

    function test_nativeSplitsOnReceipt() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(splitter).call{value: 10 ether}("");
        assertTrue(ok);
        assertEq(prize.balance, 9 ether, "prize gets 90%");
        assertEq(ops.balance, 1 ether, "ops gets 10%");
        assertEq(address(splitter).balance, 0, "nothing stranded");
    }

    function test_roundingRemainderGoesToOps() public {
        // 1 wei: 90% of 1 floors to 0 → prize 0, ops 1. Nothing is lost.
        vm.deal(address(this), 1);
        (bool ok,) = address(splitter).call{value: 1}("");
        assertTrue(ok);
        assertEq(prize.balance, 0);
        assertEq(ops.balance, 1);
        assertEq(address(splitter).balance, 0);
    }

    function test_nativeSplitEmitsEvent() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(true, false, false, true);
        emit FeeSplitter.NativeSplit(address(this), 1 ether, 0.9 ether, 0.1 ether);
        (bool ok,) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_sweepNativeRevertsWhenEmpty() public {
        vm.expectRevert(FeeSplitter.NothingToSweep.selector);
        splitter.sweepNative();
    }

    function test_erc20SweepSplitsAndIsPermissionless() public {
        SplitMockERC20 token = new SplitMockERC20();
        token.mint(address(splitter), 1_000e18);

        // A stranger sweeps; the split still lands on the immutable recipients.
        vm.prank(makeAddr("stranger"));
        splitter.sweepERC20(token);

        assertEq(token.balanceOf(prize), 900e18);
        assertEq(token.balanceOf(ops), 100e18);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function test_erc20SweepRevertsWhenEmpty() public {
        SplitMockERC20 token = new SplitMockERC20();
        vm.expectRevert(FeeSplitter.NothingToSweep.selector);
        splitter.sweepERC20(token);
    }

    function test_failedLegRevertsWholeSplit() public {
        // If prize cannot receive, the transaction reverts and ops gets nothing
        // either — funds are never left half-distributed.
        Refuser refuser = new Refuser();
        FeeSplitter strict = new FeeSplitter(address(refuser), ops, 9_000);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(strict).call{value: 1 ether}("");
        assertFalse(ok, "split must revert when a leg fails");
        assertEq(ops.balance, 0, "ops must not be paid on a failed split");
    }
}
