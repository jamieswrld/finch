import type { Metadata } from "next";
import { FLIGHTPATH_TOOLS, POLICY_RULES } from "@finch/flightpath";
import { PROVIDER_CATALOG } from "@finch/providers";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Docs",
  description: "Finch documentation — quickstart, SDK, Flightpath on Solana, tools, publishing, the hive, user-signed execution, explorer and market tools, $FINCH, security model.",
};

const TOC = [
  { id: "quickstart", label: "Quickstart" },
  { id: "sdk", label: "Finch SDK" },
  { id: "flightpath", label: "Flightpath" },
  { id: "tools", label: "Tool catalog" },
  { id: "providers", label: "Model providers" },
  { id: "compute", label: "Model compute" },
  { id: "data", label: "Data layer" },
  { id: "permissions", label: "Permission model" },
  { id: "deploy", label: "Running a finch" },
  { id: "proof-of-flight", label: "Proof of Flight" },
  { id: "publishing", label: "Publishing" },
  { id: "hive", label: "The hive" },
  { id: "signed-execution", label: "User-signed execution" },
  { id: "explorer", label: "Explorer and market tools" },
  { id: "finch-token", label: "$FINCH" },
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
# SOLANA_RPC_URLS=…          optional locally; the public mainnet RPC is rate limited

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
  "What are the decimals, supply and mint authority of EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v?",
);
console.log(result.output);
console.log(result.steps); // every model + tool step, logged`;

const OPERATOR = `// Operator mode: bounded writes. The key comes from the RUNTIME env —
// it is never part of a manifest and never the fee wallet's key.
import { createFlightpath } from "@finch/flightpath";
import { createFinch, hyperbolic } from "@finch/sdk";

const flightpath = createFlightpath({
  // base58 64-byte secret key, or a JSON array of 64 numbers
  operatorKey: process.env.FLIGHTPATH_OPERATOR_KEY,
});

const nest = await createFinch("payments-runner")
  .model(hyperbolic("Qwen/Qwen3-235B-A22B"))
  .tools("balance_native", "transfer_native")
  .wallet({
    mode: "operator",
    allowances: [{ asset: "native", perDay: "0.1", perTx: "0.02" }], // SOL
    allowedPrograms: [],            // plain transfers need none; program_invoke and swaps do
    allowedRecipients: ["<an address you trust>"],
    approvalThreshold: 0.5,
  })
  .hatch({ flightpath });

// every write: policy → simulate → (approval) → sign → submit → confirm → log`;

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

// Observer Flightpath: real Solana reads, no signer, writes denied.
// Pass operatorKey here — and only here — to grant bounded write authority.
const flightpath = createFlightpath({ agentId: manifest.identity.handle });

const finch = await hatchFromManifest(manifest, {
  provider: hyperbolic(manifest.model.model),   // HYPERBOLIC_API_KEY from env
  flightpath,
});

const result = await finch.run("What is the current slot on Solana, and how busy is the network?");
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
  "version":       "proof-of-flight/0.2",
  "finchId":       "execution-finch",       // which agent acted
  "nestId":        "launch-intelligence",   // set when it came from a nest task
  "taskId":        "t4",
  "action":        "transfer.native",
  "summary":       "transfer 0.01 SOL → <recipient>",
  "chain":         "solana:mainnet",
  "signature":     "5x…",                   // the transaction, base58 — where it happened
  "slot":          "…",
  "feeLamports":   "5000",
  "computeUnits":  "150",
  "policy":        { "verdict": "allow", "rule": "default" },
  "approval":      { "approvedBy": "operator@finch", "at": "…" },   // if a human released it
  "simulation":    { "ok": true, "computeUnits": "150" },
  "confirmedAt":   "2026-09-26T00:00:03.000Z",
  "executionHash": "9f2c…",                 // sha256 over every field above
  "explorerUrl":   "https://solscan.io/tx/5x…"   // convenience only, not hashed
}`;

const KEY_FLOW = `# 1. the wallet signs a plain message (solana:signMessage — not a transaction)
Finch publisher key
Address: <your base58 address>
Nonce: <random, 8-64 url-safe chars>

