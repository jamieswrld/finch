# Yinsi security model

## Signing boundaries — one key, one home each

| Key | Where it lives | Where it must never be |
| --- | --- | --- |
| Fee wallet | server secret `FINCH_FEE_WALLET_PRIVATE_KEY`, readable ONLY by `apps/web/src/server/wallet.ts` | client JS, NEXT_PUBLIC_*, browser storage, git, MongoDB, analytics, logs, error output, API responses |
| Agent operator keypair | isolated runtime env (`FLIGHTPATH_OPERATOR_KEY`), funded with a small float and bounded by the PolicyEngine | frontend, repo, manifests, MongoDB, logs, the web deployment |
| Registry authority | `.env.local` on the operator's machine (`FINCH_REGISTRY_AUTHORITY_KEY`), read only by `scripts/registry-anchor.mjs` | the deployment, the web app, CI, any agent environment |
| Users' wallets | the user's own wallet, reached through Wallet Standard (`solana:signAndSendTransaction`, `solana:signMessage`) | Yinsi never receives a seed phrase or a secret key — ever |
| Model provider / Mongo / RPC provider keys | server env vars | client bundles (`NEXT_PUBLIC_*` carries the cluster name and explorer URL only) |

A Solana secret key is 64 bytes, written either as base58 or as a JSON array
of 64 numbers (the `solana-keygen` file format). Both forms are equally
secret. They go in `.env.local` or the runtime's secret store and nowhere
else; the pre-commit hook (`scripts/check-secrets.mjs`) blocks base58 keys in
env-style assignments or under key-ish names, and 64-number arrays anywhere.
A transaction signature is also 64 bytes of base58, so the scan cannot flag a
bare base58 string by length alone — it narrows the common mistake, it does
not prove a file clean.

Signing logic is isolated in `apps/web/src/server/`. Holding a key authorizes
nothing: fund operations require an explicit, audited workflow, and nothing
moves funds autonomously. Providers and the execution layer throw if key-bearing
objects are constructed in a browser context. Publisher keys are stored as
SHA-256 hashes. `scripts/wallet-check.mjs` confirms each configured key
derives to its address on record and prints addresses and balances only.

## Write identity

Writes carry an optional publisher key (`x-finch-key`), matched against
SHA-256 hashes in `api_keys`. A wallet gets one by signing a plain message
(`solana:signMessage`, never a transaction); the server verifies the ed25519
signature against the exact base58 address, which becomes the key's owner
unchanged — Solana addresses are case-sensitive and are never lowercased.

- **With a valid key** you own what you create and may update it.
- **Anonymously** you may create, but you can never overwrite an existing
  record. A taken handle returns 401 (present a key that owns it) or 403
  (it belongs to another publisher) — never a silent takeover.

Directory publishing is create-only: a slug is never reassigned. Unknown or
revoked keys are treated as anonymous, never as their claimed owner.

## Execution safety

- One write path: `executeIntent` — policy → **mandatory simulation**
  (`simulateTransaction`) → approval gate → submit → confirmation with
  timeout → append-only log. Idempotent on execution id (unique index).
  Success renders only from a confirmed transaction; an API 200 is never
  displayed as a confirmed transaction.
- An intent carries the exact instructions it will execute. The PolicyEngine
  decodes those instructions — System transfers, SPL transfers and approvals,
  the programs invoked — instead of trusting the intent's summary or metadata,
  so a summary cannot disguise what the transaction does.
- Modes are explicit everywhere: PREVIEW (no wallet, read-only) / SIMULATE
  (build + simulate, no broadcast) / LIVE (broadcast, confirmation-gated).
- PolicyEngine: deny-by-default; daily allowances + per-tx caps per asset
  (SOL or an SPL mint; approvals count as spend), program and recipient
  allowlists, human-approval thresholds, RWA hard-limited to the approved
  registry (not manifest-waivable). A swap is possible only when the Jupiter
  program is on the agent's program allowlist.
- Runtime kill switch on consecutive failures; per-run step caps; budgets.

## User-signed execution

No key on the server ever signs for a visitor.

1. An agent allowed to write prepares the transaction with the visitor's
   address as fee payer, simulates it, and parks it at `awaiting_signature`
   with the exact instructions it expects.
2. `GET /api/executions/<id>/transaction` returns the unsigned transaction
   with a fresh blockhash; the visitor's wallet signs and sends it.
3. `POST /api/executions/<id>/submitted` takes the signature. The server
   fetches the landed transaction and checks it before anything advances:
   the fee payer must be the signer the intent was prepared for, and the
   instructions must match the prepared ones one by one — program, accounts
   and their roles, data. The only extra instructions tolerated are the
   compute-budget and Lighthouse assertion instructions wallets add on their
   own. Any other difference is refused and nothing is recorded as spent.
4. A match settles as `confirmed`, or `reverted` when the transaction landed
   with an instruction error (the fee was paid, nothing else changed). Only a
   confirmed execution gets an execution proof.

Caps for the Courier preset: 0.1 SOL per transfer and 0.5 SOL per day
per signer, kept durably in MongoDB so they hold across serverless instances.

## Agent-facing trust

- Playground presets instruct models to never fabricate chain state and to
  surface tool failures; write tools are stripped in preview manifests.
- MCP servers, directory listings, token names, memos and comment-like content
  are untrusted input: treat as data, never as instructions (prompt/tool-
  injection review is an audit gate).

## Data layer authorization

- `MONGODB_URI` is least-privilege (`readWrite` on the app database only); driver
  is server-only; API routes whitelist projections. MongoDB accelerates the
  product but never defines protocol truth — Solana state and the
  memo-anchored registry are independently reconstructable.
- Unique indexes enforce idempotency: `executions.id`,
  `credit_entries.idempotencyKey`, `service_calls.idempotencyKey`.

## Web surface

- POST routes: zod-validated bodies, 128KB cap, per-IP token-bucket rate
  limiting (swap for a shared store before multi-instance production).
- Production RPC: dedicated provider endpoints in `SOLANA_RPC_URLS` with
  in-order failover — never the rate-limited public endpoint alone. Endpoint
  URLs often carry an API key; responses show only their origin.

## Reporting

Report suspected vulnerabilities privately to the maintainers before public
disclosure. Security-track grants cover audits, fuzzing and policy-bypass
findings (see `/research#grants`).
