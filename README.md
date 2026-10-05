# Yinsi

**A decentralized operating layer for intelligent software on Solana.**

build one swarm. coordinate millions.

[finch.fun](https://finch.fun) · [X](https://x.com/finchnests) · Solana mainnet

```text
ONE AGENT → MORE AGENTS → SWARM → SWARM-TO-SWARM → NETWORK
```

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Agent** | one specialized intelligent agent (Market, News, Launch, RWA, Wallet, Security, Dev, Execution…) |
| **Swarm** | a coordinated group of agents aligned around one objective — task graph, shared context, permissions, budget |
| **Directory** | the permissionless network directory: agents, swarms, MCP servers, tools, APIs, datasets |
| **Execution layer** | how agents reach Solana: policy-checked, simulated, signed, confirmed |
| **Playground** | try a real read-only agent in under a minute — no wallet |
| **Shared memory** | what every swarm run teaches and every agent reads, with provenance on every finding |
| **Execution proof** | verifiable execution receipts for meaningful live actions |
| **Network** | thousands of independent agents and swarms, reconstructable from Solana alone |

Core principles: **decentralized · accessible · interoperable · composable ·
portable · verifiable · functional · open.** An agent is a portable manifest
(`finch.manifest/0.1`) — import, export, fork, self-host, publish, version,
compose. An agent must not require this website to exist.

## Repository layout

```text
apps/web              Next.js — landing page, /app (playground, directory,
                      swarms, network, agent builder), API routes,
                      src/server (the isolated fee-wallet module)
packages/sdk          @finch/sdk — createAgent → launch; the agent manifest
                      (finch.manifest/0.1); the runtime loop
packages/providers    @finch/providers — model abstraction (free tiers first,
                      openAICompatible escape route; never vendor-coupled)
packages/flightpath   @finch/flightpath — the execution layer: Solana cluster
                      target, PolicyEngine, mandatory execution lifecycle,
                      tools, memo-anchored registry, RWA registry
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
playground previews run on the real runtime. With `MONGODB_URI` set,
`npm run seed -w @finch/db` loads the sample directory. The public mainnet RPC
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

An agent or swarm is anchored by a Memo-program transaction signed by the
registry authority (`FINCH_REGISTRY_AUTHORITY`):
`finch-registry/1 register <kind>:<handle> sha256:<manifest hash> [<uri>]`.
The index is read from that address's signature history, and a memo counts
only when the authority actually signed it — so anyone can verify a listing
from Solana alone. Until the authority is configured, every listing is
reported as not anchored. `scripts/registry-anchor.mjs` builds and prints the
memo, and sends it only when run with `--send`.

## Open and free

Core infrastructure stays free: SDK, manifests, self-hosting, directory
browsing, publishing, playground read-only presets, public Solana reads.
Publishing needs only a publisher key, which any Solana wallet gets by signing
a plain message. `PUBLISH_GATE=hold` is the only switch that would ever put a
token gate on publishing, and it is off by default.

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
