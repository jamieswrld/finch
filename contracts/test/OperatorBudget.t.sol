// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OperatorBudget} from "../src/OperatorBudget.sol";

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
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

contract OperatorBudgetTest is Test {
    OperatorBudget internal budget;
    MockERC20 internal token;

    address internal multisig = makeAddr("multisig");
    address internal operator = makeAddr("operator");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant CATEGORY = bytes32("compute");

    function setUp() public {
        budget = new OperatorBudget(multisig);
        token = new MockERC20();
        vm.deal(address(budget), 10 ether);
        token.mint(address(budget), 1_000e18);
    }

    function test_onlyOwnerSetsBudget() public {
        vm.prank(stranger);
        vm.expectRevert(OperatorBudget.NotOwner.selector);
        budget.setBudget(operator, address(0), 1 ether, 1 days);
    }

    function test_spendWithinNativeBudget() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);

        vm.prank(operator);
        budget.spend(address(0), recipient, 0.4 ether, CATEGORY);

        assertEq(recipient.balance, 0.4 ether);
        assertEq(budget.remainingBudget(operator, address(0)), 0.6 ether);
    }

    function test_spendWithinErc20Budget() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(token), 100e18, 1 days);

        vm.prank(operator);
        budget.spend(address(token), recipient, 60e18, CATEGORY);

        assertEq(token.balanceOf(recipient), 60e18);
        assertEq(budget.remainingBudget(operator, address(token)), 40e18);
    }

    function test_overBudgetReverts() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(OperatorBudget.BudgetExceeded.selector, 1.5 ether, 1 ether));
        budget.spend(address(0), recipient, 1.5 ether, CATEGORY);
    }

    function test_budgetExhaustionAcrossSpends() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);

        vm.startPrank(operator);
        budget.spend(address(0), recipient, 0.7 ether, CATEGORY);
        vm.expectRevert(abi.encodeWithSelector(OperatorBudget.BudgetExceeded.selector, 0.5 ether, 0.3 ether));
        budget.spend(address(0), recipient, 0.5 ether, CATEGORY);
        vm.stopPrank();
    }

    function test_epochRollResetsSpend() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);

        vm.prank(operator);
        budget.spend(address(0), recipient, 1 ether, CATEGORY);

        vm.warp(block.timestamp + 1 days + 1);
        assertEq(budget.remainingBudget(operator, address(0)), 1 ether);

        vm.prank(operator);
        budget.spend(address(0), recipient, 1 ether, CATEGORY);
        assertEq(recipient.balance, 2 ether);
    }

    function test_noBudgetReverts() public {
        vm.prank(operator);
        vm.expectRevert(OperatorBudget.NoBudget.selector);
        budget.spend(address(0), recipient, 1, CATEGORY);
    }

    function test_revokedBudgetReverts() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);
        vm.prank(multisig);
        budget.revokeBudget(operator, address(0));

        vm.prank(operator);
        vm.expectRevert(OperatorBudget.NoBudget.selector);
        budget.spend(address(0), recipient, 0.1 ether, CATEGORY);
    }

    function test_pausedBlocksSpend() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);
        vm.prank(multisig);
        budget.setPaused(true);

        vm.prank(operator);
        vm.expectRevert(OperatorBudget.ContractPaused.selector);
        budget.spend(address(0), recipient, 0.1 ether, CATEGORY);
    }

    function test_sweepOnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(OperatorBudget.NotOwner.selector);
        budget.sweep(address(0), stranger, 1 ether);

        vm.prank(multisig);
        budget.sweep(address(0), multisig, 1 ether);
        assertEq(multisig.balance, 1 ether);
    }

    function test_twoStepOwnership() public {
        vm.prank(multisig);
        budget.transferOwnership(stranger);
        assertEq(budget.owner(), multisig);

        vm.prank(stranger);
        budget.acceptOwnership();
        assertEq(budget.owner(), stranger);
    }

    function test_operatorCannotRaiseOwnBudget() public {
        vm.prank(multisig);
        budget.setBudget(operator, address(0), 1 ether, 1 days);

        vm.prank(operator);
        vm.expectRevert(OperatorBudget.NotOwner.selector);
        budget.setBudget(operator, address(0), 100 ether, 1 days);
    }
}
