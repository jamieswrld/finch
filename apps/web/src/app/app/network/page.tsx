import type { Metadata } from "next";
import Link from "next/link";
import { Murmuration } from "@/components/birds/Murmuration";
import { ChainTelemetry } from "@/components/chain/ChainTelemetry";
import { TrackedContracts } from "@/components/chain/TrackedContracts";
import { NetworkCounters } from "@/components/landing/NetworkCounters";

export const metadata: Metadata = {
  title: "Network",
  description:
    "The Finch network — real registry counts, live coordination, and the murmuration. Robinhood Chain is the canonical record.",
};

export default function NetworkPage() {
  return (
    <div>
      <div className="relative border-b border-line">
        <div className="h-[46vh] min-h-[320px] w-full">
          <Murmuration count={260} />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-end">
          <div className="container-page pb-6">
            <p className="label-mono flex items-center gap-2 text-ink">
              <span className="inline-block size-[7px] rounded-full bg-green" />
              network /
            </p>
            <p className="mt-1 font-mono text-[10px] text-grey-faint">
              murmuration field study · tracked individuals in green · robinhood chain 4663
            </p>
          </div>
        </div>
      </div>

      <div className="container-page py-10">
        <section aria-label="Chain telemetry" className="mb-10">
          <p className="label-mono mb-3">chain telemetry — live</p>
          <ChainTelemetry />
        </section>

        <section aria-label="Tracked contracts" className="mb-10">
          <p className="label-mono mb-3">tracked contracts — chain 4663</p>
          <TrackedContracts />
        </section>

        <NetworkCounters />

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono">what counts here</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
              These are actual registry counts — rows the network currently holds, labeled seed before launch and
              indexed from MongoDB and the onchain registry after. Finch never shows projected or invented metrics: if
              the protocol contains eight finches, this page says eight.
            </p>
          </div>
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono">the canonical record</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
              Robinhood Chain (4663) is the identity and registry layer: finch and nest registrations carry a manifest
              hash, URI, version and status, and meaningful live executions anchor a{" "}
              <span className="font-mono text-[12.5px] text-green-deep">Proof of Flight</span>. MongoDB accelerates
              indexing — it never defines what is true. If finch.fun disappeared, the network could be rebuilt from
              chain state.
            </p>
            <div className="mt-4 flex gap-4 font-mono text-[11px]">
              <Link href="/app/aviary" className="text-green-deep hover:underline">
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
