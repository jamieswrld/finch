import type { Metadata } from "next";
import { POLICY_RULES } from "@finch/flightpath";
import { PROVIDER_CATALOG } from "@finch/providers";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Docs",
  description: "Finch documentation — quickstart, SDK, Flightpath, publishing, the hive, user-signed execution, explorer tools, security model.",
};

const TOC = [
  { id: "quickstart", label: "Quickstart" },
  { id: "sdk", label: "Finch SDK" },
  { id: "flightpath", label: "Flightpath" },
  { id: "providers", label: "Model providers" },
  { id: "compute", label: "Model compute" },
  { id: "data", label: "Data layer" },
  { id: "permissions", label: "Permission model" },
  { id: "deploy", label: "Running a finch" },
  { id: "proof-of-flight", label: "Proof of Flight" },
  { id: "publishing", label: "Publishing" },
  { id: "hive", label: "The hive" },
  { id: "signed-execution", label: "User-signed execution" },
  { id: "explorer", label: "Explorer tools" },
  { id: "security", label: "Security model" },
  { id: "env", label: "Environment" },
  { id: "contributing", label: "Contributing" },
];

const QUICKSTART = `# in the monorepo root
npm install

# server-side environment (never client-side)
# GROQ_API_KEY=…             model compute (free tier); OPENROUTER_API_KEY=… also free
# HYPERBOLIC_API_KEY=…       paid alternative, used only when no free provider is set
# MONGODB_URI=…              optional: registry + memory + ledgers

npm run dev        # web app on http://localhost:3000
npm run typecheck  # all workspaces`;

const FIRST_FINCH = `import { createFinch, hyperbolic } from "@finch/sdk";

const nest = await createFinch("first-flight")
  .describe("Reads balances and reports. Nothing more.")
  .model(hyperbolic("meta-llama/Llama-3.3-70B-Instruct"))
  .memory({ kind: "ephemeral" })
  .tools("balance_native", "token_data")
  .wallet({ mode: "observer" }) // read-only — the safe default
  .hatch();

const result = await nest.run(
  "What is the native balance of 0x000000000000000000000000000000000000dEaD?",
);
console.log(result.output);
console.log(result.steps); // every model + tool step, logged`;

const OPERATOR = `// Operator mode: bounded writes. The key comes from the RUNTIME env —
// it is never part of a manifest and never the treasury key.
import { createFlightpath } from "@finch/flightpath";
import { createFinch, hyperbolic } from "@finch/sdk";

const flightpath = createFlightpath({
  operatorKey: process.env.FLIGHTPATH_OPERATOR_KEY as \`0x\${string}\`,
});

const nest = await createFinch("payments-runner")
  .model(hyperbolic("Qwen/Qwen3-235B-A22B"))
  .tools("balance_native", "transfer_native")
  .wallet({
    mode: "operator",
    allowances: [{ asset: "native", perDay: "0.1", perTx: "0.02" }],
    allowedRecipients: ["0xRecipientYouTrust00000000000000000000000"],
    approvalThreshold: 0.5,
  })
  .hatch({ flightpath });

// every write: policy → simulate → (approval) → submit → confirm → log`;

const MANIFEST_RUN = `// Hatch a manifest built in the visual Nest Builder (/app/build):
import manifest from "./market-watcher.manifest.json";
import { hatchFromManifest, hyperbolic } from "@finch/sdk";

const nest = await hatchFromManifest(manifest, {
  provider: hyperbolic(manifest.model.model),
});`;

const SELF_HOST = `// node --experimental-strip-types run-finch.ts
import { readFileSync } from "node:fs";
import { hatchFromManifest, hyperbolic } from "@finch/sdk";
import { createFlightpath } from "@finch/flightpath";

const manifest = JSON.parse(readFileSync("./market-scout.finch.json", "utf8"));

// Observer Flightpath: real Robinhood Chain reads, no signer, writes denied.
// Pass operatorKey here — and only here — to grant bounded write authority.
const flightpath = createFlightpath({ agentId: manifest.identity.handle });

const finch = await hatchFromManifest(manifest, {
  provider: hyperbolic(manifest.model.model),   // HYPERBOLIC_API_KEY from env
  flightpath,
});

const result = await finch.run("What is the head block on Robinhood Chain?");
console.log(result.output);
console.log(result.steps);            // every model + tool step
console.log(result.usage);            // tokens in / out
console.log(finch.unresolvedServices); // services the manifest declared but nothing resolved`;

