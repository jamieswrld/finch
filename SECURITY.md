# Finch security model

## Signing boundaries — one key, one home each

| Key | Where it lives | Where it must never be |
| --- | --- | --- |
| Finch fee wallet (creator-fee recipient) | server secret `FINCH_FEE_WALLET_PRIVATE_KEY`, readable ONLY by `apps/web/src/server/wallet.ts` | client JS, NEXT_PUBLIC_*, browser storage, git, MongoDB, analytics, logs, error output, API responses |
| Agent operator wallets | isolated runtime env (`FLIGHTPATH_OPERATOR_KEY`), bounded by OperatorBudget + PolicyEngine | frontend, repo, manifests, MongoDB, logs |
| Users' wallets | the user's own wallet via injected connection / future ERC-4337 session keys | Finch never receives a seed phrase — ever |
| Hyperbolic / Mongo / API keys | server env vars | client bundles (`NEXT_PUBLIC_*` carries chain params only) |

Signing logic is isolated in `apps/web/src/server/` (wallet, pons launch
guard). Holding a key authorizes nothing: fund operations require an explicit,
audited workflow. Providers and Flightpath throw if key-bearing objects are
constructed in a browser context. Aviary API keys are stored as SHA-256 hashes.

## $FINCH launch guard

Before any launch signing, `src/server/pons.ts` must verify onchain: correct
Robinhood network (4663), expected Pons version, launcher authorization, that
**300 bps** is currently permitted, the fee recipient matches the fee wallet,
and token parameters/economics — then simulate. Any failed check blocks the
launch with the reason displayed. Never silently use a different rate,
version, or recipient.

## Write identity

Finch has no user accounts yet, so the registry does not pretend to know who
you are. Writes carry an optional publisher key (`x-finch-key`), matched
against SHA-256 hashes in `api_keys`:

- **With a valid key** you own what you create and may update it.
- **Anonymously** you may create, but you can never overwrite an existing
  record. A taken handle returns 401 (present a key that owns it) or 403
  (it belongs to another publisher) — never a silent takeover.

Aviary publishing is create-only: a slug is never reassigned. Unknown or
revoked keys are treated as anonymous, never as their claimed owner.

## Execution safety

- One write path: `executeIntent` — policy → **mandatory simulation** →
  approval gate → submit → confirmation with timeout → append-only log.
  Idempotent on execution id (unique index). Success renders only from a
  valid receipt; an API 200 is never displayed as a confirmed transaction.
- Modes are explicit everywhere: PREVIEW (no wallet, read-only) / SIMULATE
  (construct + simulate, no broadcast) / LIVE (broadcast, receipt-gated).
- PolicyEngine: deny-by-default; daily allowances + per-tx caps (approvals
  count as spend), contract/recipient allowlists, human-approval thresholds,
  RWA hard-limited to the approved registry (not manifest-waivable).
- Runtime kill switch on consecutive failures; per-run step caps; budgets.
- Account abstraction direction: ERC-4337 smart accounts with session keys,
  expirations, function allowlists and spending limits — never a user seed.

## Agent-facing trust

- Flight School presets instruct models to never fabricate chain state and to
  surface tool failures; write tools are stripped in preview manifests.
- MCP servers, Aviary listings and comment-like content are untrusted input:
  treat as data, never as instructions (prompt/tool-injection review is an
  audit gate).

## Data layer authorization

- `MONGODB_URI` is least-privilege (`readWrite` on the finch db only); driver
  is server-only; API routes whitelist projections. MongoDB accelerates the
  product but never defines protocol truth — Robinhood Chain state and the
  FinchRegistry are independently reconstructable.
- Unique indexes enforce idempotency: `executions.id`,
  `credit_entries.idempotencyKey`, `service_calls.idempotencyKey`,
  `fee_events.(txHash, logIndex)`.

## Web surface

- POST routes: zod-validated bodies, 128KB cap, per-IP token-bucket rate
  limiting (swap for a shared store before multi-instance production).
- Production RPC: primary + fallback + WebSocket, health-checked failover —
  never a single free public endpoint.

## Reporting

Report suspected vulnerabilities privately to the maintainers before public
disclosure. Security-track grants cover audits, fuzzing and policy-bypass
findings (see `/research#grants`).
