// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PackSale} from "../src/PackSale.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {IERC20, IJackpotVault} from "../src/Interfaces.sol";

/// @notice Robinhood Chain mainnet (4663) deployment against the real USDG and
///         Robinhood Stock Tokens.
///
///   forge script script/DeployMainnet.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
///
/// After deploy, the owner still must:
///   1. setFeed() for every pool stock with its Chainlink feed address
///      (docs.chain.link/data-feeds → Robinhood Chain — feeds not hardcoded here on purpose).
///   2. Transfer stock-token inventory to the PackSale address.
contract DeployMainnet is Script {
    // Verified against the on-chain registry (docs.robinhood.com/chain/contracts)
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;
    address constant AMD = 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC;
    address constant PLTR = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        JackpotVault vault = new JackpotVault(IERC20(USDG), uint64(vm.envUint("PAYOUT_DATE")));
        PackSale sale = new PackSale(IERC20(USDG), IJackpotVault(address(vault)));
        vault.setPackSale(address(sale));

        // Starter Pack — $10, full board
        address[] memory starter = new address[](9);
        starter[0] = AAPL;
        starter[1] = NVDA;
        starter[2] = TSLA;
        starter[3] = MSFT;
        starter[4] = AMZN;
        starter[5] = GOOGL;
        starter[6] = META;
        starter[7] = AMD;
        starter[8] = PLTR;
        sale.addPack(10e6, starter);

        // Blue Chip Pack — $25, Mag-7
        address[] memory bluechip = new address[](7);
        bluechip[0] = AAPL;
        bluechip[1] = MSFT;
        bluechip[2] = AMZN;
        bluechip[3] = GOOGL;
        bluechip[4] = META;
        bluechip[5] = NVDA;
        bluechip[6] = TSLA;
        sale.addPack(25e6, bluechip);

        // AI Pack — $50
        address[] memory ai = new address[](5);
        ai[0] = NVDA;
        ai[1] = AMD;
        ai[2] = MSFT;
        ai[3] = PLTR;
        ai[4] = META;
        sale.addPack(50e6, ai);

        console.log("Vault    ", address(vault));
        console.log("PackSale ", address(sale));

        vm.stopBroadcast();
    }
}
