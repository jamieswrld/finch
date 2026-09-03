"use client";

import Link from "next/link";
import type { RunDoc } from "@finch/db";
import { Badge } from "@/components/ui/Badge";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { useFetch } from "@/lib/use-fetch";

interface RunsResponse {
  source: "db" | "memory";
  configured: boolean;
  degraded: boolean;
  runs: RunDoc[];
}

const STATUS_TONE = {
  completed: "green",
  failed: "red",
  halted: "gold",
} as const;

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * What your agents actually did. Every Flight School preview and nest run
 * leaves a record here with its cost, duration and outcome.
 */
export function RunHistory({ limit = 8 }: { limit?: number }) {
  const state = useFetch<RunsResponse>(`/api/runs?limit=${limit}`, { refreshMs: 20_000 });

  return (
    <section className="rounded-xs border border-line bg-bone-raised" aria-label="Run history">
      <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <span className="label-mono text-ink">run history</span>
        {state.status === "ready" && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">
            {state.data.source === "db" ? "durable" : state.data.degraded ? "database unreachable" : "in-process buffer"}
          </span>
        )}
      </header>

      <div className="p-4">
        {state.status === "loading" && <LoadingBlock label="loading runs" />}
        {state.status === "error" && <ErrorBlock message={state.message} onRetry={state.retry} />}
        {state.status === "ready" &&
          (state.data.runs.length === 0 ? (
            <EmptyBlock title="no runs yet">
              Try a preset in{" "}
              <Link href="/app/school" className="text-green-deep underline decoration-green-deep/40 underline-offset-2">
                Flight School
              </Link>{" "}
              or run a nest — each one lands here with its cost and outcome.
            </EmptyBlock>
          ) : (
            <ul className="divide-y divide-line/60">
              {state.data.runs.map((run) => (
                <li key={run.runId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
                      {run.subjectName || run.subject}
                      <span className="ml-1.5 font-mono text-[10px] font-normal uppercase tracking-[0.1em] text-grey-faint">
                        {run.kind}
                      </span>
                    </p>
                    <p className="truncate font-mono text-[10.5px] text-grey">
                      {run.objective || run.subject}
                    </p>
                  </div>
                  <span className="shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.08em] text-grey-faint tnum">
                    <span className="block">{(run.durationMs / 1000).toFixed(1)}s</span>
                    <span className="block">{run.cost.outputTokens} tok</span>
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-[10px] text-grey-faint">
                    {relative(run.finishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ))}

        {state.status === "ready" && state.data.source === "memory" && state.data.runs.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-gold-deep">
            {state.data.degraded
              ? "The configured database is unreachable, so this history is being held in memory and will be lost on restart."
              : "No database configured — this history lives in memory and is lost on restart. Set MONGODB_URI to make it durable."}
          </p>
        )}
      </div>
    </section>
  );
}
