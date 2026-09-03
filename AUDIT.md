# Finch mainnet audit checklist

The release gate. Before Finch is called mainnet-ready, a full AI + human
audit walks every item. **Any critical finding blocks production.**

Status: `[ ]` not audited · `[~]` implemented, audit pending · `[x]` audited & passed

## Fee wallet & secrets
- [~] `FINCH_FEE_WALLET_PRIVATE_KEY` readable only by `src/server/wallet.ts`; no client/git/log/db/analytics/API exposure paths
- [~] `server-only` guard on signing modules; no autonomous fund movement without explicit workflow
- [ ] Secret scanning in CI; frontend bundle scan for secret material; rotation runbook
- [~] Users never asked for seed phrases anywhere

## Pons launch (3% creator tax)
- [~] `creatorTaxBps = 300` single-sourced (`FINCH_CREATOR_TAX_BPS`); no 2%/other fallback anywhere
- [~] Launch guard blocks signing until: network 4663, Pons version, launcher authorization, 300 bps permitted, fee recipient match, simulation pass
- [ ] Guard's onchain checks implemented against the published Pons ABI (currently hard-blocked pending ABI)
- [ ] Pons addresses + version pinned and verified; fee accounting separates creator tax from Pons protocol fees
- [~] Copy never claims all Pons fees; no treasury UI, no DAO/governance surfaces

## Signer boundaries & authorization
- [~] Operator keys isolated to runtime env; browser-construction guards throw
- [~] OperatorBudget: operators cannot raise limits; owner pause/revoke/sweep (tested)
- [x] Approval gate: a parked intent is released ONLY by a recorded human approval (regression test)
- [x] Counterparty allowlist covers approvals + RWA; contract allowlist covers approvals + ERC20 transfers (tests)
- [x] Allowance debited at submission so a lost receipt cannot inflate the cap (test)
- [ ] ERC-4337 session keys: expiration, contract/function allowlists, per-tx + daily limits, batching review
- [ ] Reentrancy + authorization review of FeeVault / OperatorBudget / FinchRegistry / CreditsLedger(draft stays undeployed)

## Execution & transactions
- [x] Modes explicit (preview/simulate/live); success only from valid receipts; full state machine in ExecutionRecord — covered by tests
- [x] Mandatory simulation before signing; failures halt with reasons — covered by tests
- [ ] Simulation staleness bound; slippage policy review on swaps
- [ ] Reconciliation job settles submitted/dropped/replaced txs; wallet reconciliation
- [x] Idempotency: replaying a settled execution returns the record, never a second transaction — covered by tests
- [~] No fake buttons: every visible control works, is disabled, or states unavailability

## Registry & Proof of Flight
- [~] FinchRegistry permissionless, event-complete, rebuildable from chain (tested)
- [ ] Manifest hash verification pipeline (URI content ↔ onchain hash)
- [ ] Proof of Flight anchoring format review (no huge AI traces onchain)

## Data, RPC, providers
- [~] Mongo least-privilege, server-only, projection whitelists; chain remains source of truth
- [ ] RPC: primary + fallback + WS health-checked failover; indexer drift/lag monitoring
- [ ] Model-provider failover; MCP trust boundaries; prompt/tool-injection red-team (policy-probe suite) at target deny-rate

## Web & operations
- [~] Zod-validated POSTs, body caps, per-IP rate limits (single-instance) — shared-store limiter before scale-out
- [x] Write identity: anonymous callers cannot overwrite existing nests/finches; Aviary publishing is create-only
- [x] /api/chain shared TTL cache + single-flight so public polling cannot amplify RPC load
- [x] Honest degraded modes (no HYPERBOLIC key → previews refuse; RPC down → reachable:false with the error; no Mongo → labeled seed)
- [x] No fabricated stats: new listings report uptime as unmeasured, not 100%
- [ ] Observability: RPC/simulation/submission/confirmation latency, failure/revert/replacement rates, nest task latency, provider errors, alerting
- [ ] Kill switches + runbooks: stuck tx, indexer gap, provider outage, key compromise
- [ ] Production configs review; Lighthouse/performance pass on the landing world
