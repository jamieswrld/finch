// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PackSaleCore} from "../src/PackSaleCore.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {PancakeAdapter, IPancakeV3Router, IPancakeV2Router} from "../src/PancakeAdapter.sol";
import {IERC20, IJackpotVault} from "../src/Interfaces.sol";
import {IRandomness} from "../src/interfaces/IRandomness.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// @notice BNB Smart Chain deployment: Core + Randomness + Pancake Adapter + Vault.
///
///   forge script script/DeployBnb.s.sol --rpc-url https://bsc-rpc.publicnode.com --broadcast
///
/// Deploys and wires the modules, registers Chainlink feeds, and creates the four
/// packs. Swap routes are registered separately by scripts/configure-bnb-routes.mjs,
/// because BSC routing is a mix of v3-single, v3-multihop and v2 paths that is far
/// easier to express (and re-verify against live liquidity) off-chain.
contract DeployBnb is Script {
    /// USDT on BSC — 18 decimals here, unlike the 6-decimal USDT on Ethereum.
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant PANCAKE_V3_ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    struct A {
        address token;
        address feed;
    }

    function _assets() internal pure returns (A[15] memory s) {
        s[0] = A(0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c, 0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf); // BTCB
        s[1] = A(0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c, 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE); // WBNB
        s[2] = A(0x2170Ed0880ac9A755fd29B2688956BD959F933F8, 0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e); // ETH
        s[3] = A(0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82, 0xB6064eD41d4f67e353768aA239cA86f4F73665a1); // CAKE
        s[4] = A(0xbA2aE424d960c26247Dd6c32edC70B295c744C43, 0x3AB0A0d137D4F946fBB19eecc6e92E64660231C8); // DOGE
        s[5] = A(0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE, 0x93A67D414896A280bF8FFB3b389fE3686E014fda); // XRP
        s[6] = A(0x570A5D26f7765Ecb712C0924E4De545B89fD43dF, 0x0E8a53DD9c13589df6382F13dA6B3Ec8F919B323); // SOL
        s[7] = A(0xBf5140A22578168FD562DCcF235E5D43A02ce9B1, 0xb57f259E7C24e56a1dA00F66b55A5640d9f9E7e4); // UNI
        s[8] = A(0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD, 0xca236E327F629f9Fc2c30A4E95775EbF0B89fac8); // LINK
        s[9] = A(0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47, 0xa767f745331D267c7751297D982b050c93985627); // ADA
        s[10] = A(0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63, 0xBF63F430A79D4036A5900C19818aFf1fa710f206); // XVS
        s[11] = A(0x4338665CBB7B2485A8855A139b75D5e34AB0DB94, 0x74E72F37A8c415c8f1a98Ed42E78Ff997435791D); // LTC
        s[12] = A(0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402, 0xC333eb0086309a16aa7c8308DfD32c8BBA0a2592); // DOT
        s[13] = A(0xa2B726B1145A4773F68593CF171187d8EBe4d495, 0x63A9133cd7c611d6049761038C16f238FddA71d7); // INJ
        s[14] = A(0x1CE0c2827e2eF14D5C4f29a091d735A204794041, 0x5974855ce31EE8E1fff2e76591CbF83D7110F151); // AVAX
    }

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        JackpotVault vault = new JackpotVault(IERC20(USDT));
        CommitRevealRandomness rng = new CommitRevealRandomness();
        PancakeAdapter adapter =
            new PancakeAdapter(IPancakeV3Router(PANCAKE_V3_ROUTER), IPancakeV2Router(PANCAKE_V2_ROUTER));

        PackSaleCore core = new PackSaleCore(
            IERC20(USDT), IJackpotVault(address(vault)), IRandomness(address(rng)), ISwapAdapter(address(adapter))
        );

        vault.setPackSale(address(core));
        rng.setAuthorized(address(core), true);

        A[15] memory assets = _assets();
        address[] memory all = new address[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            core.setFeed(assets[i].token, assets[i].feed);
            all[i] = assets[i].token;
        }

        // Pack prices are 18-decimal USDT.
        core.addPack(10e18, all); // Starter

        uint256[8] memory majorIdx = [uint256(0), 2, 1, 6, 5, 9, 12, 11];
        address[] memory majors = new address[](majorIdx.length);
        for (uint256 i = 0; i < majorIdx.length; i++) majors[i] = assets[majorIdx[i]].token;
        core.addPack(25e18, majors); // Blue Chip

        uint256[6] memory defiIdx = [uint256(3), 7, 8, 10, 13, 14];
        address[] memory defi = new address[](defiIdx.length);
        for (uint256 i = 0; i < defiIdx.length; i++) defi[i] = assets[defiIdx[i]].token;
        core.addPack(50e18, defi); // DeFi

        core.addPack(100e18, all); // Whale

        console.log("JackpotVault ", address(vault));
        console.log("Randomness   ", address(rng));
        console.log("SwapAdapter  ", address(adapter));
        console.log("PackSaleCore ", address(core));

        vm.stopBroadcast();
    }
}
