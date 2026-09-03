import type { Metadata } from "next";
import { Suspense } from "react";
import { NestsWorkbench } from "@/components/nests/NestsWorkbench";
import { LoadingBlock } from "@/components/ui/StateBlocks";
import { NEST_PRESETS } from "@/lib/nest-presets";

export const metadata: Metadata = {
  title: "Nests",
  description:
    "A nest is a coordinated swarm of finches around one objective. Run a real preset nest and watch it coordinate task by task, or compose your own.",
};

export default function NestsPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          nests /
        </p>
        <h1 className="mt-3 text-[32px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[40px]">
          Coordinate the swarm.
        </h1>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          A nest aligns many specialized finches to one objective through a task graph: each task names its finch, its
          dependencies and the typed channel it publishes on. Run one below and watch it coordinate — every task shows
          the exact input its finch received, what it returned, what it cost, and which tools it called.
        </p>
      </header>
      <div className="mt-8">
        <Suspense fallback={<LoadingBlock label="loading nests" />}>
          <NestsWorkbench presets={NEST_PRESETS} />
        </Suspense>
      </div>
    </div>
  );
}
