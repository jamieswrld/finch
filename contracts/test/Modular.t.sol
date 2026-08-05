// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {PackSaleCore} from "../src/PackSaleCore.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {UniswapV4Adapter} from "../src/UniswapV4Adapter.sol";
import {IERC20, IJackpotVault, IPoolManager} from "../src/Interfaces.sol";
import {IRandomness} from "../src/interfaces/IRandomness.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// Fork tests for the modular stack against real Uniswap v4 and real stock tokens.
///   forge test --match-path test/Modular.t.sol --fork-url https://rpc.mainnet.chain.robinhood.com
contract ModularTest is Test {
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
    CommitRevealRandomness rng;
    UniswapV4Adapter adapter;
    PackSaleCore core;
    address buyer = makeAddr("buyer");

    function setUp() public {
        vault = new JackpotVault(IERC20(USDG));
        rng = new CommitRevealRandomness();
        adapter = new UniswapV4Adapter(IPoolManager(POOL_MANAGER));
        core = new PackSaleCore(
            IERC20(USDG), IJackpotVault(address(vault)), IRandomness(address(rng)), ISwapAdapter(address(adapter))
        );

        vault.setPackSale(address(core));
        rng.setAuthorized(address(core), true);
        adapter.setRoute(address(0), USDG, 500, 10);

        address[3] memory toks = [NVDA, MSFT, TSLA];
        address[3] memory feeds = [NVDA_FEED, MSFT_FEED, TSLA_FEED];
        address[] memory pool = new address[](3);
        for (uint256 i = 0; i < 3; i++) {
            core.setFeed(toks[i], feeds[i]);
            adapter.setRoute(USDG, toks[i], 3000, 60);
            pool[i] = toks[i];
        }
        core.addPack(10e6, pool);

        vm.startPrank(USDG_WHALE);
        IERC20(USDG).transfer(address(core), 500e6);
        IERC20(USDG).transfer(buyer, 100e6);
        vm.stopPrank();

        vm.prank(buyer);
        IERC20(USDG).approve(address(core), type(uint256).max);
    }

    function _held() internal view returns (uint256) {
        return IERC20(NVDA).balanceOf(buyer) + IERC20(MSFT).balanceOf(buyer) + IERC20(TSLA).balanceOf(buyer);
    }

    function test_buyAndOpen() public {
        vm.prank(buyer);
        uint256 id = core.buyPack(0);
        assertEq(IERC20(USDG).balanceOf(address(vault)), 2e6, "20% to vault");
        assertEq(core.reservedLiability(), 30e6);

        vm.roll(block.number + 1);
        core.open(id);

        assertGt(_held(), 0, "buyer received a real stock");
        assertEq(core.reservedLiability(), 0, "liability released");
    }

    function test_buyWithEth() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        uint256 id = core.buyPackETH{value: 0.01 ether}(0);
        vm.roll(block.number + 1);
        core.open(id);
        assertGt(_held(), 0, "eth buyer received a real stock");
    }

    function test_noRefundEverHappens() public {
        vm.prank(buyer);
        uint256 id = core.buyPack(0);
        vm.roll(block.number + 1);
        uint256 before = IERC20(USDG).balanceOf(buyer);
        core.open(id);
        assertEq(IERC20(USDG).balanceOf(buyer), before, "stock, never cash");
    }

    function test_randomnessIsSwappable() public {
        // a fresh randomness module can be dropped in without touching balances
        CommitRevealRandomness rng2 = new CommitRevealRandomness();
        rng2.setAuthorized(address(core), true);
        core.setModules(IRandomness(address(rng2)), ISwapAdapter(address(adapter)));
        assertEq(address(core.randomness()), address(rng2));

        vm.prank(buyer);
        uint256 id = core.buyPack(0);
        vm.roll(block.number + 1);
        core.open(id);
        assertGt(_held(), 0, "still settles through the new module");
    }

    function test_openTooEarlyReverts() public {
        vm.prank(buyer);
        uint256 id = core.buyPack(0);
        vm.expectRevert(PackSaleCore.NotReady.selector);
        core.open(id);
    }

    function test_rearmAfterExpiry() public {
        vm.prank(buyer);
        uint256 id = core.buyPack(0);
        vm.roll(block.number + 300); // past the 256-block hash window
        core.open(id); // re-arms rather than settling
        (,, bool settled) = core.purchases(id);
        assertFalse(settled);

        vm.roll(block.number + 1);
        core.open(id);
        (,, settled) = core.purchases(id);
        assertTrue(settled, "settles after re-arm");
    }

    function test_unauthorizedCannotCommit() public {
        vm.expectRevert(CommitRevealRandomness.NotAuthorized.selector);
        rng.commit(999);
    }
}
