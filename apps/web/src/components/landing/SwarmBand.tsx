"use client";

import Link from "next/link";
import { Murmuration } from "@/components/birds/Murmuration";
import { NetworkCounters } from "./NetworkCounters";

/**
 * The swarm band — the murmuration sits directly under the hero and follows
 * the cursor, with the whole model explained in four lines beside it. A
 * visitor should understand Finch here, without opening the docs.
 */

const STEPS = [
  {
    n: "01",
    term: "Finch",
    line: "One specialized agent — a model, memory, a few tools and a bounded wallet, written down as a portable finch.json.",
  },
  {
    n: "02",
    term: "Nest",
    line: "A swarm of finches aligned to one objective by a task graph. Each task names its finch, its dependencies, and the channel it publishes on.",
  },
  {
    n: "03",
    term: "Flightpath",
    line: "How a nest touches Robinhood Chain. Every write is simulated, checked against your limits, and only called confirmed once a receipt exists.",
  },
  {
    n: "04",
    term: "Network",
    line: "Nests expose their capabilities to other nests. Publish to the Aviary, register onchain, and the swarm compounds.",
  },
];

export function SwarmBand() {
  return (
    <section id="swarm" className="relative scroll-mt-10 border-b border-line bg-bone">
      {/* the nest lives behind the whole band and follows the pointer */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <Murmuration count={240} />
      </div>

      <div className="container-page relative py-16 md:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="label-mono flex items-center gap-2">
              <span className="inline-block size-[7px] rounded-full bg-green" />
              the swarm
            </p>
            <h2 className="mt-4 text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink md:text-[36px]">
              Small minds,
              <br />
              coordinated.
            </h2>
            <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-ink-soft">
              A murmuration has no leader. Each bird reads the few around it, and the shape emerges. Finch works the
              same way — which is why the whole system is four ideas, not forty.
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-grey-faint">
              move your cursor — the swarm follows
            </p>
            <div className="mt-6">
              <NetworkCounters />
            </div>
          </div>

          <div>
            <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-2">
              {STEPS.map((step) => (
                <li key={step.term} className="bg-bone-raised/95 p-5 backdrop-blur-[1px]">
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] tracking-[0.12em] text-green-deep">{step.n}</span>
                    <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-ink">
                      {step.term}
                    </span>
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{step.line}</p>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Link
                href="/app/nests"
                className="group inline-flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.12em] text-green-deep"
              >
                watch a nest coordinate
                <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                  →
                </span>
              </Link>
              <Link
                href="/how-it-works"
                className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:text-ink"
              >
                the full mechanism →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