Signing this issues a key for publishing to the Finch registry. It is not a transaction.

# 2. exchange the signature for a key — shown once, only its hash is stored
POST /api/keys   { "address": "<base58 address>", "nonce": "…", "signature": "<base58, 64 bytes>" }
→ 201 { "key": "finch_…", "owner": "<the same address, exactly>", "scopes": ["aviary:publish", "nests:write"] }

# 3. publish with it
POST /api/aviary   headers: x-finch-key: finch_…
POST /api/nests    headers: x-finch-key: finch_…     # a nest.manifest/0.1
POST /api/finches  headers: x-finch-key: finch_…     # a finch.manifest/0.1`;

const SIGNED_FLOW = `# run a finch that is allowed to write, naming the wallet that will sign
POST /api/school/run   { "preset": "courier-finch", "input": "send 0.01 SOL to <recipient>", "signer": "<your address>" }
→ executions: [{ id: "exec_…", state: "awaiting_signature",
                 intent: { kind: "transfer.native", summary, to, spendAsset: "native", spendAmount, meta },
                 simulation: { ok: true, computeUnits, feeLamports, simulatedAt },
                 prepared: { feePayer: "<your address>", instructions: [{ programAddress, accounts, data }], computeUnits } }]

# fetch the unsigned transaction, with a fresh blockhash
GET /api/executions/exec_…/transaction
→ { id, chain: "solana:mainnet", feePayer, transaction: "<base64 wire bytes>", lastValidBlockHeight }

# the wallet signs and sends it (solana:signAndSendTransaction); hand back the signature
POST /api/executions/exec_…/submitted   { "signature": "<base58>", "from": "<your address>" }
→ the landed transaction is compared to \`prepared\` instruction by instruction:
   fee payer · program · accounts and their roles · data.
   Wallet-added compute-budget and Lighthouse assertions are tolerated; any other difference is refused and nothing advances.
→ match: { id, state: "confirmed" | "reverted", tx: { signature, submittedAt },
           receipt: { status, slot, feeLamports, computeUnits, confirmedAt }, explorerUrl, proof }
   reverted = it landed with an instruction error: the fee was paid, nothing else changed
→ confirmed: a Proof of Flight is issued

# later, exactly as stored
GET /api/executions/exec_…`;

const PROOF_USAGE = `import { buildProofOfFlight, verifyProofOfFlight } from "@finch/flightpath";

// record is the ExecutionRecord returned by any Flightpath write
const proof = await buildProofOfFlight(record, { nestId: "launch-intelligence", taskId: "t4" });

const { valid, expectedHash } = await verifyProofOfFlight(proof);
// valid === false for any edited field`;

