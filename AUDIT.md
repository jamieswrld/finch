# Finch mainnet audit checklist

The release gate. Before Finch is called mainnet-ready, a full AI + human
audit walks every item. **Any critical finding blocks production.**

Status: `[ ]` not audited · `[~]` implemented, audit pending · `[x]` audited & passed

v0.5.0 rebuilt the execution layer for Solana. Every item that lives in that
layer is back to `[~]` until it is audited again, including the ones whose
regression tests carried over — a test that passed on the old code proves
nothing about the new code until it passes there and someone has read it.

## Fee wallet & secrets
- [~] `FINCH_FEE_WALLET_PRIVATE_KEY` readable only by `src/server/wallet.ts`; no client/git/log/db/analytics/API exposure paths
- [~] `server-only` guard on signing modules; no autonomous fund movement without explicit workflow
- [~] `FINCH_REGISTRY_AUTHORITY_KEY` lives only in `.env.local`, is read only by `scripts/registry-anchor.mjs`, is never echoed, and is never set on the deployment
- [~] Pre-commit secret scan covers API keys, credentialed Mongo URIs, and Solana secret keys as base58 (in env assignments or under key-ish names) and as 64-number arrays; known limit: a bare base58 key cannot be told from a signature
- [ ] Secret scanning in CI; frontend bundle scan for secret material; rotation runbook
- [~] Users never asked for seed phrases or secret keys anywhere

## $FINCH
- [~] While no mint account exists at $FINCH's contract address, every surface reports it as not launched; no supply, price, holder count or market appears without a live read, and a failed read says unreachable, never 0
- [~] The token gates nothing unless `PUBLISH_GATE=hold`; no treasury UI, no DAO/governance surfaces

## Signer boundaries & authorization
- [~] Operator keys isolated to runtime env; browser-construction guards throw
- [ ] Operator float: the operator keypair can lose at most what it is funded with, and the PolicyEngine is the only limit below that (there is no onchain budget program) — size the float as the worst case, document sweep and top-up
- [~] Policy decodes each intent's instructions (System, SPL Token / Token-2022, associated token accounts, Jupiter routes) instead of trusting its summary; any program not on `allowedPrograms` is denied
- [~] Approval gate: a parked intent is released ONLY by a recorded human approval (regression test)
- [~] Recipient allowlist covers transfers, approvals + RWA; program allowlist covers every program an intent invokes (tests)
- [~] Allowance debited at submission so a lost confirmation cannot inflate the cap (test)

## User-signed execution
- [~] The landed transaction is compared to the prepared one instruction by instruction (program, accounts and roles, data); the fee payer must be the signer the intent was prepared for; only wallet-added compute-budget and Lighthouse assertion instructions are tolerated
- [~] Per-signer caps durable in MongoDB across instances (Courier Finch: 0.1 SOL per transfer, 0.5 SOL per day); spend recorded when the signature is verified on chain
- [~] State transitions are compare-and-set, so a double submit cannot double count

## Execution & transactions
- [~] Modes explicit (preview/simulate/live); success only from confirmed transactions; full state machine in ExecutionRecord — covered by tests
- [~] Mandatory simulation (`simulateTransaction`) before signing; failures halt with the error and program logs — covered by tests
- [ ] Simulation staleness bound (blockhash age); slippage policy review on swaps
- [ ] Reconciliation job settles submitted, dropped and expired-blockhash transactions; wallet reconciliation
- [~] Idempotency: replaying a settled execution returns the record, never a second transaction — covered by tests
- [~] No fake buttons: every visible control works, is disabled, or states unavailability

## Registry & Proof of Flight
- [~] Memo-anchored registry: a listing counts only when `FINCH_REGISTRY_AUTHORITY` signed its memo; rebuildable from that address's signature history; unconfigured means every listing reads as not anchored
- [ ] The authority is one key: a leak lets anyone anchor listings in Finch's name. Rotation and a revocation memo format are not defined yet
- [ ] Manifest hash verification pipeline (URI content ↔ anchored sha256)
- [ ] Proof of Flight anchoring format review (no huge AI traces onchain)

## Data, RPC, providers
- [~] Mongo least-privilege, server-only, projection whitelists; chain remains source of truth
- [ ] RPC: dedicated provider endpoints in `SOLANA_RPC_URLS` in production (the public endpoint is rate limited), in-order failover, per-endpoint health; indexer drift/lag monitoring
- [ ] Model-provider failover; MCP trust boundaries; prompt/tool-injection red-team (policy-probe suite) at target deny-rate

## Web & operations
- [~] Zod-validated POSTs, body caps, per-IP rate limits (single-instance) — shared-store limiter before scale-out
- [x] Write identity: anonymous callers cannot overwrite existing nests/finches; Aviary publishing is create-only
- [x] /api/chain shared TTL cache + single-flight so public polling cannot amplify RPC load
- [~] Honest degraded modes (no compute key → previews refuse; RPC down → reachable:false with the error; no Mongo → labeled seed)
- [x] No fabricated stats: new listings report uptime as unmeasured, not 100%
- [ ] Observability: RPC/simulation/submission/confirmation latency, failure/revert/expiry rates, nest task latency, provider errors, alerting
- [ ] Kill switches + runbooks: stuck tx, indexer gap, provider outage, key compromise
- [ ] Production configs review; Lighthouse/performance pass on the landing world
