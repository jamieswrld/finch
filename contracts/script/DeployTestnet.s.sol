// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PackSale} from "../src/PackSale.sol";
import {JackpotVault} from "../src/JackpotVault.sol";
import {IERC20, IJackpotVault, IPoolManager} from "../src/Interfaces.sol";
import {MockERC20, MockFeed} from "../test/Mocks.sol";

/// @notice Full playable deployment on Robinhood Chain testnet (46630) with mock
///         USDG, mock stock tokens, and mock feeds.
///
///   forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
///
/// Requires PRIVATE_KEY in env (funded from https://faucet.testnet.chain.robinhood.com).
contract DeployTestnet is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);

        MockERC20 usdg = new MockERC20("Global Dollar (test)", "USDG", 6);

        string[3] memory tickers = ["AAPL", "NVDA", "TSLA"];
        int256[3] memory prices = [int256(230e8), int256(1150e8), int256(310e8)];
        address[] memory pool = new address[](3);

        JackpotVault vault = new JackpotVault(IERC20(address(usdg)));
        PackSale sale = new PackSale(
            IERC20(address(usdg)), IJackpotVault(address(vault)), IPoolManager(vm.envAddress("POOL_MANAGER"))
        );
        vault.setPackSale(address(sale));

        for (uint256 i = 0; i < 3; i++) {
            MockERC20 stock = new MockERC20(string.concat(tickers[i], " Stock Token (test)"), tickers[i], 18);
            MockFeed feed = new MockFeed(8, prices[i]);
            sale.setStock(address(stock), address(feed), 3000, 60);
            stock.mint(address(sale), 10_000e18); // inventory
            pool[i] = address(stock);
            console.log(tickers[i], address(stock));
        }

        // packs mirror the site: Starter $10, Blue Chip $25, AI $50
        sale.addPack(10e6, pool);
        sale.addPack(25e6, pool);
        sale.addPack(50e6, pool);

        usdg.mint(deployer, 100_000e6); // play money

        console.log("USDG     ", address(usdg));
        console.log("Vault    ", address(vault));
        console.log("PackSale ", address(sale));

        vm.stopBroadcast();
    }
}