const FINCH_READS = `# from a finch — read-only tool
finch_token      # $FINCH as it stands: launched or not, launch phase, supply and authorities, holders, price, markets

# from the site
GET /api/token   # FinchTokenReadout: configured · launched · mint · launchpad · token · price · markets · holders · gate (+ cache, cachedAt)

# from @finch/flightpath
import { getFinchTokenMint, readFinchToken } from "@finch/flightpath";
getFinchTokenMint();                     // FINCH_TOKEN_MINT when set, else the published contract address
const readout = await readFinchToken();  // never throws; launched: false while no mint account exists`;

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
  { name: "SOLANA_CLUSTER", scope: "server", note: "mainnet-beta (the default), devnet or testnet." },
  { name: "SOLANA_RPC_URLS", scope: "server", note: "Comma-separated RPC endpoints, tried in order. The public mainnet endpoint is the fallback and is rate limited — production lists a provider here." },
  { name: "SOLANA_RPC_URL", scope: "server", note: "A single endpoint, when there is only one." },
  { name: "SOLANA_EXPLORER_URL", scope: "server", note: "Explorer used for links; defaults to https://solscan.io." },
  { name: "FLIGHTPATH_FORCE_DEV", scope: "server", note: "Set to 1 to target devnet, labelled as such everywhere, for testing writes with devnet SOL." },
  { name: "FLIGHTPATH_DEV_RPC_URL", scope: "server", note: "Devnet endpoint used with FLIGHTPATH_FORCE_DEV." },
  { name: "NEXT_PUBLIC_SOLANA_CLUSTER", scope: "public", note: "The cluster the browser asks wallets to sign for. Keep it equal to SOLANA_CLUSTER." },
  { name: "NEXT_PUBLIC_SOLANA_EXPLORER_URL", scope: "public", note: "Explorer base URL for links rendered in the browser." },
  { name: "JUPITER_API_URL", scope: "server", note: "Jupiter API base for prices, token records and swap quotes; defaults to https://lite-api.jup.ag." },
  { name: "JUPITER_API_KEY", scope: "server", note: "Optional. Sent as x-api-key for higher rate limits." },
  { name: "FLIGHTPATH_OPERATOR_KEY", scope: "runtime only", note: "Restricted operator keypair (base58 or a 64-number array). Never in the web app, never the fee wallet." },
  { name: "FINCH_FEE_WALLET_ADDRESS", scope: "server", note: "Fee-wallet address, display only." },
  { name: "FINCH_FEE_WALLET_PRIVATE_KEY", scope: "runtime only", note: "Fee-wallet secret key; readable only by src/server/wallet.ts. Never client-side, never logged." },
  { name: "FINCH_TOKEN_MINT", scope: "server", note: "Optional override of $FINCH's published pump.fun mint address (63Gt…pump). Setting it gates nothing — PUBLISH_GATE is the switch." },
  { name: "FINCH_REGISTRY_AUTHORITY", scope: "server", note: "The address whose signed memos are the registry. Until set, listings are reported as not anchored rather than implied verified." },
  { name: "FINCH_REGISTRY_AUTHORITY_KEY", scope: "local only", note: "The authority's secret key, in .env.local for scripts/registry-anchor.mjs. Never on the deployment." },
  { name: "PUBLISH_GATE", scope: "server", note: "open (the default) or hold. hold requires holding PUBLISH_COST_FINCH of $FINCH to publish." },
  { name: "PUBLISH_COST_FINCH", scope: "server", note: "How much $FINCH the hold gate requires." },
  { name: "RWA_APPROVED_ASSETS", scope: "server", note: "JSON array of approved RWA assets for agent interaction; address is the SPL mint." },
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

