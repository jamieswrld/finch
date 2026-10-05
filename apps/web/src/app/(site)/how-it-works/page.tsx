import type { Metadata } from "next";
import Link from "next/link";
import {
  AgentLoopDiagram,
  ExecutionLifecycleDiagram,
  PermissionDiagram,
  RegistryDiagram,
  SwarmSchedulerDiagram,
} from "@/components/explain/diagrams";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The actual mechanism: what an agent is, how a swarm coordinates a task graph, how the execution layer reaches Solana, and what an agent is allowed to touch.",
};

const SECTIONS = [
  { id: "unit", label: "The unit" },
  { id: "coordination", label: "Coordination" },
  { id: "execution", label: "Execution" },
  { id: "authority", label: "Authority" },
  { id: "identity", label: "Identity" },
  { id: "economics", label: "Economics" },
  { id: "honesty", label: "Honest state" },
];

function Section({
  id,
  index,
  kicker,
  title,
  children,
}: {
  id: string;
  index: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-12 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        <span className="label-mono text-green-deep">{index}</span>
        <span className="label-mono">{kicker}</span>
      </div>
      <h2 className="mt-5 max-w-2xl text-[26px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink md:text-[32px]">
        {title}
      </h2>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">{children}</p>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[13px] text-green-deep">{children}</code>;
}

/** Definition rows — the mechanism stated as facts, not prose. */
function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-2">
      {rows.map(([term, definition]) => (
        <div key={term} className="bg-bone-raised p-4">
          <dt className="font-mono text-[11px] text-ink">{term}</dt>
          <dd className="mt-1.5 text-[12.5px] leading-relaxed text-grey">{definition}</dd>
        </div>
      ))}
    </dl>
  );
}

const AGENT_JSON = `{
  "schema": "finch.manifest/0.1",
  "identity": { "name": "Network Scout", "handle": "network-scout",
                "instructions": "Report live chain figures…" },
  "model":    { "provider": "hyperbolic", "model": "meta-llama/Llama-3.3-70B-Instruct" },
  "memory":   { "kind": "none" },
  "tools":    { "flightpath": ["network_status"], "services": [] },
  "permissions": { "allowWrites": false, "rwaApprovedOnly": true },
  "wallet":   { "mode": "observer", "allowances": [], "allowedPrograms": [] },
  "budget":   { "maxToolStepsPerRun": 6, "killSwitch": { "maxConsecutiveFailures": 3 } },
  "supportedChains": ["solana:mainnet"]
}`;

const SWARM_JSON = `{
  "schema": "nest.manifest/0.1",
  "identity": { "id": "chain-intelligence",
                "objective": "Assess the current state and health of Solana, and explain what it means for agents executing there." },
  "coordinator": { "model": {…}, "synthesize": true },
  "finches": [ { "handle": "network-scout", "manifest": { …a full agent manifest… } }, … ],
  "tasks": [
    { "id": "t1", "finch": "network-scout", "dependsOn": [],
      "instruction": "Report the current live status of Solana.",
      "outputChannel": "chain.status" },
    { "id": "t4", "finch": "risk-agent", "dependsOn": ["t2", "t3"],
      "instruction": "Network status:\\n{{chain.status}}\\n\\nBlock profile:\\n{{block.profile}}…",
      "outputChannel": "risk.assessment" }
  ],
  "executionPolicy": { "mode": "preview", "maxParallel": 3, "maxTaskFailures": 2 }
}`;

