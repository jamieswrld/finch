"use client";

import { DataBadge } from "@/components/ui/Badge";
import { useFetch } from "@/lib/use-fetch";

interface NetworkStats {
  source: "db" | "builtin";
  counts: { finches: number; nests: number; executions: number; proofsOfFlight: number };
}

/** Real registry counts only — if the network holds 16, it says 16. */
export function NetworkCounters() {
  const state = useFetch<NetworkStats>("/api/network");

  const counts = state.status === "ready" ? state.data.counts : null;
  const rows: Array<{ label: string; value: string }> = [
    { label: "registered finches", value: counts ? String(counts.finches) : "—" },
    { label: "registered nests", value: counts ? String(counts.nests) : "—" },
    { label: "executions", value: counts ? String(counts.executions) : "—" },
    { label: "proofs of flight", value: counts ? String(counts.proofsOfFlight) : "—" },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="bg-bone-raised px-4 py-3">
            <p className="font-mono text-[9.5px] text-grey-faint">{row.label}</p>
            <p className="mt-1 font-mono text-[24px] leading-none tracking-[-0.02em] text-ink tnum">{row.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-2 font-mono text-[9.5px] text-grey-faint">
        {state.status === "ready" && <DataBadge source={state.data.source === "db" ? "db" : "builtin"} />}
        {state.status === "error" ? (
          <span className="text-red-deep">
            counts unavailable — {state.message}
            <button type="button" onClick={state.retry} className="ml-2 underline">
              retry
            </button>
          </span>
        ) : state.status === "loading" ? (
          "reading the registry…"
        ) : (
          "real registry counts — never projections"
        )}
      </p>
    </div>
  );
}
