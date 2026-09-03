"use client";

import { Badge, StatusDot } from "@/components/ui/Badge";
import { ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { formatBlock, formatGas, useChain } from "@/lib/chain-client";

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
        {unit && <span className="ml-1 text-[11px] text-grey">{unit}</span>}
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

/**
 * Full chain readout for the Network page. Every number is a live read; a
 * failed sample says so instead of showing a stale figure.
 */
export function ChainTelemetry() {
  const state = useChain(10_000);

  if (state.status === "loading") return <LoadingBlock label="reading chain 4663" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const { data } = state;

  if (!data.reachable) {
    return (
      <div className="rounded-xs border border-red-deep/40 bg-red-wash/50 p-5" role="alert">
        <p className="label-mono text-red-deep">robinhood rpc unreachable</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          The chain read failed at {new Date(data.sampledAt).toLocaleTimeString()}. Nothing on this page is
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

  const blockAge = data.blockTimestamp
    ? Math.max(0, Math.round((Date.now() - new Date(data.blockTimestamp).getTime()) / 1000))
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-3">
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-green-deep">
          <StatusDot tone="green" pulse />
          live
        </span>
        <span className="font-mono text-[11px] text-ink">
          {data.chainName} · {data.chainId}
        </span>
        <Badge tone="sage">{data.stack}</Badge>
        {data.clientVersion && (
          <span className="hidden font-mono text-[10.5px] text-grey lg:inline">{data.clientVersion}</span>
        )}
        <span className="ml-auto font-mono text-[10px] text-grey-faint tnum">
          rtt {data.latencyMs}ms · sampled {new Date(data.sampledAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line lg:grid-cols-4">
        <Metric
          label="block height"
          value={formatBlock(data.blockNumber)}
          note={blockAge !== null ? `${blockAge}s ago` : undefined}
          href={data.explorerUrl && data.blockNumber ? `${data.explorerUrl}/block/${data.blockNumber}` : null}
        />
        <Metric label="gas price" value={formatGas(data.gasPriceGwei)} unit="gwei" note="base fee, live" />
        <Metric
          label="txs in block"
          value={data.transactionsInLatestBlock !== null ? String(data.transactionsInLatestBlock) : "—"}
          note={data.blockTimeSeconds !== null ? `${data.blockTimeSeconds}s mean block time (200-block window)` : undefined}
        />
        <Metric
          label="gas used"
          value={
            data.gasUsed && data.gasLimit
              ? `${((Number(data.gasUsed) / Number(data.gasLimit)) * 100).toFixed(1)}%`
              : "—"
          }
          note={data.gasUsed ? `${Number(data.gasUsed).toLocaleString("en-US")} gas` : undefined}
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xs border border-line">
        <table className="w-full min-w-[520px] border-collapse bg-bone text-left">
          <caption className="sr-only">RPC endpoint health</caption>
          <thead>
            <tr className="border-b border-line bg-bone-raised">
              <th className="label-mono px-3 py-2 font-normal">rpc endpoint</th>
              <th className="label-mono px-3 py-2 font-normal">status</th>
              <th className="label-mono px-3 py-2 font-normal">latency</th>
              <th className="label-mono px-3 py-2 font-normal">head</th>
            </tr>
          </thead>
          <tbody>
            {data.endpoints.map((endpoint) => (
              <tr key={endpoint.url} className="border-b border-line/50 last:border-b-0">
                <td className="px-3 py-2 font-mono text-[11px] break-all text-ink-soft">{endpoint.url}</td>
                <td className="px-3 py-2">
                  <span
                    className={`flex items-center gap-1.5 font-mono text-[10.5px] ${endpoint.reachable ?"text-green-deep" : "text-red-deep"}`}
                  >
                    <StatusDot tone={endpoint.reachable ? "green" : "red"} />
                    {endpoint.reachable ? "ok" : "down"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink tnum">
                  {endpoint.latencyMs !== null ? `${endpoint.latencyMs}ms` : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink tnum">{formatBlock(endpoint.blockNumber)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.endpoints.length < 2 && (
        <p className="mt-2 font-mono text-[9.5px] text-grey-faint">
          single endpoint — add ROBINHOOD_RPC_URLS (comma separated) to run with failover
        </p>
      )}
    </div>
  );
}