function C({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[12.5px]">{children}</code>;
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
            Finch is a TypeScript-first monorepo: a Next.js app (this site) and four packages —{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/sdk</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/providers</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/flightpath</code>,{" "}
            <code className="font-mono text-[12.5px] text-green-deep">@finch/db</code>. There is no onchain program to
            build or deploy.
          </P>
          <CodeBlock title="setup" code={QUICKSTART} />
          <P>Then hatch your first finch — observer mode, read-only, safe by default:</P>
          <CodeBlock title="first-flight.ts" code={FIRST_FINCH} />
        </DocSection>

        <DocSection id="sdk" title="Finch SDK">
          <P>
            A finch is a portable manifest — <C>finch.json</C> (<C>finch.manifest/0.1</C>): identity, model, memory,
            tools, permissions, wallet, triggers, budget, deployment, publisher, endpoints, IO schemas. The fluent
            builder and the visual Finch Builder emit the same document, and <C>hatch()</C> resolves it against live
            infrastructure. Manifests cannot widen their own permissions: write tools are stripped unless the wallet
            grants operator mode, RWA interactions are always registry-limited, and simulation is not optional.
          </P>
          <CodeBlock title="hatch a builder-made manifest" code={MANIFEST_RUN} />
          <P>
            Runs return a full trace: <C>output</C>, <C>steps</C>, <C>executions</C> (Flightpath records),{" "}
            <C>usage</C>, and a <C>haltedBy</C> reason — including the kill switch.
          </P>
        </DocSection>

        <DocSection id="flightpath" title="Flightpath — Solana execution">
          <P>
            Flightpath is the Solana execution layer: SOL and SPL balances and transfers, SPL approvals, single
            instructions to allowlisted programs, Jupiter swaps, token, market and portfolio reads, and approved RWA
            interactions. An intent carries the exact instructions it will execute, and the policy engine decodes
            those instructions — not the intent&apos;s summary — before anything else happens. Every write follows
            one path —{" "}
            <span className="font-mono text-[12.5px]">policy → simulate → (approve) → sign → submit → confirm → log</span>{" "}
            — and produces an idempotent ExecutionRecord.
          </P>
          <CodeBlock title="operator mode with allowances" code={OPERATOR} />
          <P>
            Simulation is <C>simulateTransaction</C> against current state; a failure stops the intent there, with the
            program logs that explain it. The signature comes from the operator keypair (<C>FLIGHTPATH_OPERATOR_KEY</C>,
            runtime only) or, on this site, from the visitor&apos;s own wallet — see{" "}
            <a href="#signed-execution" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
              User-signed execution
            </a>
            . A write counts as done only when the network confirms the transaction, and only a confirmed one gets a
            Proof of Flight.
          </P>
          <P>
            Flightpath targets Solana mainnet-beta by default. <C>SOLANA_CLUSTER</C> selects devnet or testnet,{" "}
            <C>SOLANA_RPC_URLS</C> lists provider endpoints tried in order — the public mainnet endpoint is the
            fallback, and it is rate limited — and <C>FLIGHTPATH_FORCE_DEV=1</C> switches to a labelled devnet target
            for testing. Finch deploys no program of its own: the registry is signed memo transactions and $FINCH is
            an ordinary SPL mint — the{" "}
            <a href="#finch-token" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
              $FINCH section
            </a>{" "}
            lists what Flightpath reads for it.
          </P>
        </DocSection>

        <DocSection id="tools" title="Tool catalog">
          <P>
            These are the tools a manifest can name. The table is generated from <C>FLIGHTPATH_TOOLS</C> in{" "}
            <C>@finch/flightpath</C> — the same list the runtime hands to models and the Finch Builder renders — so it
            cannot drift from the code. Reads carry no risk. Writes are simulated first, checked against the wallet
            policy, and logged; a finch in observer mode never sees them.
          </P>
          <div className="overflow-x-auto rounded-xs border border-line">
            <table className="w-full min-w-[680px] border-collapse bg-bone text-left">
              <thead>
                <tr className="border-b border-line bg-bone-raised">
                  <th className="label-mono px-3 py-2 font-normal">tool</th>
                  <th className="label-mono px-3 py-2 font-normal">mode</th>
                  <th className="label-mono px-3 py-2 font-normal">category</th>
                  <th className="label-mono px-3 py-2 font-normal">what it does</th>
                </tr>
              </thead>
              <tbody>
                {FLIGHTPATH_TOOLS.map((tool) => (
                  <tr key={tool.name} className="border-b border-line/50 last:border-b-0 hover:bg-bone-raised">
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-ink">{tool.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={tool.mode === "write" ? "gold" : "green"}>{tool.mode}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-ink-soft">{tool.category}</td>
                    <td className="px-3 py-2.5 text-[12.5px] leading-snug text-grey">{tool.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            listings, execution records, per-signer spend, vector memory, the public treasury ledger, double-entry
            compute credits, service-call metering and hashed API keys. Unique indexes double as idempotency
            guarantees. Without <code className="font-mono text-[12.5px]">MONGODB_URI</code>, the site serves labeled
            seed data read-only; scripts: <code className="font-mono text-[12.5px]">npm run seed -w @finch/db</code>,{" "}
            <code className="font-mono text-[12.5px]">npm run indexes -w @finch/db</code>. MongoDB accelerates the
            product; Solana stays the source of truth.
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
            someone else check the claim: which finch acted, under which policy, in which transaction, in which slot,
            at what fee — plus a SHA-256 over exactly those facts, so the receipt cannot be quietly edited afterwards.
          </P>
          <CodeBlock title="proof-of-flight/0.2" code={PROOF_SHAPE} />
          <P>
            The hash is taken over a canonical form with a fixed field order, so the same execution hashes identically
            on any machine in any language. Signatures are base58 and case-sensitive, so they are hashed exactly as
            given. Change the slot, the summary, the finch id or the approver and{" "}
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
            any Solana wallet that signs a plain message for one. The ed25519 signature proves control of the address;
            the address — exactly as written, since base58 is case-sensitive — becomes the key&apos;s owner; every
            listing published with it belongs to that wallet and can only be changed by it. One active key per wallet —
            signing again replaces the old one.
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
            The token existing changes nothing.
          </P>
          <P>
            Published entries carry <code className="font-mono text-[12.5px]">source: &quot;published&quot;</code>; the
            network&apos;s own analysts carry <code className="font-mono text-[12.5px]">source: &quot;builtin&quot;</code>.
            Either can be composed into a nest by reference —{" "}
            <code className="font-mono text-[12.5px]">{"{ handle, ref: \"registry\" }"}</code> — and is hydrated from
            the registry before the strict manifest schema runs.
          </P>
          <P>
            A listing is <strong className="font-semibold text-ink">anchored</strong> when the registry authority (
            <C>FINCH_REGISTRY_AUTHORITY</C>) has signed a memo transaction naming it:{" "}
            <C>finch-registry/1 register &lt;kind&gt;:&lt;handle&gt; sha256:&lt;manifest hash&gt; [&lt;uri&gt;]</C>.
            The index reads that address&apos;s signature history and counts a memo only if the authority signed it, so
            anyone can check a listing — and the manifest&apos;s hash — against Solana alone. Until the authority is
            configured, <C>GET /api/registry</C> reports every listing as not anchored.
          </P>
        </DocSection>

        <DocSection id="hive" title="The hive">
          <P>
            Every nest that runs teaches a shared memory, and every finch reads from it. The hive is not a chat log:
            it accepts only <strong className="font-semibold text-ink">observations with provenance</strong> — which
            run, which nest, which finch, which channel, and the address the finding is about. A finch recalling a
            prior finding sees it labelled exactly that way,{" "}
            <code className="font-mono text-[12.5px]">[prior finding · launch-intelligence · 3h ago · unverified]</code>,
            so it can build on it without mistaking it for something it verified itself.
          </P>
          <P>
            Only the network&apos;s builtin nests write to the hive today; published nests read from it. The subject
            of a finding is the first address in the objective, so a token due-diligence run and a wallet analysis of
            the same mint meet in the same place.{" "}
            <code className="font-mono text-[12.5px]">GET /api/hive</code> shows what the hive holds, with the
            provenance of every line.
          </P>
        </DocSection>

        <DocSection id="signed-execution" title="User-signed execution">
          <P>
            No key on the server ever signs for a visitor. A finch that is allowed to write —{" "}
            <code className="font-mono text-[12.5px]">wallet.mode: &quot;operator&quot;</code> with allowances — builds
            the instructions with the visitor as fee payer, simulates them, then parks the intent at{" "}
            <code className="font-mono text-[12.5px]">awaiting_signature</code> with the exact{" "}
            <code className="font-mono text-[12.5px]">prepared</code> instructions. The visitor&apos;s own wallet signs
            and sends the transaction. Nothing on this path turns &quot;the API returned 200&quot; into &quot;the
            transaction succeeded&quot;.
          </P>
          <CodeBlock title="the signed path" code={SIGNED_FLOW} />
          <P>
            States: created → simulated → awaiting_signature → submitted → confirmed | reverted, and every transition
            is a compare-and-set, so a double submit cannot double count. The per-transaction cap is enforced when
            the intent is prepared; the daily allowance is kept{" "}
            <strong className="font-semibold text-ink">durably per signer</strong>, so the next intent any instance
            prepares for that wallet sees what it already spent today. Courier Finch is capped at 0.1 SOL per transfer
            and 0.5 SOL per day. A nest whose policy is not read-only takes the same{" "}
            <code className="font-mono text-[12.5px]">signer</code> on{" "}
            <code className="font-mono text-[12.5px]">POST /api/nests/run</code> and surfaces its parked writes next
            to the task that prepared them.
          </P>
        </DocSection>

        <DocSection id="explorer" title="Explorer and market tools">
          <P>
            Alongside plain RPC reads, finches can research. The explorer tools read Solana itself —{" "}
            <C>wallet_profile</C>, <C>wallet_transactions</C>, <C>wallet_holdings</C>, <C>tx_lookup</C>,{" "}
            <C>token_profile</C>, <C>token_holders</C>, <C>token_activity</C>, <C>block_read</C>,{" "}
            <C>chain_stats</C> — with Jupiter filling in USD prices, token records and holder counts.{" "}
            <C>token_activity</C> sees the transactions that reference a mint account; transfers that never touch it
            are not visible there, and the tool&apos;s description says so to the finch.
          </P>
          <P>
            The market tools read Jupiter (<C>token_list</C>, <C>token_price</C>, and <C>swap_quote</C> — a route quote
            only, nothing is signed) and DexScreener (<C>token_markets</C>, <C>market_pair</C>).{" "}
            <C>program_verified</C> reports whether a program can still be upgraded, and by whom, and whether OtterSec
            has verified that its deployed build matches its source. A tool that finds nothing returns nothing; the
            finch is told an empty result is the answer, not a prompt to invent one.
          </P>
        </DocSection>

        <DocSection id="finch-token" title="$FINCH">
          <P>
            $FINCH launches on pump.fun. Its mint address,{" "}
            <code className="font-mono text-[12.5px] break-all text-green-deep">63GtvVxFKgXCcSAXXkrPtp7vk8oWyEfqwwdB8gNYpump</code>,
            is baked into <C>@finch/flightpath</C> as the default; <C>FINCH_TOKEN_MINT</C> overrides it. Until a mint
            account exists at that address, Finch reports $FINCH as not launched — <C>GET /api/token</C> answers{" "}
            <C>launched: false</C>, and the home page and the <C>finch_token</C> tool say the same — rather than showing
            zeros where there is nothing to read.
          </P>
          <P>
            Once live, it trades on pump.fun&apos;s bonding curve and, after graduation, on pump.fun&apos;s AMM. Every
            figure is read live and carries its source: supply, decimals and the mint and freeze authorities from the
            mint account; the launch phase — bonding curve or graduated — and curve progress from pump.fun&apos;s
            bonding-curve account (<C>launchpad</C> on <C>GET /api/token</C>); USD price and holder count from
            Jupiter; markets — DEX, pair, liquidity, 24h volume — from DexScreener. A source that cannot be reached is
            reported as unreachable, never as 0.
          </P>
          <CodeBlock title="reading it" code={FINCH_READS} />
          <P>
            The token gates nothing. Publishing is open and free with{" "}
            <code className="font-mono text-[12.5px]">PUBLISH_GATE</code> unset, and the home page reads that from the
            same switch the API enforces — see{" "}
            <a href="#publishing" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
              Publishing
            </a>
            .
          </P>
        </DocSection>

        <DocSection id="security" title="Security model">
          <P>
            Custody is simple and layered. Agents hold only restricted operator keypairs funded with a small float, so
            the most a compromised operator can lose is what it holds — and the PolicyEngine bounds every intent below
            that: decoded instructions, per-asset allowances and per-transaction caps, program and recipient
            allowlists, human approval thresholds and kill switches. Visitors sign their own transactions in their own
            wallets; no key on the server signs for them. The fee wallet&apos;s key is held by the operator outside
            the deployment — never in the repo, the deployed site, or any agent environment — and nothing moves funds
            automatically. The registry authority&apos;s key stays on the operator&apos;s machine, used by one script
            that sends nothing without <C>--send</C>. Production deployment is gated on the audit checklist in{" "}
            <code className="font-mono text-[12.5px]">AUDIT.md</code> — critical findings block release.
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
                      <Badge tone={row.scope === "public" ? "sage" : row.scope === "server" ? "grey" : "gold"}>{row.scope}</Badge>
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
