import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BENCHMARKS, EXPERIMENTS, FIPS, GRANT_TRACKS, OPEN_PROBLEMS } from "@/lib/research-content";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Finch's open research program: experiments in agent coordination, benchmark suites, open problems, grants and Finch Improvement Proposals.",
};

const STATUS_TONE = {
  active: "green",
  design: "sage",
  draft: "grey",
  "implemented-draft": "gold",
} as const;

export default function ResearchPage() {
  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          the lab
        </p>
        <h1 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[48px]">Research</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          Agent coordination and onchain intelligence are open problems, and Finch treats them that way: experiments
          run in public, benchmark methodology is published before numbers are, and the protocol grows through
          written proposals. No result on this page will ever appear before its run does.
        </p>
      </header>

      {/* experiments */}
      <section id="experiments" className="scroll-mt-24 pt-16">
        <SectionHeading index="01" kicker="Experiments" title="What the lab is flying right now." />
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line md:grid-cols-2">
          {EXPERIMENTS.map((experiment) => (
            <article key={experiment.id} className="bg-bone-raised p-5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-green-deep">{experiment.id}</span>
                <Badge tone={STATUS_TONE[experiment.status]}>{experiment.status}</Badge>
                <span className="ml-auto font-mono text-[10px] text-grey-faint">{experiment.area}</span>
              </div>
              <h3 className="mt-2.5 text-[16px] font-semibold tracking-[-0.01em] text-ink">{experiment.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{experiment.summary}</p>
            </article>
          ))}
        </div>
      </section>

      {/* benchmarks */}
      <section id="benchmarks" className="scroll-mt-24 pt-16">
        <SectionHeading
          index="02"
          kicker="Benchmarks"
          title="Methodology first, numbers second."
          lede="Suites are defined and versioned before any results are published — pre-registration for agents. First public runs land with the Flightpath testnet release."
        />
        <div className="overflow-x-auto rounded-xs border border-line">
          <table className="w-full min-w-[720px] border-collapse bg-bone text-left">
            <thead>
              <tr className="border-b border-line bg-bone-raised">
                <th className="label-mono px-4 py-2.5 font-normal">suite</th>
                <th className="label-mono px-4 py-2.5 font-normal tnum">tasks</th>
                <th className="label-mono px-4 py-2.5 font-normal">primary metric</th>
                <th className="label-mono px-4 py-2.5 font-normal">description</th>
                <th className="label-mono px-4 py-2.5 font-normal">status</th>
              </tr>
            </thead>
            <tbody>
              {BENCHMARKS.map((benchmark) => (
                <tr key={benchmark.suite} className="border-b border-line/60 last:border-b-0 hover:bg-bone-raised">
                  <td className="px-4 py-3 font-mono text-[12px] text-ink">{benchmark.suite}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-ink tnum">{benchmark.tasks}</td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-soft">{benchmark.metric}</td>
                  <td className="px-4 py-3 text-[12.5px] leading-snug text-ink-soft">{benchmark.description}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[10.5px] text-gold-deep">{benchmark.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* open problems */}
      <section id="problems" className="scroll-mt-24 pt-16">
        <SectionHeading index="03" kicker="Open problems" title="Questions we can't answer yet." />
        <ol className="space-y-px overflow-hidden rounded-xs border border-line bg-line">
          {OPEN_PROBLEMS.map((problem) => (
            <li key={problem.id} className="flex flex-col gap-2 bg-bone-raised p-5 sm:flex-row sm:gap-6">
              <span className="label-mono shrink-0 text-green-deep">{problem.id}</span>
              <div>
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{problem.title}</h3>
                <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{problem.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* grants */}
      <section id="grants" className="scroll-mt-24 pt-16">
        <SectionHeading
          index="04"
          kicker="Grants"
          title="The treasury funds the questions."
          lede="Grant allocations are denominated in $FINCH and open after token launch; the tracks and review criteria are public now so builders can start early."
        />
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {GRANT_TRACKS.map((grant) => (
            <div key={grant.track} className="bg-bone-raised p-5">
              <p className="font-mono text-[12px] font-medium text-ink">{grant.track}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{grant.note}</p>
              <p className="mt-3 font-mono text-[11px] text-gold-deep">{grant.size}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10.5px] text-grey-faint">
          applications open at launch · draft proposals welcome in the meantime — see the fip process below
        </p>
      </section>

      {/* FIPs */}
      <section id="fips" className="scroll-mt-24 pt-16">
        <SectionHeading
          index="05"
          kicker="Finch Improvement Proposals"
          title="The protocol changes in writing."
          lede="A FIP is a short design document: motivation, specification, security considerations. Anything that touches manifests, execution, fees or the registry goes through one."
        />
        <ol className="space-y-px overflow-hidden rounded-xs border border-line bg-line">
          {FIPS.map((fip) => (
            <li key={fip.id} className="flex flex-col gap-2 bg-bone-raised p-5 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="label-mono w-14 shrink-0 text-green-deep">{fip.id}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{fip.title}</h3>
                <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{fip.summary}</p>
              </div>
              <Badge tone={STATUS_TONE[fip.status]}>{fip.status.replace("-", " · ")}</Badge>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xs border border-dashed border-line-strong p-5">
          <p className="label-mono">propose one</p>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            Write a one-page draft — motivation, specification, security considerations — and submit it through the
            repository's proposal process (docs → contributing). Numbering is assigned on acceptance into draft
            status.
          </p>
        </div>
      </section>
    </div>
  );
}