const TRIGGER_HOST = `// Finch records triggers; your host acts on them.
for (const trigger of manifest.triggers) {
  if (trigger.kind === "cron") {
    schedule(trigger.schedule, () => finch.run("scheduled tick"));
  }
  if (trigger.kind === "webhook") {
    app.post(\`/hooks/\${trigger.slug}\`, async (req, res) => {
      res.json(await finch.run(JSON.stringify(req.body)));
    });
  }
}`;

const PROOF_SHAPE = `{
  "version":     "proof-of-flight/0.1",
  "finchId":     "execution-finch",       // which agent acted
  "nestId":      "pons-intelligence",     // set when it came from a nest task
  "taskId":      "t4",
  "action":      "transfer.native",
  "summary":     "transfer 0.01 ETH → 0x…",
  "chainId":     4663,
  "txHash":      "0x…",                   // where it happened
  "blockNumber": "53000000",
  "gasUsed":     "21000",
  "policy":      { "verdict": "allow", "rule": "default" },
  "approval":    { "approvedBy": "operator@finch", "at": "…" },   // if a human released it
  "simulation":  { "ok": true, "gasEstimate": "21000" },
  "confirmedAt": "2026-09-03T00:00:03.000Z",
  "executionHash": "9f2c…"                // sha256 over every field above
}`;

const KEY_FLOW = `# 1. the wallet signs a plain message (not a transaction)
Finch publisher key
Address: 0xYourAddress
Nonce: <random, 8-64 url-safe chars>

Signing this issues a key for publishing to the Finch registry. It is not a transaction.

# 2. exchange the signature for a key — shown once, only its hash is stored
POST /api/keys   { "address": "0x…", "nonce": "…", "signature": "0x…" }
→ 201 { "key": "finch_…", "owner": "0x…", "scopes": ["aviary:publish", "nests:write"] }

# 3. publish with it
POST /api/aviary   headers: x-finch-key: finch_…
POST /api/nests    headers: x-finch-key: finch_…     # a nest.manifest/0.1
POST /api/finches  headers: x-finch-key: finch_…     # a finch.manifest/0.1`;

const SIGNED_FLOW = `# run a finch that is allowed to write, naming the wallet that will sign
POST /api/school/run   { "preset": "courier-finch", "prompt": "send 0.001 ETH to 0x…", "signer": "0xYourAddress" }
→ executions: [{ id: "exec_…", state: "awaiting_signature",
                 prepared: { from, to, value, data, gas } }]

# the wallet signs exactly \`prepared\`; hand back the hash
POST /api/executions/exec_…/submitted   { "hash": "0x…", "from": "0xYourAddress" }
→ the chain's transaction at that hash is compared to \`prepared\` field by field:
   to · value · data · from.  Any difference → 422, nothing advances.
→ match: state submitted → confirmed | reverted, with the receipt
→ confirmed: a Proof of Flight is issued

# later, exactly as stored (and self-healing if the receipt arrived late)
GET /api/executions/exec_…`;

const PROOF_USAGE = `import { buildProofOfFlight, verifyProofOfFlight } from "@finch/flightpath";

// record is the ExecutionRecord returned by any Flightpath write
const proof = await buildProofOfFlight(record, { nestId: "pons-intelligence", taskId: "t4" });

const { valid, expectedHash } = await verifyProofOfFlight(proof);
// valid === false for any edited field`;

