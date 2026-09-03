// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {FinchRegistry} from "../src/FinchRegistry.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
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
///   PRIZE_ADDRESS          receives 90% of every fee routed through FeeSplitter;
///                          the other 10% goes to the FeeVault (operating cost).
///
/// CreditsLedger is deliberately NOT deployed here: it is a draft and stays
/// undeployed until $FINCH exists and it has passed audit.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("FINCH_TREASURY_ADDRESS");
        require(treasury != address(0), "FINCH_TREASURY_ADDRESS is required");
        address prize = vm.envAddress("PRIZE_ADDRESS");
        require(prize != address(0), "PRIZE_ADDRESS is required");
        require(block.chainid == 4663, "expected Robinhood Chain (4663)");

        vm.startBroadcast(deployerKey);

        FinchRegistry registry = new FinchRegistry();
        FeeVault feeVault = new FeeVault(treasury);
        OperatorBudget operatorBudget = new OperatorBudget(treasury);
        // Point the $FINCH creator-tax recipient at this. 90% prize / 10% ops,
        // immutable, split on receipt with no signer.
        FeeSplitter feeSplitter = new FeeSplitter(prize, address(feeVault), 9_000);

        vm.stopBroadcast();

        console.log("chain id            ", block.chainid);
        console.log("FinchRegistry       ", address(registry));
        console.log("FeeVault            ", address(feeVault));
        console.log("FeeSplitter         ", address(feeSplitter));
        console.log("OperatorBudget      ", address(operatorBudget));
        console.log("");
        console.log("Set these in the app environment:");
        console.log("  FINCH_REGISTRY_ADDRESS=", address(registry));
        console.log("  FINCH_FEE_VAULT_ADDRESS=", address(feeVault));
        console.log("  FINCH_OPERATOR_BUDGET_ADDRESS=", address(operatorBudget));
    }
}
