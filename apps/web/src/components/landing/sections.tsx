import { DartGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";

/** Scroll narrative: ONE → SPECIALIZE → COORDINATE → NEST → CONNECT → NETWORK */

const SPECIALISTS = [
  { key: "MARKET", note: "Robinhood assets, prices, movement." },
  { key: "NEWS", note: "Filings and headlines → structured events." },
  { key: "PONS", note: "Launches, holders, liquidity, activity." },
  { key: "RWA", note: "Tokenized equities and RWA structure." },
  { key: "WALLET", note: "Balances, flows, watchlists." },
  { key: "SECURITY", note: "Contracts, permissions, anomalies." },
  { key: "DEV", note: "Repos, ABIs, technical systems." },
  { key: "EXECUTION", note: "Policied, simulated onchain action." },
];

export function OneFinchSection() {
  return (
    <section id="one" className="container-page scroll-mt-10 py-20">
      <SectionHeading
        index="01"
        kicker="one finch"
        title="One finch does one thing well."
        lede="A finch is one specialized intelligent agent with a narrow, understandable purpose — not another general-purpose chatbot. Every finch is a portable manifest: fork it, self-host it, compose it."
      />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line md:grid-cols-4">
        {SPECIALISTS.map((specialist, index) => (
          <div key={specialist.key} className="group bg-bone-raised p-4 transition-colors hover:bg-bone">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] font-medium tracking-[0.14em] text-ink">{specialist.key}</span>
              <DartGlyph size={11} angle={-14} className="text-grey-faint transition-colors group-hover:text-green-deep" />
            </div>
            <p className="mt-2 text-[12px] leading-snug text-grey">{specialist.note}</p>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-grey-faint">
              finch/{String(index + 1).padStart(3, "0")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

const PONS_NEST = [
  { name: "Pons Scout", out: "launches" },
  { name: "Holder Analyst", out: "holder.map" },
  { name: "Liquidity Analyst", out: "liq.profile" },
  { name: "Market Finch", out: "market.view" },
  { name: "Risk Finch", out: "risk.score" },
  { name: "Validator", out: "verdict" },
  { name: "Alert Finch", out: "alert" },
];

export function NestSection() {
  return (
    <section className="border-y border-line bg-bone-raised py-20">
      <div className="container-page">
        <SectionHeading
          index="02"
          kicker="the nest"
          title="Align them."
          lede="A nest is a coordinated swarm of finches sharing one objective, one context, one task graph. The coordinator decomposes the objective; every task carries its finch, inputs, dependencies, cost and provenance."
        />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <figure className="grid-paper overflow-x-auto rounded-xs border border-line bg-bone p-5">
            <p className="label-mono">pons intelligence nest</p>
            <p className="mt-1 max-w-md text-[12px] leading-snug text-grey">
              objective: monitor new Pons launches, analyze structure, liquidity and activity — alert on criteria match.
            </p>
            <div className="mt-5 flex min-w-[680px] items-stretch gap-0">
              {PONS_NEST.map((finch, index) => (
                <div key={finch.name} className="flex items-center">
                  <div className="rounded-xs border border-line bg-bone-raised px-3 py-2.5">
                    <p className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-medium tracking-[0.06em] text-ink">
                      <DartGlyph size={10} angle={-14} className="text-ink-soft" />
                      {finch.name}
                    </p>
                    <p className="mt-1 font-mono text-[9px] text-sage-deep">→ {finch.out}</p>
                  </div>
                  {index < PONS_NEST.length - 1 && <span className="mx-1.5 font-mono text-[11px] text-sage-deep">→</span>}
                </div>
              ))}
            </div>
            <figcaption className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">
              fig. — task pipeline · every hop is a typed channel
            </figcaption>
          </figure>
          <div>
            <ul className="space-y-2.5">
              {["objective + shared context", "task graph with dependencies", "memory, permissions, budget", "execution policy: preview / simulate / live", "watch it coordinate, task by task"].map(
                (line) => (
                  <li key={line} className="flex items-center gap-2.5 text-[13.5px] text-ink-soft">
                    <span className="size-1 rounded-full bg-green" />
                    {line}
                  </li>
                ),
              )}
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/app/nests?preset=pons-intelligence">Try this nest</ButtonLink>
              <ButtonLink href="/app/nests" variant="secondary">
                View flow
              </ButtonLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function NestMeshSection() {
  const box = "rounded-xs border border-line bg-bone-raised px-4 py-3";
  const chip = "rounded-xs border border-sage/60 bg-sage/10 px-2 py-1 font-mono text-[9.5px] text-sage-deep whitespace-nowrap";
  return (
    <section className="container-page py-20">
      <SectionHeading
        index="03"
        kicker="nest-to-nest"
        title="Let nests talk."
        lede="A nest exposes structured capabilities with explicit input and output schemas — over Finch protocols, HTTP or Flightpath. Discoverable interfaces, no tight coupling. That's what turns a dashboard into a network."
      />
      <div className="grid-paper overflow-x-auto rounded-xs border border-line bg-bone-raised p-6">
        <div className="flex min-w-[640px] items-center justify-center gap-3">
          <div className={box}>
            <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-ink">RESEARCH NEST</p>
            <p className="mt-1 font-mono text-[9px] text-grey">5 finches · read-only</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className={chip}>research.report/v1</span>
            <span className="font-mono text-[11px] text-sage-deep">→</span>
          </div>
          <div className={box}>
            <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-ink">MARKET NEST</p>
            <p className="mt-1 font-mono text-[9px] text-grey">4 finches · read-only</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className={chip}>risk.decision/v1</span>
            <span className="font-mono text-[11px] text-sage-deep">→</span>
          </div>
          <div className={box}>
            <p className="font-mono text-[11px] font-medium tracking-[0.1em] text-ink">EXECUTION NEST</p>
            <p className="mt-1 flex items-center gap-1.5 font-mono text-[9px] text-grey">
              policied writes <Badge tone="gold">simulate → live</Badge>
            </p>
          </div>
        </div>
        <p className="mt-5 text-center font-mono text-[9.5px] uppercase tracking-[0.12em] text-grey-faint">
          http · webhooks · onchain · finch→finch · nest→nest
        </p>
      </div>
    </section>
  );
}