const ENV_ROWS: Array<{ name: string; scope: string; note: string }> = [
  { name: "GROQ_API_KEY", scope: "server", note: "Free-tier inference. Any one compute key enables previews and nest runs." },
  { name: "CEREBRAS_API_KEY", scope: "server", note: "Free-tier alternative; fastest throughput of the hosted options." },
  { name: "OPENROUTER_API_KEY", scope: "server", note: "Free-tier alternative; :free model variants cost nothing." },
  { name: "GEMINI_API_KEY", scope: "server", note: "Free-tier alternative via the OpenAI-compatible endpoint." },
  { name: "ENABLE_OLLAMA", scope: "server", note: "Run inference locally with Ollama — no key, no quota, no per-request cost." },
  { name: "FINCH_PROVIDER", scope: "server", note: "Force one provider by id. Otherwise Finch prefers free tiers automatically." },
  { name: "HYPERBOLIC_API_KEY", scope: "server", note: "Paid provider. Used only when no free-tier provider is configured." },
  { name: "MONGODB_URI", scope: "server", note: "Least-privilege user, readWrite on the finch db only. Optional — seed fallback without it." },
  { name: "MONGODB_DB", scope: "server", note: "Database name; defaults to finch." },
  { name: "NEXT_PUBLIC_ROBINHOOD_CHAIN_ID", scope: "public", note: "Override only — defaults to 4663, the live Robinhood Chain mainnet id." },
  { name: "NEXT_PUBLIC_ROBINHOOD_RPC_URL", scope: "public", note: "Override only — the mainnet RPC is baked in. Set ROBINHOOD_RPC_URLS for failover endpoints." },
  { name: "NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL", scope: "public", note: "Block explorer base URL." },
  { name: "FLIGHTPATH_OPERATOR_KEY", scope: "runtime only", note: "Restricted operator wallet key. Never in the web app, never the treasury." },
  { name: "FINCH_FEE_WALLET_ADDRESS", scope: "server", note: "Creator-fee recipient address for the $FINCH Pons launch (3% creator tax)." },
  { name: "FINCH_FEE_WALLET_PRIVATE_KEY", scope: "runtime only", note: "Fee-wallet key; readable only by src/server/wallet.ts. Never client-side, never logged." },
  { name: "FINCH_REGISTRY_ADDRESS", scope: "server", note: "FinchRegistry contract. Until set, listings are reported unregistered rather than implied verified." },
  { name: "FINCH_FEE_VAULT_ADDRESS", scope: "server", note: "FeeVault address — the Pons creator-fee recipient." },
  { name: "FINCH_OPERATOR_BUDGET_ADDRESS", scope: "server", note: "OperatorBudget contract address." },
  { name: "PONS_FACTORY_ADDRESS", scope: "server", note: "Pons contract for the fee indexer, once published." },
  { name: "RWA_APPROVED_ASSETS", scope: "server", note: "JSON array of approved RWA assets for agent interaction." },
];

function DocSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl text-[14px] leading-relaxed text-ink-soft">{children}</p>;
}

