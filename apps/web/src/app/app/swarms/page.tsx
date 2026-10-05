import type { Metadata } from "next";
import { Suspense } from "react";
import { SwarmsWorkbench } from "@/components/swarms/SwarmsWorkbench";
import { LoadingBlock } from "@/components/ui/StateBlocks";
import { NEST_PRESETS } from "@/lib/nest-presets";

export const metadata: Metadata = {
  title: "Swarms",
  description:
    "A swarm is a coordinated group of agents around one objective. Run a real preset swarm and watch it coordinate task by task, or compose your own.",
};

export default function SwarmsPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          swarms /
        </p>
        <h1 className="mt-3 text-[32px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[40px]">
          Coordinate the swarm.
        </h1>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          A swarm aligns many specialized agents to one objective through a task graph: each task names its agent, its
          dependencies and the typed channel it publishes on. Run one below and watch it coordinate — every task shows
          the exact input its agent received, what it returned, what it cost, and which tools it called.
        </p>
      </header>
      <div className="mt-8">
        <Suspense fallback={<LoadingBlock label="loading swarms" />}>
          <SwarmsWorkbench presets={NEST_PRESETS} />
        </Suspense>
      </div>
    </div>
  );
}