export default function HowItWorksPage() {
  return (
    <div className="container-page grid grid-cols-1 gap-12 py-12 md:py-16 lg:grid-cols-[190px_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="label-mono">mechanism</p>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0 lg:pb-0" aria-label="Sections">
          {SECTIONS.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="shrink-0 rounded-xs border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-soft transition-colors hover:text-green-deep lg:rounded-none lg:border-x-0 lg:border-t-0 lg:border-b-line/60 lg:py-2"
            >
              {entry.label}
            </a>
          ))}
        </nav>
        <div className="mt-5 hidden lg:block">
          <ButtonLink href="/app/playground" variant="secondary" className="w-full justify-center">
            try it →
          </ButtonLink>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="mb-12 max-w-2xl">
          <p className="label-mono flex items-center gap-2">
            <span className="inline-block size-[7px] rounded-full bg-green" />
            how it works
          </p>
          <h1 className="mt-4 text-[34px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[46px]">
            The mechanism, not the pitch.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
            Yinsi makes one claim: you can build a small specialized agent, compose it with others into a coordinated
            swarm, and let that swarm act on Solana under limits you set. This page shows how each of those
            steps actually works — the data structures, the control flow, and the places where the system deliberately
            refuses to do something.
          </p>
        </header>

        <div className="space-y-12">
          <Section id="unit" index="01" kicker="the unit" title="An agent is a manifest plus a bounded loop.">
            <P>
              An agent is not a chatbot with a personality. It is a manifest — a <Mono>finch.manifest/0.1</Mono>{" "}
              document: identity, model, memory, tools, permissions, wallet, triggers, budget — and a runtime that
              executes it. The document is the agent: you can read it, diff it, fork it, publish it, and run it
              somewhere else. Nothing about an agent requires this website to exist.
            </P>
            <CodeBlock title="a real agent — the Network Scout that runs in the Chain Intelligence swarm" code={AGENT_JSON} />
            <P>
              Launching resolves that document against live infrastructure and returns a bound runtime. The loop is
              deliberately small: recall memory, call the model with the declared tools, execute any tool calls,
              feed observations back, repeat until the model stops calling tools or the step budget runs out.
            </P>
            <AgentLoopDiagram />
            <Facts
              rows={[
                ["narrow by design", "One agent does one thing. Specialization is what makes composition legible — you can reason about what a Network Scout will do."],
                ["permissions can't self-widen", "Write tools are stripped at launch unless the wallet grants operator mode. A manifest cannot grant itself authority it wasn't given."],
                ["provider-abstracted", "The model is a reference, not a dependency. Hyperbolic today; any OpenAI-compatible endpoint by changing two fields."],
                ["bounded", "Step caps, daily action and credit budgets, and a kill switch that stops the agent after N consecutive tool failures."],
              ]}
            />
          </Section>

          <Section id="coordination" index="02" kicker="coordination" title="A swarm is a task graph over member agents.">
            <P>
              A swarm is many agents aligned to one objective. What aligns them is not a conversation; it is a
              directed acyclic graph. Each task names the agent that performs it, the tasks it depends on, and the
              typed channel it publishes on. A task's instruction can reference upstream channels
              with <Mono>{"{{channel}}"}</Mono>, and the coordinator substitutes the producing task's real output before
              the agent ever sees it.
            </P>
            <CodeBlock title="swarm manifest (nest.manifest/0.1) — abbreviated, from the Chain Intelligence swarm" code={SWARM_JSON} />
            <SwarmSchedulerDiagram />
            <P>
              The scheduler is plain topological execution: validate the graph (unknown agent, unknown dependency,
              duplicate channel, cycle — all rejected before anything runs), then repeatedly execute the wave of tasks
              whose dependencies have all published. Waves are bounded by <Mono>maxParallel</Mono>; the run halts on
              the failure or token limits in the execution policy.
            </P>
            <Facts
              rows={[
                ["typed channels, not a shared scratchpad", "Tasks communicate through named channels with one producer each. That's what makes a swarm's data flow auditable after the fact."],
                ["failure propagates honestly", "If a task fails, its channel is never published and downstream tasks are marked skipped — not fed a plausible substitute."],
                ["synthesis reads terminals", "The coordinator summarizes only from channels that actually exist, and is instructed to say when the outputs are insufficient."],
                ["portable", "A swarm manifest carries its members' full agent manifests. Export it, run it yourself with runNest() from @finch/sdk."],
              ]}
            />
            <p className="max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
              You can watch this happen:{" "}
              <Link href="/app/swarms" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
                run a swarm
              </Link>{" "}
              and every task shows its resolved input, its output, its token cost, its duration, and which tools it
              called.
            </p>
          </Section>

          <Section id="execution" index="03" kicker="execution" title="The execution layer is the only road to the chain.">
            <P>
              Reading Solana is unremarkable — balances, tokens, accounts, blocks. Writing is where agent systems
              usually get dishonest, so Yinsi has exactly one write path and no way around it. An intent is built with
              the exact instructions it will run, checked against policy,{" "}
              <strong className="font-semibold text-ink">simulated</strong>, optionally gated on a human, signed,
              submitted, and only then — once the network confirms it — reported as confirmed.
            </P>
            <ExecutionLifecycleDiagram />
            <Facts
              rows={[
                ["three modes, always stated", "PREVIEW: no wallet, read-only. SIMULATE: build the real transaction and simulate it against current state, no broadcast. LIVE: signed and sent, confirmation-gated."],
                ["simulation is not optional", "simulateTransaction runs before anyone signs. A failure surfaces the program logs that explain it, and the intent stops there."],
                ["idempotent", "Every execution carries an id with a unique index behind it. Replaying returns the stored record instead of sending a second transaction."],
                ["instructions, not summaries", "Solana: one intent, one transaction. The policy engine reads the instructions themselves — programs, accounts, amounts — so an intent's description cannot disguise what it does."],
              ]}
            />
            <p className="rounded-xs border border-line bg-bone-raised p-4 text-[13px] leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">What is live today:</strong> chain reads run against
              Solana mainnet right now — that is where the slot on the home page comes from. Writes take the same
              path: Courier prepares SOL transfers that the visitor&apos;s own wallet signs, capped at 0.1 SOL
              per transfer and 0.5 SOL per day, and nothing is reported as done until the network confirms it. No
              operator key exists in this deployment, so nothing here signs on its own; swarms run read-only unless
              their policy says otherwise, and the UI says so rather than showing a button that would lie.
            </p>
          </Section>

          <Section id="authority" index="04" kicker="authority" title="An agent never holds unbounded custody.">
            <P>
              The uncomfortable question about autonomous agents is what happens when one is wrong. Yinsi answers it
              structurally: an agent's authority is a bounded float, not a wallet. The agent operates a restricted
              operator keypair that a human funds with a small amount — the most it can ever lose is what it holds —
              and the owner tops it up, sweeps it, or simply stops funding it. A visitor never hands over authority at
              all: their own wallet signs each transaction.
            </P>
            <PermissionDiagram />
            <P>
              Below that ceiling the PolicyEngine sets the limits: per-asset daily allowances and per-transaction caps,
              recipient and program allowlists, and an approval threshold above which a spend pauses at{" "}
              <Mono>awaiting_approval</Mono> until a human signs off. It decodes the instructions themselves, so
              anything it cannot price is denied, and approvals count against allowances, because an approval is
              spendable authority. RWA interactions are hard-limited to an explicitly approved registry, and that gate
              cannot be waived from a manifest.
            </P>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">deny by default</Badge>
              <Badge tone="green">simulation mandatory</Badge>
              <Badge tone="green">rwa registry-gated</Badge>
              <Badge tone="gold">operator writes gated on audit</Badge>
            </div>
          </Section>

          <Section id="identity" index="05" kicker="identity" title="The chain is the record. The index is a convenience.">
            <P>
              An agent or a swarm is registered on Solana by a memo. The registry authority signs a Memo-program
              transaction that reads{" "}
              <Mono>finch-registry/1 register &lt;kind&gt;:&lt;handle&gt; sha256:&lt;manifest hash&gt; [&lt;uri&gt;]</Mono>.
              The manifest body lives offchain where large data belongs; the hash in the memo is what makes it
              verifiable, and the authority&apos;s signature is what makes it a registration — anyone can mention an
              address in a memo, only the key holder can sign one.
            </P>
            <RegistryDiagram />
            <P>
              MongoDB indexes those memos so the directory can search quickly. It is a cache, not an authority: if this
              site disappeared, another developer could rebuild the registry from the authority&apos;s signature
              history on Solana alone. That is the difference between a network and a database with a website in
              front of it. Until the authority is configured, every listing says it is not anchored.
            </P>
            <P>
              An <strong className="font-semibold text-ink">execution proof</strong> extends the same idea to actions:
              a meaningful live execution produces a receipt binding the agent id, swarm id, task id, action, chain,
              transaction signature, slot, fee and execution policy — so what an agent did is checkable by someone
              who doesn&apos;t trust the operator.
            </P>
          </Section>

          <Section id="economics" index="06" kicker="economics" title="Open infrastructure, free to use.">
            <P>
              Nothing here is a tollbooth. The SDK, manifests, self-hosting, directory browsing, publishing,
              playground previews and public chain reads stay free — a network nobody can use without paying first is
              not a network. Metered consumption (hosted agents, sustained swarm workloads, premium data) and
              publisher earnings are designed and accounted for in the data layer, and switched off.
            </P>
            <P>
              Publishing is open and free. A token gate exists only as an explicit switch,{" "}
              <Mono>PUBLISH_GATE=hold</Mono>, which is off by default — and the publish panel says so the moment it is
              on.
            </P>
            <p className="rounded-xs border border-line bg-bone-raised p-4 text-[13px] leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">Nothing moves fees on its own.</strong> There is no fee
              contract, no splitter and no treasury UI. The fee wallet&apos;s key is held by the operator outside
              this deployment, and any movement of funds from it is a deliberate, signed act — never automatic.
            </p>
          </Section>

          <Section id="honesty" index="07" kicker="honest state" title="What this system will not do.">
            <P>
              Most of the engineering in Yinsi is refusal. These are enforced in code, not in a style guide:
            </P>
            <Facts
              rows={[
                ["never fake a confirmation", "An HTTP 200 is not a transaction receipt. Confirmed state renders only from a transaction the network has confirmed, with its slot."],
                ["never invent metrics", "The network page shows the registry's real counts. If the network holds sixteen agents, it says sixteen."],
                ["never hide provenance", "Seed and demo data carry a badge everywhere they appear, and every task in a swarm run shows exactly what its agent was given."],
                ["never a dead button", "A control works, is visibly disabled, or states that it is not available yet — with the reason."],
                ["never leak a key", "The fee-wallet key exists only as a server secret read by one module. Providers and the execution layer throw if constructed in a browser."],
                ["never widen its own authority", "Manifests cannot grant themselves permissions; the RWA gate and mandatory simulation cannot be switched off from configuration."],
              ]}
            />
            <div className="flex flex-wrap gap-3 pt-2">
              <ButtonLink href="/app/playground">Try an agent</ButtonLink>
              <ButtonLink href="/app/swarms" variant="secondary">
                Run a swarm
              </ButtonLink>
              <ButtonLink href="/docs" variant="secondary">
                Read the docs
              </ButtonLink>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
