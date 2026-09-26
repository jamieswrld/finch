"use client";

import { Badge, StatusDot } from "@/components/ui/Badge";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import {
  formatLamportsAsSol,
  formatMicroLamports,
  formatSlot,
  formatSlotTime,
  formatTps,
  useChain,
  type ChainTelemetry as Telemetry,
} from "@/lib/chain-client";

const MISSING = "—";

function Metric({
  label,
  value,
  unit,
  note,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  href?: string | null;
}) {
  const body = (
    <>
      <p className="font-mono text-[9.5px] text-grey-faint">{label}</p>
      <p className="mt-1 font-mono text-[20px] leading-none tracking-[-0.02em] text-ink tnum md:text-[24px]">
        {value}
        {/* a unit next to "—" would read as a measured nothing */}
        {unit && value !== MISSING && <span className="ml-1 text-[11px] text-grey">{unit}</span>}
      </p>
      {note && <p className="mt-1.5 text-[11px] leading-snug text-grey">{note}</p>}
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block bg-bone-raised p-4 transition-colors hover:bg-bone">
      {body}
    </a>
  ) : (
    <div className="bg-bone-raised p-4">{body}</div>
  );
}

// Solscan reads mainnet unless told otherwise, so a devnet slot link needs
// the cluster query or it shows "not found" for a block that exists.
function blockUrl(data: Telemetry): string | null {
  if (!data.explorerUrl || !data.slot) return null;
  const query = data.cluster === "mainnet-beta" ? "" : `?cluster=${data.cluster}`;
  return `${data.explorerUrl.replace(/\/+$/, "")}/block/${data.slot}${query}`;
}

function GenesisBadge({ matches, cluster }: { matches: boolean | null; cluster: string }) {
  if (matches === true) return <Badge tone="green">genesis matches {cluster}</Badge>;
  if (matches === false) return <Badge tone="red">genesis mismatch</Badge>;
  return <Badge tone="grey">genesis not read</Badge>;
}

/**
 * Full chain readout for the Network page. Every number is a live read; a
 * failed sample says so instead of showing a stale figure, and a value the
 * node did not return renders as "—", never as zero.
 */
