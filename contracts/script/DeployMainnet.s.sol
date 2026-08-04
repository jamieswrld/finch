// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PackSale} from "../src/PackSale.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {IERC20, IJackpotVault} from "../src/Interfaces.sol";

/// @notice Robinhood Chain mainnet (4663) deployment: real USDG, real Robinhood Stock
///         Tokens (beacon-verified), real Chainlink feeds — wired in one transaction batch.
///
///   forge script script/DeployMainnet.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
///
/// Requires PRIVATE_KEY (contracts/.env) and PAYOUT_DATE (unix ts) in env.
/// Pool stocks are strictly limited to tickers with a live Chainlink feed —
/// a pool stock without a feed would revert every open() that lands on it.
/// After deploy: transfer stock-token inventory + a USDG refund float to the PackSale.
contract DeployMainnet is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    struct StockFeed {
        address token;
        address feed;
    }

    // token = Robinhood Stock Token (beacon-verified against 0xb35490…5aE2 impl)
    // feed  = Chainlink proxy from reference-data-directory (robinhood-mainnet), 8 decimals
    function _stocks() internal pure returns (StockFeed[28] memory s) {
        s[0] = StockFeed(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15); // NVDA
        s[1] = StockFeed(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0); // AAPL
        s[2] = StockFeed(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38); // TSLA
        s[3] = StockFeed(0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E); // MSFT
        s[4] = StockFeed(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C); // AMZN
        s[5] = StockFeed(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b); // GOOGL
        s[6] = StockFeed(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1); // META
        s[7] = StockFeed(0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72); // AMD
        s[8] = StockFeed(0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, 0x820ABedFF239034956B7A9d2F0a331f9F075eB4c); // PLTR
        s[9] = StockFeed(0x6330D8C3178a418788dF01a47479c0ce7CCF450b, 0xA3a468A452940B7D6b69991207B508c609a98Ef2); // COIN
        s[10] = StockFeed(0xec262a75e413fAfD0dF80480274532C79D42da09, 0x396118bdFB181e6240E74D243F266B061c0edc3D); // MSTR
        s[11] = StockFeed(0x1b0E319c6A659F002271B69dB8A7df2F911c153E, 0x27C71df6A64fB476468EdF256CF72c038baB5B67); // GME
        s[12] = StockFeed(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, 0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb); // SPCX
        s[13] = StockFeed(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x319724394D3A0e3669269846abE664Cd621f9f6A); // SPY
        s[14] = StockFeed(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae); // QQQ
        s[15] = StockFeed(0x58FfE4a942d3885bAa22D7520691F611EF09e7AA, 0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F); // TSM
        s[16] = StockFeed(0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, 0x3f390C5C24628Ac7C489515402235FeAD71D1913); // INTC
        s[17] = StockFeed(0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA, 0xB4106147E8cce40b7d46124090d373A71b70f87D); // ASML
        s[18] = StockFeed(0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, 0x425EEFdCf05ed6526C3cE61Af99429A228a6d596); // MU
        s[19] = StockFeed(0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3, 0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C); // CRWV
        s[20] = StockFeed(0x558378E000D634A36593E338eBacdd6207640EfE, 0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb); // IONQ
        s[21] = StockFeed(0xB90A19fF0Af67f7779afF50A882A9CfF42446400, 0xfb133Fa4B7b385802B693a293606682Df47109A3); // SNDK
        s[22] = StockFeed(0xb0992820E760d836549ba69BC7598b4af75dEE03, 0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844); // ORCL
        s[23] = StockFeed(0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd, 0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b); // DELL
        s[24] = StockFeed(0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4, 0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984); // BABA
        s[25] = StockFeed(0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a); // CRCL
        s[26] = StockFeed(0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344, 0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c); // USO
        s[27] = StockFeed(0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f, 0x209b73908e92Ae021826eD79609845451Ecba2ce); // SLV
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        JackpotVault vault = new JackpotVault(IERC20(USDG), uint64(vm.envUint("PAYOUT_DATE")));
        PackSale sale = new PackSale(IERC20(USDG), IJackpotVault(address(vault)));
        vault.setPackSale(address(sale));

        StockFeed[28] memory stocks = _stocks();
        for (uint256 i = 0; i < stocks.length; i++) {
            sale.setFeed(stocks[i].token, stocks[i].feed);
        }

        // Pack 0 — Starter, $10, full feed-backed board
        address[] memory starter = new address[](stocks.length);
        for (uint256 i = 0; i < stocks.length; i++) {
            starter[i] = stocks[i].token;
        }
        sale.addPack(10e6, starter);

        // Pack 1 — Blue Chip, $25 (indices into _stocks)
        uint256[8] memory blueIdx = [uint256(1), 3, 4, 5, 6, 0, 2, 22]; // AAPL MSFT AMZN GOOGL META NVDA TSLA ORCL
        address[] memory bluechip = new address[](blueIdx.length);
        for (uint256 i = 0; i < blueIdx.length; i++) {
            bluechip[i] = stocks[blueIdx[i]].token;
        }
        sale.addPack(25e6, bluechip);

        // Pack 2 — AI, $50
        uint256[10] memory aiIdx = [uint256(0), 7, 15, 18, 17, 16, 19, 20, 8, 3]; // NVDA AMD TSM MU ASML INTC CRWV IONQ PLTR MSFT
        address[] memory ai = new address[](aiIdx.length);
        for (uint256 i = 0; i < aiIdx.length; i++) {
            ai[i] = stocks[aiIdx[i]].token;
        }
        sale.addPack(50e6, ai);

        console.log("Vault    ", address(vault));
        console.log("PackSale ", address(sale));
        console.log("Feeds set:", stocks.length);

        vm.stopBroadcast();
    }
}
