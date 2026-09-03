// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {FinchRegistry} from "../src/FinchRegistry.sol";
import {OperatorBudget} from "../src/OperatorBudget.sol";

/// @notice Deploys the Finch contracts to Robinhood Chain (4663).
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --broadcast --verify
///
/// Required env:
///   PRIVATE_KEY            deployer key (NOT the fee wallet, NOT an operator key)
///   FINCH_TREASURY_ADDRESS destination the FeeVault may sweep to, and the
///                          owner of OperatorBudget. Must be a wallet you control.
///
/// CreditsLedger is deliberately NOT deployed here: it is a draft and stays
/// undeployed until $FINCH exists and it has passed audit.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("FINCH_TREASURY_ADDRESS");
        require(treasury != address(0), "FINCH_TREASURY_ADDRESS is required");
        require(block.chainid == 4663, "expected Robinhood Chain (4663)");

        vm.startBroadcast(deployerKey);

        FinchRegistry registry = new FinchRegistry();
        FeeVault feeVault = new FeeVault(treasury);
        OperatorBudget operatorBudget = new OperatorBudget(treasury);

        vm.stopBroadcast();

        console.log("chain id            ", block.chainid);
        console.log("FinchRegistry       ", address(registry));
        console.log("FeeVault            ", address(feeVault));
        console.log("OperatorBudget      ", address(operatorBudget));
        console.log("");
        console.log("Set these in the app environment:");
        console.log("  FINCH_REGISTRY_ADDRESS=", address(registry));
        console.log("  FINCH_FEE_VAULT_ADDRESS=", address(feeVault));
        console.log("  FINCH_OPERATOR_BUDGET_ADDRESS=", address(operatorBudget));
    }
}