export function ChainTelemetry() {
  const state = useChain(10_000);

  if (state.status === "loading") return <LoadingBlock label="reading solana" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const { data } = state;

  if (!data.reachable) {
    return (
      <div className="rounded-xs border border-red-deep/40 bg-red-wash/50 p-5" role="alert">
        <p className="label-mono text-red-deep">solana rpc unreachable</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          The network read failed at {new Date(data.sampledAt).toLocaleTimeString()}. Nothing on this page is
          estimated while the endpoint is down.
        </p>
        {data.error && <p className="mt-2 font-mono text-[11px] text-red-deep">{data.error}</p>}
        <button
          type="button"
          onClick={state.retry}
          className="mt-4 rounded-xs border border-red-deep/40 px-2.5 py-1.5 font-mono text-[11px] text-red-deep hover:bg-red-wash"
        >
          retry
        </button>
      </div>
    );
  }

  const blockAge = data.blockTime
    ? Math.max(0, Math.round((Date.now() - new Date(data.blockTime).getTime()) / 1000))
    : null;
  const fees = data.priorityFeeMicroLamports;
  const sampleNote = data.sampleSeconds !== null ? `over the last ${data.sampleSeconds}s of samples` : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-green-deep">
          <StatusDot tone="green" pulse />
          live
        </span>
        <span className="font-mono text-[11px] text-ink">
          {data.chainName} · {data.cluster}
        </span>
        <Badge tone="sage">{data.chain}</Badge>
        <GenesisBadge matches={data.genesisMatches} cluster={data.cluster} />
        {data.version && <span className="hidden font-mono text-[10.5px] text-grey lg:inline">node {data.version}</span>}
        <span className="ml-auto font-mono text-[10px] text-grey-faint tnum">
          rtt {data.latencyMs !== null ? `${data.latencyMs}ms` : MISSING} · sampled {new Date(data.sampledAt).toLocaleTimeString()}
        </span>
      </div>

      {data.genesisMatches === false && (
        <p className="mt-3 rounded-xs border border-red-deep/40 bg-red-wash/50 px-3 py-2 text-[12.5px] leading-snug text-red-deep" role="alert">
          The RPC&apos;s genesis hash is not {data.cluster}&apos;s. These figures come from whichever cluster that endpoint
          serves — check SOLANA_RPC_URLS.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line lg:grid-cols-4">
        <Metric
          label="slot"
          value={formatSlot(data.slot)}
          note={blockAge !== null ? `block ${blockAge}s ago` : undefined}
          href={blockUrl(data)}
        />
        <Metric label="block height" value={formatSlot(data.blockHeight)} note="blocks produced; skipped slots excluded" />
        <Metric
          label="epoch"
          value={data.epoch !== null ? String(data.epoch) : MISSING}
          note={data.epochProgressPct !== null ? `${data.epochProgressPct.toFixed(1)}% through` : undefined}
        />
        <Metric
          label="tps"
          value={formatTps(data.tps)}
          note={
            data.nonVoteTps !== null
              ? `${formatTps(data.nonVoteTps)} non-vote${sampleNote ? ` · ${sampleNote}` : ""}`
              : sampleNote
          }
        />
        <Metric label="slot time" value={formatSlotTime(data.slotTimeMs)} unit="ms" note={sampleNote ? `observed ${sampleNote}` : undefined} />
        <Metric
          label="fee per signature"
          value={formatLamportsAsSol(data.feePerSignatureLamports)}
          unit="SOL"
          note={data.feePerSignatureLamports !== null ? `${formatSlot(data.feePerSignatureLamports)} lamports` : undefined}
        />
        <Metric
          label="priority fee, median"
          value={formatMicroLamports(fees?.median)}
          unit="µlamports/CU"
          note={
            fees
              ? `p75 ${formatMicroLamports(fees.p75)} · p95 ${formatMicroLamports(fees.p95)} · ${fees.slots} recent slots`
              : "not read"
          }
        />
        <Metric label="transactions since genesis" value={formatSlot(data.transactionCount)} note="per the node" />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xs border border-line">
        <table className="w-full min-w-[520px] border-collapse bg-bone text-left">
          <caption className="sr-only">RPC endpoint health</caption>
          <thead>
            <tr className="border-b border-line bg-bone-raised">
              <th className="label-mono px-3 py-2 font-normal">rpc endpoint</th>
              <th className="label-mono px-3 py-2 font-normal">status</th>
              <th className="label-mono px-3 py-2 font-normal">latency</th>
              <th className="label-mono px-3 py-2 font-normal">slot</th>
            </tr>
          </thead>
          <tbody>
            {data.endpoints.map((endpoint) => (
              <tr key={endpoint.url} className="border-b border-line/50 last:border-b-0">
                <td className="px-3 py-2 font-mono text-[11px] break-all text-ink-soft">
                  {endpoint.url}
                  {endpoint.error && <span className="mt-0.5 block text-[10px] text-red-deep">{endpoint.error}</span>}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`flex items-center gap-1.5 font-mono text-[10.5px] ${endpoint.reachable ? "text-green-deep" : "text-red-deep"}`}
                  >
                    <StatusDot tone={endpoint.reachable ? "green" : "red"} />
                    {endpoint.reachable ? "ok" : "down"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink tnum">
                  {endpoint.latencyMs !== null ? `${endpoint.latencyMs}ms` : MISSING}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink tnum">{formatSlot(endpoint.slot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.endpoints.length < 2 && (
        <p className="mt-2 font-mono text-[9.5px] text-grey-faint">
          single endpoint — add SOLANA_RPC_URLS (comma separated) to run with failover
        </p>
      )}
    </div>
  );
}
