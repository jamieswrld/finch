import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentBuilder } from "@/components/build/AgentBuilder";
import { LoadingBlock } from "@/components/ui/StateBlocks";

export const metadata: Metadata = {
  title: "Agent builder",
  description:
    "Assemble an agent visually — identity, model, memory, tools, permissions, wallet, triggers, budget — then launch it.",
};

export default function BuildPage() {
  return (
    <div className="container-page py-12 md:py-16">
      <header className="max-w-2xl">
        <p className="label-mono flex items-center gap-2">
          <span className="inline-block size-[7px] rounded-full bg-green" />
          agent builder /
        </p>
        <h1 className="mt-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.02em] md:text-[48px]">
          Assemble an agent.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          Nine sections, one portable manifest. The builder emits the same{" "}
          <span className="font-mono text-[13px]">agent.json</span> (<span className="font-mono text-[13px]">finch.manifest/0.1</span>)
          document the SDK produces in code — build here, export it, fork it, self-host it. Permissions deny by
          default; nothing you configure here moves funds.
        </p>
      </header>
      <div className="mt-12">
        <Suspense fallback={<LoadingBlock label="loading builder" />}>
          <AgentBuilder />
        </Suspense>
      </div>
    </div>
  );
}
