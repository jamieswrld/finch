// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Swapper} from "../src/Swapper.sol";
import {IPoolManager} from "../src/Interfaces.sol";

contract DeploySwapper is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        Swapper s = new Swapper(IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951));
        console.log("Swapper", address(s));
        vm.stopBroadcast();
    }
}
