import { CodeBlock } from "@/components/ui/CodeBlock";
import { SectionHeading } from "@/components/ui/SectionHeading";

const SDK_SAMPLE = `import { createFinch, hyperbolic } from "@finch/sdk";

const nest = await createFinch("market-watcher")
  .describe("Watches a token list; reports notable changes.")
  .model(hyperbolic("meta-llama/Llama-3.3-70B-Instruct"))
  .memory({ kind: "mongo-vector", namespace: "market-watcher" })
  .tools("balance_erc20", "token_data", "portfolio_snapshot")
  .wallet({
    mode: "operator",
    allowances: [{ asset: "native", perDay: "0.25" }],
    approvalThreshold: 0.5, // larger spends wait for a human
  })
  .hatch();

const result = await nest.run("Summarize portfolio drift since Friday.");`;

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
    body: "Flightpath onchain tools plus anything published in the Aviary. Typed schemas, permission-tagged.",
  },
  {
    title: "Wallet permissions",
    body: "Observer or operator. Daily allowances, per-tx caps, contract allowlists, human-approval thresholds. Deny by default.",
  },
];

export function SdkSection() {
  return (
    <section className="container-page py-20" id="sdk">
      <SectionHeading
        index="06"
        kicker="Finch SDK"
        title="Create a finch the way you'd describe one."
        lede="TypeScript-first, because Robinhood Chain is EVM. A finch is a portable finch.json manifest — the SDK and the visual Finch Builder emit the same document, so anything you build can be exported, forked and self-hosted."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <CodeBlock title="hatch.ts — the whole idea" code={SDK_SAMPLE} />
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
