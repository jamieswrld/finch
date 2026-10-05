import { CodeBlock } from "@/components/ui/CodeBlock";
import { SectionHeading } from "@/components/ui/SectionHeading";

// The builder's real API, verbatim — its identifiers are the package's own.
const SDK_SAMPLE = `import { createAgent, hyperbolic } from "@finch/sdk";

const agent = await createAgent("market-watcher")
  .describe("Watches a few Solana mints; reports notable changes.")
  .model(hyperbolic("meta-llama/Llama-3.3-70B-Instruct"))
  .memory({ kind: "mongo-vector", namespace: "market-watcher" })
  .tools("token_price", "token_markets", "balance_spl", "portfolio_snapshot")
  .wallet({
    mode: "operator",
    allowances: [{ asset: "native", perDay: "0.25" }], // SOL
    allowedPrograms: [], // no raw program calls
    approvalThreshold: 0.5, // larger spends wait for a human
  })
  .launch();

const result = await agent.run("Summarize portfolio drift since Friday.");`;

const CAPABILITIES = [
  {
    title: "Model",
    body: "Provider-abstracted. Hyperbolic serves compute first; any OpenAI-compatible endpoint drops in. One line to swap.",
  },
  {
    title: "Memory",
    body: "Ephemeral for scratch, MongoDB Atlas vectors for the long haul — namespaced, retained, recalled semantically.",
  },
  {
    title: "Tools",
    body: "The execution layer's Solana tools plus anything published in the directory. Typed schemas, permission-tagged.",
  },
  {
    title: "Wallet permissions",
    body: "Observer or operator. Daily allowances in SOL or any SPL mint, per-tx caps, program allowlists, human-approval thresholds. Deny by default.",
  },
];

export function SdkSection() {
  return (
    <section className="container-page py-20" id="sdk">
      <SectionHeading
        index="04"
        kicker="SDK"
        title="Create an agent the way you'd describe one."
        lede="TypeScript-first. An agent is a portable JSON manifest — the SDK and the visual agent builder emit the same document, so anything you build can be exported, forked and self-hosted."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <CodeBlock title="agent.ts — the whole idea" code={SDK_SAMPLE} />
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <div key={capability.title} className="bg-bone-raised p-5">
              <dt className="label-mono text-ink">{capability.title}</dt>
              <dd className="mt-2 text-[13px] leading-relaxed text-ink-soft">{capability.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
