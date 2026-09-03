# Finch contracts

Solidity contracts backing Finch's treasury security model on Robinhood Chain (EVM).

| Contract | Status | Purpose |
| --- | --- | --- |
| `FeeVault.sol` | ready for review | Receives the 3% Pons creator tax. Funds can only move to the immutable Finch treasury wallet; sweeping is permissionless. |
| `OperatorBudget.sol` | ready for review | Multisig-owned float with per-operator / per-token / per-epoch spending budgets for restricted automation wallets. |
| `FinchRegistry.sol` | ready for review | Permissionless onchain identity for finches and nests: id, owner, manifest hash, manifest URI, version, status. Event-complete, so the registry is rebuildable from chain state alone. |
| `CreditsLedger.sol` | **draft — do not deploy** | Architectural sketch for future $FINCH → compute-credit purchases. $FINCH does not exist onchain yet. |

## Security model

```
Finch Treasury multisig (Safe)          ← holds everything; never automated
        │  owns / funds / can pause, revoke, sweep
        ▼
OperatorBudget                          ← bounded float only
        │  per-epoch allowances, category-tagged spends
        ▼
restricted operator wallets             ← what agents/automation actually hold
```

No private key for the multisig exists anywhere in this repository, the web
app, or any agent environment. Operator keys live only in the isolated runner
environment (`FLIGHTPATH_OPERATOR_KEY`) and are bounded by both this contract
onchain and the Flightpath `PolicyEngine` offchain.

## Setup

Foundry is required (not bundled). On Windows, use WSL or follow
https://getfoundry.sh:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
cd contracts
forge install foundry-rs/forge-std
forge test -vvv
```

## Deploying

```bash
export PRIVATE_KEY=0x…                 # deployer — NOT the fee wallet, NOT an operator key
export FINCH_TREASURY_ADDRESS=0x…      # FeeVault sweep destination + OperatorBudget owner

forge script script/Deploy.s.sol:Deploy   --rpc-url https://rpc.mainnet.chain.robinhood.com   --broadcast --verify
```

The script asserts `block.chainid == 4663` and prints the env lines to paste
into the app. `CreditsLedger` is deliberately excluded — it stays undeployed
until $FINCH exists and it has passed audit.

## Deployment order (when Robinhood Chain params are live)

1. Deploy the treasury multisig (Safe) — outside this repo.
2. `FeeVault(treasury)` — set its address as the Pons creator-fee recipient and as `FINCH_FEE_VAULT_ADDRESS`.
3. `OperatorBudget(treasury)` — multisig funds a small float, sets budgets.
4. `CreditsLedger` — **only after** $FINCH exists and the draft passes audit.

Critical audit findings block deployment. See `/AUDIT.md` at the repo root.
