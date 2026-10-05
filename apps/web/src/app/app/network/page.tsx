import type { Metadata } from "next";
import Link from "next/link";
import { ChainTelemetry } from "@/components/chain/ChainTelemetry";
import { TrackedTokens } from "@/components/chain/TrackedTokens";
import { NetworkCounters } from "@/components/landing/NetworkCounters";
import { SwarmField } from "@/components/landing/SwarmField";

export const metadata: Metadata = {
  title: "Network",
  description:
    "The Yinsi network — real registry counts, live Solana telemetry, tracked SPL mints, and the swarm.",
};

export default function NetworkPage() {
  return (
    <div>
      <div className="relative border-b border-line">
        <div className="h-[46vh] min-h-[320px] w-full">
          <SwarmField count={260} />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-end">
          <div className="container-page pb-6">
            <p className="label-mono flex items-center gap-2 text-ink">
              <span className="inline-block size-[7px] rounded-full bg-green" />
              network /
            </p>
            <p className="mt-1 font-mono text-[10px] text-grey-faint">
              swarm field study · tracked agents in green · solana
            </p>
          </div>
        </div>
      </div>

      <div className="container-page py-10">
        <section aria-label="Chain telemetry" className="mb-10">
          <p className="label-mono mb-3">chain telemetry — live</p>
          <ChainTelemetry />
        </section>

        <section aria-label="Tracked tokens" className="mb-10">
          <p className="label-mono mb-3">tracked tokens — solana</p>
          <TrackedTokens />
        </section>

        <NetworkCounters />

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono">what counts here</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
              These are actual registry counts — rows the network currently holds, labeled seed before launch and
              indexed from MongoDB after. Yinsi never shows projected or invented metrics: if the protocol contains
              eight agents, this page says eight.
            </p>
          </div>
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono">the record on solana</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
              Once a registry authority is configured, an agent or swarm is anchored by a Solana memo transaction that
              authority signs: <span className="font-mono text-[12.5px]">finch-registry/1 register</span>, the
              handle and the manifest&apos;s sha256. Anyone can check a listing against Solana alone. Until then every
              listing reads as not anchored — never as verified. Confirmed executions carry a{" "}
              <span className="font-mono text-[12.5px] text-green-deep">execution proof</span>. MongoDB accelerates
              indexing — it never defines what is true.
            </p>
            <div className="mt-4 flex gap-4 font-mono text-[11px]">
              <Link href="/app/directory" className="text-green-deep hover:underline">
                browse the registry →
              </Link>
              <Link href="/docs" className="text-ink-soft hover:text-ink">
                registry docs →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
