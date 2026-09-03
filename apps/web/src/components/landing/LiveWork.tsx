"use client";

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";

/**
 * The hero readout.
 *
 * It used to say "network robinhood / chain 4663 / status online". That is
 * plumbing — it proves a server answered a ping, which is true of every
 * website. This says what the protocol has executed instead: nests defined,
 * finches published, tasks run, proofs signed, and the last thing a nest was
 * actually asked to do.
 *
 * Nothing here is invented. At zero traffic it does not print a zero and call
 * it a metric — it prints the guarantees the engine enforces on every single
 * execution, which are true at any volume because they are code, not traffic.
 */

interface ActivityResponse {
  provenance: "live" | "seed" | "empty";
  durable: boolean;
  counts: { finches: number; nests: number; runs: number; tasks: number; proofs: number };
  recent: Array<{
    runId: string;
    kind: "finch" | "nest";
    subject: string;
    objective: string;
    mode: string;
    status: string;
    taskCount: number;
    durationMs: number;
    finishedAt: string;
  }>;
  guarantees: { policyRules: number; denyByDefault: boolean; modes: string[]; simulationRequired: boolean };
}

function Metric({ value, label, hint }: { value: number; label: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={hint}>
      <span className="tnum text-[19px] leading-none font-semibold text-ink sm:text-[22px]">{value}</span>
      <span className="font-mono text-[8.5px] text-grey-faint">{label}</span>
    </div>
  );
}

function relative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Cycles the most recent real runs, one line at a time. */
function WorkLine({ recent }: { recent: ActivityResponse["recent"] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (recent.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % recent.length), 4200);
    return () => clearInterval(timer);
  }, [recent.length]);

  const run = recent[index % recent.length];
  if (!run) return null;

  const verb = run.status === "completed" ? "ran" : run.status === "halted" ? "halted on" : "failed on";
  const detail = run.objective.trim() || `${run.taskCount} task${run.taskCount === 1 ? "" : "s"}`;

  return (
    <p
      key={run.runId}
      className="reveal max-w-[520px] truncate font-mono text-[9.5px] text-grey"
      title={`${run.subject} — ${run.objective}`}
    >
      <span className="text-ink-soft">{run.subject}</span>
      <span className="text-grey-faint"> {verb} </span>
      <span className="text-ink-soft">{detail}</span>
      <span className="text-grey-faint">
        {" "}· {run.taskCount > 0 ? `${run.taskCount} tasks · ` : ""}
        {(run.durationMs / 1000).toFixed(1)}s · {relative(run.finishedAt)}
      </span>
    </p>
  );
}

export function LiveWork() {
  const state = useFetch<ActivityResponse>("/api/activity", { refreshMs: 20_000 });

  if (state.status !== "ready") {
    return <div className="h-[52px]" aria-hidden />;
  }

  const { counts, recent, guarantees, provenance } = state.data;
  const hasWork = recent.length > 0;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-7 sm:gap-9">
        <Metric value={counts.nests} label="nests" hint="Coordinated swarms defined in the registry" />
        <Metric value={counts.finches} label="finches" hint="Individual agents published to the Aviary" />
        <Metric value={counts.runs} label="runs" hint="Executions this protocol has carried out" />
        <Metric value={counts.tasks} label="tasks" hint="Individual tasks dispatched inside those runs" />
        <Metric value={counts.proofs} label="proofs" hint="Signed Proof of Flight receipts for confirmed executions" />
      </div>

      {hasWork ? (
        <WorkLine recent={recent} />
      ) : (
        <p className="font-mono text-[9.5px] text-grey">
          <span className="text-ink-soft">{guarantees.policyRules} policy rules</span> enforced per execution
          <span className="text-grey-faint"> · deny by default · every write simulated before it signs</span>
        </p>
      )}

      {provenance === "seed" && (
        <p className="font-mono text-[8px] text-grey-faint">
          reference agents — not live registrations
        </p>
      )}
    </div>
  );
}