export default function DocsPage() {
  return (
    <div className="container-page grid grid-cols-1 gap-12 py-12 md:py-16 lg:grid-cols-[200px_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="label-mono">documentation</p>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0 lg:pb-0" aria-label="Docs sections">
          {TOC.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="shrink-0 rounded-xs border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-soft hover:text-green-deep lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-b-line/60 lg:py-2"
            >
              {entry.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-12">
        <DocSection id="quickstart" title="Quickstart">
          <P>
            Finch is a TypeScript-first monorepo: a Next.js app (this site), four packages —{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/sdk</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/providers</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/flightpath</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/db</code> — and Foundry contracts.
          </P>
          <CodeBlock title="setup" code={QUICKSTART} />
          <P>Then hatch your first finch — observer mode, read-only, safe by default:</P>
          <CodeBlock title="first-flight.ts" code={FIRST_FINCH} />
        </DocSection>

        <DocSection id="sdk" title="Finch SDK">
          <P>
            A finch is a portable manifest — <code className="font-mono text-[12.5px]">finch.json</code>{" "}
            (<code className="font-mono text-[12.5px]">finch.manifest/0.1</code>): identity, model, memory, tools,
            permissions, wallet, triggers, budget, deployment, publisher, endpoints, IO schemas. The fluent builder and
            the visual Finch Builder emit the same document, and{" "}
            <code className="font-mono text-[12.5px]">hatch()</code> resolves it against live infrastructure. Manifests
            cannot widen their own permissions: write tools are stripped unless the wallet grants operator mode, RWA
            interactions are always registry-limited, and simulation is not optional.
          </P>
          <CodeBlock title="hatch a builder-made manifest" code={MANIFEST_RUN} />
          <P>
            Runs return a full trace: <code className="font-mono text-[12.5px]">output</code>,{" "}
            <code className="font-mono text-[12.5px]">steps</code>,{" "}
            <code className="font-mono text-[12.5px]">executions</code> (Flightpath records),{" "}
            <code className="font-mono text-[12.5px]">usage</code>, and a{" "}
            <code className="font-mono text-[12.5px]">haltedBy</code> reason — including the kill switch.
          </P>
        </DocSection>

        <DocSection id="flightpath" title="Flightpath — Robinhood Chain execution">
          <P>
            Flightpath is the EVM execution layer: balances, transfers, ERC20s, contract reads/writes, swaps, Pons fee
            accounting, token and portfolio data, and approved RWA interactions. Every write follows one path —{" "}
            <span className="font-mono text-[12.5px]">policy → simulate → (approve) → submit → confirm → log</span> —
            and produces an idempotent ExecutionRecord.
          </P>
          <CodeBlock title="operator mode with allowances" code={OPERATOR} />
          <P>
            Flightpath targets Robinhood Chain mainnet by default: chain 4663, an Arbitrum Nitro L2 with ETH as its
            native currency, reached over{" "}
            <code className="font-mono text-[12.5px]">rpc.mainnet.chain.robinhood.com</code> with a Blockscout
            explorer — all baked into <code className="font-mono text-[12.5px]">@finch/flightpath</code>. The{" "}
            <code className="font-mono text-[12.5px]">NEXT_PUBLIC_ROBINHOOD_*</code> and{" "}
            <code className="font-mono text-[12.5px]">ROBINHOOD_RPC_URLS</code> variables are overrides for dedicated
            providers; <code className="font-mono text-[12.5px]">FLIGHTPATH_FORCE_DEV=1</code> switches to a labelled
            dev chain for fork testing. What is genuinely pending is Pons (contracts and ABI unpublished) and $FINCH
            itself.
          </P>
        </DocSection>

        <DocSection id="providers" title="Model providers">
          <P>
            The model layer is a provider abstraction. Hyperbolic serves compute first (
            <code className="font-mono text-[12.5px]">hyperbolic(model)</code>), and{" "}
            <code className="font-mono text-[12.5px]">openAICompatible(&#123;…&#125;)</code> binds any standard
            endpoint — Finch is never permanently coupled to one vendor. Providers are server-side only; keys never
            reach a browser or an agent's own context.
          </P>
        </DocSection>

        <DocSection id="compute" title="Model compute — free by default">
          <P>
            A finch names a model; the environment decides who serves it. Every provider below speaks the same
            OpenAI-compatible shape, so switching is configuration rather than an integration — which is the point of
            keeping the model layer abstract.
          </P>
          <div className="overflow-x-auto rounded-xs border border-line">
            <table className="w-full min-w-[640px] border-collapse bg-bone text-left">
              <thead>
                <tr className="border-b border-line bg-bone-raised">
                  <th className="label-mono px-3 py-2 font-normal">provider</th>
                  <th className="label-mono px-3 py-2 font-normal">cost</th>
                  <th className="label-mono px-3 py-2 font-normal">env</th>
                  <th className="label-mono px-3 py-2 font-normal">notes</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDER_CATALOG.map((spec) => (
                  <tr key={spec.id} className="border-b border-line/50 last:border-b-0 hover:bg-bone-raised">
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink">{spec.label}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={spec.cost === "paid" ? "gold" : spec.cost === "local" ? "sage" : "green"}>
                        {spec.cost}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-ink-soft">{spec.envKey ?? "ENABLE_OLLAMA"}</td>
                    <td className="px-3 py-2.5 text-[12.5px] leading-snug text-grey">{spec.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            Selection prefers <strong className="font-semibold text-ink">free tiers first</strong>, then local, then
            paid — so an operator who sets only <code className="font-mono text-[12.5px]">GROQ_API_KEY</code> gets
            working previews at no per-visitor cost. <code className="font-mono text-[12.5px]">FINCH_PROVIDER</code>{" "}
            overrides the order. The app header shows which provider is actually serving, and with none configured
            previews refuse rather than fabricate a response.
          </P>
          <P>
            Model ids are env-overridable (<code className="font-mono text-[12.5px]">GROQ_MODEL</code>,{" "}
            <code className="font-mono text-[12.5px]">OLLAMA_MODEL</code>, …) because provider catalogs change faster
            than this page does — treat the defaults as a starting point, not a guarantee.
          </P>
        </DocSection>

        <DocSection id="data" title="Data layer — MongoDB">
          <P>
            <code className="font-mono text-[12.5px]">@finch/db</code> owns operational data: finches, nests, Aviary
            listings, execution records, vector memory, Pons fee events, the public treasury ledger, double-entry
            compute credits, service-call metering and hashed API keys. Unique indexes double as idempotency
            guarantees. Without <code className="font-mono text-[12.5px]">MONGODB_URI</code>, the site serves labeled
            seed data read-only; scripts: <code className="font-mono text-[12.5px]">npm run seed -w @finch/db</code>,{" "}
            <code className="font-mono text-[12.5px]">npm run indexes -w @finch/db</code>.
          </P>
        </DocSection>

        <DocSection id="permissions" title="Permission model">
          <P>
            Every write an agent attempts is evaluated against these rules, in this order, before anything is
            simulated or signed. The table is generated from{" "}
            <code className="font-mono text-[12.5px]">POLICY_RULES</code> in{" "}
            <code className="font-mono text-[12.5px]">@finch/flightpath</code>, and a test asserts that every rule the
            engine can actually emit appears here — so this cannot drift away from the code.
          </P>
          <div className="overflow-x-auto rounded-xs border border-line">
            <table className="w-full min-w-[680px] border-collapse bg-bone text-left">
              <thead>
                <tr className="border-b border-line bg-bone-raised">
                  <th className="label-mono px-3 py-2 font-normal">rule</th>
                  <th className="label-mono px-3 py-2 font-normal">verdict</th>
                  <th className="label-mono px-3 py-2 font-normal">triggers when</th>
                  <th className="label-mono px-3 py-2 font-normal">why</th>
                </tr>
              </thead>
              <tbody>
                {POLICY_RULES.map((rule) => (
                  <tr key={rule.id} className="border-b border-line/50 last:border-b-0 hover:bg-bone-raised">
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink">{rule.id}</td>
                    <td className="px-3 py-2.5">
                      <Badge
                        tone={rule.verdict === "deny" ? "red" : rule.verdict === "needs_approval" ? "gold" : "green"}
                      >
                        {rule.verdict}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] leading-snug text-ink-soft">{rule.when}</td>
                    <td className="px-3 py-2.5 text-[12.5px] leading-snug text-grey">{rule.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            Two of these cannot be configured away. RWA interactions are always gated to the approved registry, and
            simulation always runs before signing — a manifest has no field that disables either.
          </P>
        </DocSection>

        <DocSection id="deploy" title="Running a finch yourself">
          <P>
            A hatched manifest does not run on Finch — it runs wherever you point a runtime at it. That is the whole
            portability claim, so here is the entrypoint, in full.
          </P>
          <CodeBlock title="run-finch.ts — the entire host" code={SELF_HOST} />
          <P>
            Today the packages are consumed from the repo rather than from npm: clone it, or vendor{" "}
            <code className="font-mono text-[12.5px]">packages/sdk</code>,{" "}
            <code className="font-mono text-[12.5px]">packages/providers</code> and{" "}
            <code className="font-mono text-[12.5px]">packages/flightpath</code> into your project. They contain no
            TypeScript that needs compiling away — parameter properties and decorators are deliberately avoided — so{" "}
            <code className="font-mono text-[12.5px]">node --experimental-strip-types</code> runs them straight from
            source with no build step. Published npm packages are the next step, not a claim we are making now.
          </P>
          <P>
            <strong className="font-semibold text-ink">Triggers.</strong> A manifest can declare cron and webhook
            triggers, and they travel with it — but Finch does not schedule or receive them. Your host does: read{" "}
            <code className="font-mono text-[12.5px]">manifest.triggers</code> and wire them to your own scheduler or
            route handler. Manual is the only trigger this product acts on.
          </P>
          <CodeBlock title="acting on a declared trigger" code={TRIGGER_HOST} />
        </DocSection>

        <DocSection id="proof-of-flight" title="Proof of Flight">
          <P>
            An operator can claim anything about what their agent did. A{" "}
            <strong className="font-semibold text-ink">Proof of Flight</strong> is the smallest set of facts that lets
            someone else check the claim: which finch acted, under which policy, in which transaction, in which block —
            plus a SHA-256 over exactly those facts, so the receipt cannot be quietly edited afterwards.
          </P>
          <CodeBlock title="proof-of-flight/0.1" code={PROOF_SHAPE} />
          <P>
            The hash is taken over a canonical form with a fixed field order, so the same execution hashes identically
            on any machine in any language. Change the block number, the summary, the finch id or the approver and{" "}
            <code className="font-mono text-[12.5px]">verifyProofOfFlight()</code> fails.
          </P>
          <P>
            A proof is issued <strong className="font-semibold text-ink">only for an execution that actually
            confirmed</strong>. Pending, denied, reverted, or never-simulated actions throw{" "}
            <code className="font-mono text-[12.5px]">ProofUnavailableError</code> rather than producing a weaker
            receipt — that refusal is the whole point, since a proof of flight means the flight happened.
          </P>
          <CodeBlock title="issuing and checking one" code={PROOF_USAGE} />
          <P>
            Model traces and tool logs stay in the execution record offchain; only the 32-byte hash needs anchoring.
            The network page counts proofs by counting confirmed executions, which is exactly the set for which a proof
            can be issued.
          </P>
        </DocSection>

        <DocSection id="publishing" title="Publishing — open and free">
          <P>
            Anyone can put a finch or a nest in the registry. There is no charge and no token to hold; the only
            requirement is a <strong className="font-semibold text-ink">publisher key</strong>, and a key is issued to
            any wallet that signs a plain message for one. The signature proves control of the address; the address
            becomes the key&apos;s owner; every listing published with it belongs to that wallet and can only be
            changed by it. One active key per wallet — signing again replaces the old one.
          </P>
          <CodeBlock title="getting a key and publishing" code={KEY_FLOW} />
          <P>
            The gate is a switch, not an inference.{" "}
            <code className="font-mono text-[12.5px]">PUBLISH_GATE</code> unset or{" "}
            <code className="font-mono text-[12.5px]">open</code> is the default and the truth right now.{" "}
            <code className="font-mono text-[12.5px]">hold</code> turns on a $FINCH gate — a publisher must then hold at
            least <code className="font-mono text-[12.5px]">PUBLISH_COST_FINCH</code> of the token, read live at
            publish time — and the publish panel and{" "}
            <code className="font-mono text-[12.5px]">GET /api/publish/status</code> say so the moment it is on.
            Setting a token address alone changes nothing.
          </P>
          <P>
            Published entries carry <code className="font-mono text-[12.5px]">source: &quot;published&quot;</code>; the
            network&apos;s own analysts carry <code className="font-mono text-[12.5px]">source: &quot;builtin&quot;</code>.
            Either can be composed into a nest by reference —{" "}
            <code className="font-mono text-[12.5px]">{"{ handle, ref: \"registry\" }"}</code> — and is hydrated from
            the registry before the strict manifest schema runs.
          </P>
        </DocSection>

        <DocSection id="hive" title="The hive">
          <P>
            Every nest that runs teaches a shared memory, and every finch reads from it. The hive is not a chat log:
            it accepts only <strong className="font-semibold text-ink">observations with provenance</strong> — which
            run, which nest, which finch, which channel, and the address the finding is about. A finch recalling a
            prior finding sees it labelled exactly that way,{" "}
            <code className="font-mono text-[12.5px]">[prior finding · pons-intelligence · 3h ago · unverified]</code>,
            so it can build on it without mistaking it for something it verified itself.
          </P>
          <P>
            Only the network&apos;s builtin nests write to the hive today; published nests read from it. The subject
            of a finding is the first address in the objective, so a token due-diligence run and a wallet analysis of
            the same contract meet in the same place.{" "}
            <code className="font-mono text-[12.5px]">GET /api/hive</code> shows what the hive holds, with the
            provenance of every line.
          </P>
        </DocSection>

        <DocSection id="signed-execution" title="User-signed execution">
          <P>
            No key on the server ever signs for a visitor. A finch that is allowed to write —{" "}
            <code className="font-mono text-[12.5px]">wallet.mode: &quot;operator&quot;</code> with allowances — plans
            and simulates the transaction, then parks it at{" "}
            <code className="font-mono text-[12.5px]">awaiting_signature</code> with the exact{" "}
            <code className="font-mono text-[12.5px]">prepared</code> fields. The visitor&apos;s own wallet signs it.
            Nothing on this path turns &quot;the API returned 200&quot; into &quot;the transaction succeeded&quot;.
          </P>
          <CodeBlock title="the signed path" code={SIGNED_FLOW} />
          <P>
            States: created → simulated → awaiting_signature → submitted → confirmed | reverted, and every transition
            is a compare-and-set, so a double submit cannot double count. The per-transaction cap is enforced when
            the intent is prepared; the daily allowance is kept{" "}
            <strong className="font-semibold text-ink">durably per signer</strong>, so the next intent any instance
            prepares for that wallet sees what it already spent today. A nest whose policy is not read-only takes the
            same <code className="font-mono text-[12.5px]">signer</code> on{" "}
            <code className="font-mono text-[12.5px]">POST /api/nests/run</code> and surfaces its parked writes next
            to the task that prepared them.
          </P>
        </DocSection>

        <DocSection id="explorer" title="Explorer tools">
          <P>
            Alongside RPC reads, finches have the block explorer. Ten tools read Blockscout&apos;s v2 API for Robinhood
            Chain — chain stats, wallet profiles, transactions and holdings, token profiles, holders, transfers and the
            token list, single transactions, and contract verification — plus{" "}
            <code className="font-mono text-[12.5px]">token_pools</code> and{" "}
            <code className="font-mono text-[12.5px]">pool_state</code>, which find a token&apos;s liquidity pools and
            read a V3 pool&apos;s liquidity, price and balances straight from the contract. A tool that finds nothing
            returns nothing; the finch is told an empty result is the answer, not a prompt to invent one.
          </P>
          <P>
            Finch&apos;s own contracts are verified on the explorer, so anyone can read the source that is actually
            deployed: FinchRegistry <code className="font-mono text-[12.5px]">0x4211…Fb6C</code>, OperatorBudget{" "}
            <code className="font-mono text-[12.5px]">0xF61A…01F3</code>, FeeVault{" "}
            <code className="font-mono text-[12.5px]">0x20f5…D165</code>, FeeSplitter{" "}
            <code className="font-mono text-[12.5px]">0x5819…dB34</code>.
          </P>
        </DocSection>

        <DocSection id="security" title="Security model">
          <P>
            Custody is simple and layered: the 3% Pons creator tax is claimed into the FeeVault, whose only possible
            destination is the flat Finch treasury wallet (its key held offline, never in any Finch system). The
            treasury funds a bounded float in <code className="font-mono text-[12.5px]">OperatorBudget</code>, which
            enforces per-operator, per-token, per-epoch allowances onchain. Agents hold only restricted operator
            wallets, and the offchain PolicyEngine mirrors the same limits with recipient/contract allowlists, per-tx
            caps, human approval thresholds and kill switches. Production deployment is gated on the audit checklist
            in <code className="font-mono text-[12.5px]">AUDIT.md</code> — critical findings block release.
          </P>
        </DocSection>

        <DocSection id="env" title="Environment reference">
          <div className="overflow-x-auto rounded-xs border border-line">
            <table className="w-full min-w-[640px] border-collapse bg-bone text-left">
              <thead>
                <tr className="border-b border-line bg-bone-raised">
                  <th className="label-mono px-3 py-2 font-normal">variable</th>
                  <th className="label-mono px-3 py-2 font-normal">scope</th>
                  <th className="label-mono px-3 py-2 font-normal">purpose</th>
                </tr>
              </thead>
              <tbody>
                {ENV_ROWS.map((row) => (
                  <tr key={row.name} className="border-b border-line/50 last:border-b-0 hover:bg-bone-raised">
                    <td className="px-3 py-2 font-mono text-[11.5px] text-ink">{row.name}</td>
                    <td className="px-3 py-2">
                      <Badge tone={row.scope === "public" ? "sage" : row.scope === "runtime only" ? "gold" : "grey"}>{row.scope}</Badge>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] leading-snug text-ink-soft">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>

        <DocSection id="contributing" title="Contributing">
          <P>
            Protocol-level changes go through Finch Improvement Proposals — one page: motivation, specification,
            security considerations. See the current set and the process on the{" "}
            <a href="/research#fips" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
              research page
            </a>
            . Code contributions follow the repository README; the audit checklist applies to anything touching
            signers, fees, or permissions.
          </P>
        </DocSection>
      </div>
    </div>
  );
}
