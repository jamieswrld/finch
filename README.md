# FINCH

**A decentralized operating layer for intelligent software on Solana.**

build one nest. coordinate millions.

[finch.fun](https://finch.fun) · [x.com/finchnests](https://x.com/finchnests) · Solana mainnet

$FINCH: launches on pump.fun at `63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump` — until a mint account exists there, Finch reports it as not launched. Publishing is free either way.

```text
ONE FINCH → MORE FINCHES → NEST → NEST-TO-NEST → NETWORK
```

## The language is the architecture

| Term | Meaning |
| --- | --- |
| **Finch** | one specialized intelligent agent (Market, News, Launch, RWA, Wallet, Security, Dev, Execution…) |
| **Nest** | a coordinated swarm of finches aligned around one objective — task graph, shared context, permissions, budget |
| **Aviary** | the permissionless network directory: finches, nests, MCP servers, tools, APIs, datasets |
| **Flightpath** | the Solana execution layer: policy-checked, simulated, signed, confirmed |
| **Flight School** | try a real read-only finch in under a minute — no wallet |
| **Proof of Flight** | verifiable execution receipts for meaningful live actions |
| **Network** | thousands of independent finches and nests, reconstructable from Solana alone |

Core principles: **decentralized · accessible · interoperable · composable ·
portable · verifiable · functional · open.** A finch is a portable
`finch.json` manifest — import, export, fork, self-host, publish, version,
compose. Finch must not require finch.fun to exist.

## Repository layout

```text
apps/web              Next.js — landing world, /app (Flight School, Aviary,
                      Nests, Network, Finch Builder), API routes,
                      src/server (the isolated fee-wallet module)
packages/sdk          @finch/sdk — createFinch → hatch; finch.manifest/0.1
                      (finch.json); the runtime loop
packages/providers    @finch/providers — model abstraction (free tiers first,
                      openAICompatible escape hatch; never vendor-coupled)
packages/flightpath   @finch/flightpath — Solana cluster target, PolicyEngine,
                      mandatory execution lifecycle, tools, memo-anchored
                      registry, $FINCH reads, RWA registry
packages/db           @finch/db — MongoDB schemas/indexes, memory, metering.
                      MongoDB accelerates; Solana defines truth.
scripts               operator tools: secret scan (pre-commit), token facts,
                      wallet check, registry anchoring, site health checks
```

## Quickstart

```bash
npm install
cp .env.example .env.local   # everything degrades honestly when unset
npm run dev                  # http://localhost:3000
npm run typecheck && npm run build
```

With any one compute key set (`GROQ_API_KEY` is the quickest free tier),
Flight School previews run on the real runtime. With `MONGODB_URI` set,
`npm run seed -w @finch/db` loads the sample registry. The public mainnet RPC
works out of the box but is rate limited; set `SOLANA_RPC_URLS` to a provider
for anything beyond local use.

## Execution modes — everywhere, explicitly

- **PREVIEW** — no wallet; public reads and reasoning only.
- **SIMULATE** — build the real Solana transaction, simulate it against
  current state (`simulateTransaction`), display everything; no broadcast.
- **LIVE** — the operator key or the visitor's own wallet signs; success is
  shown only after the transaction is confirmed on chain.

Every write follows `construct → validate policy → simulate → authorize →
submit → confirm → reconcile → persist`. An intent carries the exact
instructions it will run, and the policy engine decodes those instructions
rather than trusting a summary. "API responded 200" is never "transaction
successful". No fake buttons: a control works, is disabled, or says it isn't
available yet.

## Registry

A finch or nest is anchored by a Memo-program transaction signed by the
registry authority (`FINCH_REGISTRY_AUTHORITY`):
`finch-registry/1 register <kind>:<handle> sha256:<manifest hash> [<uri>]`.
The index is read from that address's signature history, and a memo counts
only when the authority actually signed it — so anyone can verify a listing
from Solana alone. Until the authority is configured, every listing is
reported as not anchored. `scripts/registry-anchor.mjs` builds and prints the
memo, and sends it only when run with `--send`.

## $FINCH

$FINCH launches on pump.fun. Its mint address,
`63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump`, is baked in as the default
(`FINCH_TOKEN_MINT` overrides it). Until a mint account exists there, the
site, the API (`GET /api/token`, `launched: false`) and the `finch_token`
tool report $FINCH as not launched. Once live it trades on pump.fun's bonding
curve and, after graduation, on pump.fun's AMM. Finch reads it live — supply
and authorities from the mint account, the launch phase from pump.fun's
bonding-curve account, price and holder count from Jupiter, markets from
DexScreener — and every figure carries its source; a failed read says
"unreachable", never 0.

The token gates nothing. Core infrastructure stays free: SDK, manifests,
self-hosting, Aviary browsing, publishing, Flight School read-only presets,
public Solana reads. `PUBLISH_GATE=hold` is the only switch that would ever
require holding $FINCH to publish.

## Honest-state principles

- No fabricated onchain state, metrics, or success. Real registry counts only.
- Seed/demo rows are always labeled; unconfigured infra says so.
- The fee-wallet secret key exists only as a server secret, readable only by
  `src/server/wallet.ts`; nothing moves funds without an explicit workflow.

## Production gate

`AUDIT.md` is the mainnet checklist — key isolation, signer boundaries,
instruction-level policy, simulation, reconciliation, MCP/prompt-injection
trust, RPC and provider failover. **Critical findings block production.** See
`SECURITY.md` and `DEPLOY.md`.
