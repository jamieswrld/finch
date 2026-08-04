// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PonsToken} from "../src/PonsToken.sol";
import {PonsAirdrop} from "../src/PonsAirdrop.sol";

/// @notice Deploys PONS (1B fixed supply to deployer) and its airdrop distributor.
///
///   forge script script/DeployPons.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
contract DeployPons is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        PonsToken pons = new PonsToken(1_000_000_000e18);
        PonsAirdrop drop = new PonsAirdrop();

        console.log("PONS       ", address(pons));
        console.log("PonsAirdrop", address(drop));

        vm.stopBroadcast();
    }
}
