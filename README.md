# FINCH

**A decentralized operating layer for intelligent software on Robinhood Chain.**

build one nest. coordinate millions.

[finch.fun](https://finch.fun) · [x.com/finchnests](https://x.com/finchnests) · Robinhood Chain (4663)

```
ONE FINCH → MORE FINCHES → NEST → NEST-TO-NEST → NETWORK
```

## The language is the architecture

| Term | Meaning |
| --- | --- |
| **Finch** | one specialized intelligent agent (Market, News, Pons, RWA, Wallet, Security, Dev, Execution…) |
| **Nest** | a coordinated swarm of finches aligned around one objective — task graph, shared context, permissions, budget |
| **Aviary** | the permissionless network directory: finches, nests, MCP servers, tools, APIs, datasets |
| **Flightpath** | the Robinhood Chain execution layer (chain 4663) |
| **Flight School** | try a real read-only finch in under a minute — no wallet |
| **Proof of Flight** | verifiable execution receipts for meaningful live actions |
| **Network** | thousands of independent finches and nests, reconstructable from chain state |

Core principles: **decentralized · accessible · interoperable · composable ·
portable · verifiable · functional · open.** A finch is a portable
`finch.json` manifest — import, export, fork, self-host, publish, version,
compose. Finch must not require finch.fun to exist.

## Repository layout

```
apps/web              Next.js — landing world, /app (Flight School, Aviary,
                      Nests, Network, Finch Builder), API routes,
                      src/server (isolated fee-wallet + Pons launch guard)
packages/sdk          @finch/sdk — createFinch → hatch; finch.manifest/0.1
                      (finch.json); the runtime loop
packages/providers    @finch/providers — model abstraction (Hyperbolic first,
                      openAICompatible escape hatch; never vendor-coupled)
packages/flightpath   @finch/flightpath — chain 4663 target, PolicyEngine,
                      mandatory execution lifecycle, tools, Pons (3% creator
                      tax), RWA registry
packages/db           @finch/db — MongoDB schemas/indexes, memory, metering.
                      MongoDB accelerates; Robinhood Chain defines truth.
contracts             Foundry — FinchRegistry (onchain identity/registry),
                      FeeVault, OperatorBudget, CreditsLedger (draft)
```

## Quickstart

```bash
npm install
cp .env.example .env.local   # everything degrades honestly when unset
npm run dev                  # http://localhost:3000
npm run typecheck && npm run build
```

With `HYPERBOLIC_API_KEY` set, Flight School previews run on the real runtime.
With `MONGODB_URI` set, `npm run seed -w @finch/db` loads the sample registry.

## Execution modes — everywhere, explicitly

- **PREVIEW** — no wallet; public reads and reasoning only.
- **SIMULATE** — construct the real Robinhood transaction, simulate against
  current chain state, display everything; no broadcast.
- **LIVE** — broadcast; success is shown only after a valid receipt.

Every write follows `construct → validate policy → simulate → authorize →
submit → confirm → reconcile → persist`. "API responded 200" is never
"transaction successful". No fake buttons: a control works, is disabled, or
says it isn't available yet.

## $FINCH

Launches through Pons on Robinhood Chain with a **3% creator tax (300 bps)**
to the team-controlled Finch fee wallet, which funds infrastructure,
development, compute, hosting, indexing and growth at our discretion. No DAO,
no treasury governance, no treasury UI. Pons-level protocol fees are separate
and never claimed as Finch revenue. The launch guard
(`apps/web/src/server/pons.ts`) blocks signing unless the deployed Pons
version verifiably permits 300 bps to our recipient — no silent fallbacks.

Core infrastructure stays free: SDK, manifests, self-hosting, Aviary
browsing, Flight School read-only presets, public Robinhood/Pons reads.

## Honest-state principles

- No fabricated onchain state, metrics, or success. Real registry counts only.
- Seed/demo rows are always labeled; unconfigured infra says so.
- The fee-wallet private key exists only as a server secret, readable only by
  `src/server/wallet.ts`; nothing moves funds without an explicit workflow.

## Production gate

`AUDIT.md` is the mainnet checklist — key isolation, Pons 3% validation,
signer boundaries, simulation, reconciliation, MCP/prompt-injection trust,
provider failover. **Critical findings block production.** See `SECURITY.md`.
