// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PonsAirdrop} from "../src/PonsAirdrop.sol";
import {PonsToken} from "../src/PonsToken.sol";
import {MockERC20} from "./Mocks.sol";

contract PonsAirdropTest is Test {
    PonsAirdrop drop;
    MockERC20 usdg;

    address a = makeAddr("a");
    address b = makeAddr("b");
    address c = makeAddr("c");
    address d = makeAddr("d");

    uint256 constant AMT_A = 950e6; // "top wallet" style allocation
    uint256 constant AMT_B = 30e6;
    uint256 constant AMT_C = 15e6;
    uint256 constant AMT_D = 5e6;
    uint256 constant TOTAL = AMT_A + AMT_B + AMT_C + AMT_D;

    bytes32 la;
    bytes32 lb;
    bytes32 lc;
    bytes32 ld;
    bytes32 nab;
    bytes32 ncd;
    bytes32 root;

    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x <= y ? keccak256(abi.encodePacked(x, y)) : keccak256(abi.encodePacked(y, x));
    }

    function setUp() public {
        drop = new PonsAirdrop();
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        usdg.mint(address(this), TOTAL);
        usdg.approve(address(drop), TOTAL);

        la = keccak256(abi.encodePacked(a, AMT_A));
        lb = keccak256(abi.encodePacked(b, AMT_B));
        lc = keccak256(abi.encodePacked(c, AMT_C));
        ld = keccak256(abi.encodePacked(d, AMT_D));
        nab = _pair(la, lb);
        ncd = _pair(lc, ld);
        root = _pair(nab, ncd);

        drop.createEpoch(address(usdg), root, TOTAL);
    }

    function _proofA() internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = lb;
        p[1] = ncd;
    }

    function test_createEpochEscrowsFunds() public view {
        assertEq(usdg.balanceOf(address(drop)), TOTAL);
        assertEq(drop.epochCount(), 1);
    }

    function test_claim() public {
        drop.claim(0, a, AMT_A, _proofA());
        assertEq(usdg.balanceOf(a), AMT_A);

        bytes32[] memory pd = new bytes32[](2);
        pd[0] = lc;
        pd[1] = nab;
        drop.claim(0, d, AMT_D, pd);
        assertEq(usdg.balanceOf(d), AMT_D);
    }

    function test_doubleClaimReverts() public {
        drop.claim(0, a, AMT_A, _proofA());
        vm.expectRevert(PonsAirdrop.AlreadyClaimed.selector);
        drop.claim(0, a, AMT_A, _proofA());
    }

    function test_wrongAmountReverts() public {
        vm.expectRevert(PonsAirdrop.InvalidProof.selector);
        drop.claim(0, a, AMT_A + 1, _proofA());
    }

    function test_wrongAccountReverts() public {
        vm.expectRevert(PonsAirdrop.InvalidProof.selector);
        drop.claim(0, b, AMT_A, _proofA());
    }

    function test_onlyOwnerCreatesEpochs() public {
        vm.prank(a);
        vm.expectRevert(PonsAirdrop.NotOwner.selector);
        drop.createEpoch(address(usdg), root, 1);
    }

    function test_ponsTokenBasics() public {
        PonsToken pons = new PonsToken(1_000_000_000e18);
        assertEq(pons.balanceOf(address(this)), 1_000_000_000e18);
        pons.transfer(a, 1e18);
        assertEq(pons.balanceOf(a), 1e18);
        vm.prank(a);
        pons.approve(b, 1e18);
        vm.prank(b);
        pons.transferFrom(a, c, 1e18);
        assertEq(pons.balanceOf(c), 1e18);
    }
}
