// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PackSaleCore} from "../src/PackSaleCore.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {CommitRevealRandomness} from "../src/CommitRevealRandomness.sol";
import {UniswapV4Adapter} from "../src/UniswapV4Adapter.sol";
import {IERC20, IJackpotVault, IPoolManager} from "../src/Interfaces.sol";
import {IRandomness} from "../src/interfaces/IRandomness.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";

/// @notice Modular deployment: Core + Randomness + Swap Adapter + Vault.
///   forge script script/DeployModular.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
contract DeployModular is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    struct S {
        address token;
        address feed;
        uint24 fee;
        int24 tickSpacing;
    }

    function _stocks() internal pure returns (S[20] memory s) {
        s[0] = S(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 3000, 60); // NVDA
        s[1] = S(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 10000, 200); // AAPL
        s[2] = S(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 3000, 60); // TSLA
        s[3] = S(0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E, 3000, 60); // MSFT
        s[4] = S(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 3000, 60); // AMZN
        s[5] = S(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 3000, 60); // GOOGL
        s[6] = S(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, 3000, 60); // META
        s[7] = S(0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 10000, 200); // AMD
        s[8] = S(0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c, 10000, 200); // PLTR
        s[9] = S(0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 0xA3a468A452940B7D6b69991207B508c609a98Ef2, 10000, 200); // COIN
        s[10] = S(0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0x27C71df6A64fB476468EdF256CF72c038baB5B67, 10000, 200); // GME
        s[11] = S(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb, 3000, 60); // SPCX
        s[12] = S(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 3000, 60); // SPY
        s[13] = S(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 10000, 200); // QQQ
        s[14] = S(0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F, 3000, 60); // TSM
        s[15] = S(0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913, 3000, 60); // INTC
        s[16] = S(0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596, 10000, 200); // MU
        s[17] = S(0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3, 10000, 200); // SNDK
        s[18] = S(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 0x209b73908e92Ae021826eD79609845451Ecba2ce, 10000, 200); // SLV
        s[19] = S(0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA, 0xB4106147E8cce40b7d46124090d373A71b70f87D, 3000, 60); // ASML
    }

    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        JackpotVault vault = new JackpotVault(IERC20(USDG));
        CommitRevealRandomness rng = new CommitRevealRandomness();
        UniswapV4Adapter adapter = new UniswapV4Adapter(IPoolManager(POOL_MANAGER));

        PackSaleCore core = new PackSaleCore(
            IERC20(USDG), IJackpotVault(address(vault)), IRandomness(address(rng)), ISwapAdapter(address(adapter))
        );

        vault.setPackSale(address(core));
        rng.setAuthorized(address(core), true);

        // ETH -> USDG route for native payment
        adapter.setRoute(address(0), USDG, 500, 10);

        S[20] memory stocks = _stocks();
        address[] memory all = new address[](stocks.length);
        for (uint256 i = 0; i < stocks.length; i++) {
            core.setFeed(stocks[i].token, stocks[i].feed);
            adapter.setRoute(USDG, stocks[i].token, stocks[i].fee, stocks[i].tickSpacing);
            all[i] = stocks[i].token;
        }

        core.addPack(10e6, all); // Starter

        uint256[8] memory blue = [uint256(1), 3, 4, 5, 6, 0, 2, 14];
        address[] memory bluechip = new address[](blue.length);
        for (uint256 i = 0; i < blue.length; i++) bluechip[i] = stocks[blue[i]].token;
        core.addPack(25e6, bluechip); // Blue Chip

        uint256[8] memory ai = [uint256(0), 7, 14, 16, 19, 15, 8, 3];
        address[] memory aiPack = new address[](ai.length);
        for (uint256 i = 0; i < ai.length; i++) aiPack[i] = stocks[ai[i]].token;
        core.addPack(50e6, aiPack); // AI

        core.addPack(100e6, all); // Whale

        console.log("JackpotVault ", address(vault));
        console.log("Randomness   ", address(rng));
        console.log("SwapAdapter  ", address(adapter));
        console.log("PackSaleCore ", address(core));

        vm.stopBroadcast();
    }
}
