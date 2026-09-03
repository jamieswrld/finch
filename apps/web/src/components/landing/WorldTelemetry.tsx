"use client";

import { useFetch } from "@/lib/use-fetch";

/**
 * Ambient telemetry at the edges of the hero.
 *
 * This used to print invented strings — FINCH/00192, NEST 04 SYNC, PING 42ms.
 * Nothing generated them; they were set dressing that looked like data, which
 * is the one thing this project cannot ship. Everything here now comes from
 * /api/activity, and when the protocol has done nothing yet it says what the
 * engine enforces rather than inventing traffic to fill the space.
 */

interface ActivityResponse {
  provenance: "live" | "builtin";
  registryProvenance?: "live" | "builtin";
  counts: { finches: number; nests: number; runs: number; tasks: number; proofs: number };
  recent: Array<{ runId: string; kind: string; subject: string; status: string; taskCount: number; mode: string }>;
  guarantees: { policyRules: number; modes: string[] };
}

function TopologySketch({ nodes }: { nodes: number }) {
  // Five plotted positions; we light the ones the registry actually has.
  const points = [
    { x: 16, y: 96 },
    { x: 56, y: 58 },
    { x: 88, y: 24 },
    { x: 104, y: 70 },
    { x: 134, y: 40 },
  ];
  const lit = Math.min(nodes, points.length);

  return (
    <svg viewBox="0 0 150 120" className="w-[130px]" aria-hidden>
      <g stroke="#6f7268" strokeWidth="1" opacity="0.5">
        <line x1="16" y1="96" x2="56" y2="58" />
        <line x1="56" y1="58" x2="104" y2="70" />
        <line x1="56" y1="58" x2="88" y2="24" />
        <line x1="104" y1="70" x2="134" y2="40" />
        <line x1="88" y1="24" x2="134" y2="40" />
      </g>
      {points.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}`}
          cx={point.x}
          cy={point.y}
          r={index === 4 ? 3 : 2.5}
          fill={index < lit ? "#00c805" : "#6f7268"}
          opacity={index < lit ? 0.85 : 0.4}
        />
      ))}
      <text x="12" y="112" fontFamily="var(--font-geist-mono), monospace" fontSize="8" fill="#9b9e93" letterSpacing="1">
        NEST TOPOLOGY
      </text>
    </svg>
  );
}

export function WorldTelemetry() {
  const state = useFetch<ActivityResponse>("/api/activity", { refreshMs: 25_000 });
  const data = state.status === "ready" ? state.data : null;

  // Left rail: what the registry holds. Right rail: what it has executed.
  // Every count is of something that exists and runs; nothing here is a sample.
  const left = data
    ? [
        `NESTS ${data.counts.nests}`,
        `FINCHES ${data.counts.finches}`,
        `RUNS ${data.counts.runs}`,
        `TASKS ${data.counts.tasks}`,
        `PROOFS ${data.counts.proofs}`,
      ]
    : [];

  const right = data
    ? data.recent.length > 0
      ? data.recent
          .slice(0, 5)
          .map((run) => `${run.subject.slice(0, 16).toUpperCase()} ${run.status === "completed" ? "✓" : "·"}`)
      : [
          `${data.guarantees.policyRules} POLICY RULES`,
          "DENY BY DEFAULT",
          "SIMULATE → APPROVE → SIGN",
          "PROOF/FLIGHT SIGNED",
          "IDEMPOTENT EXECUTION",
        ]
    : [];

  return (
    <>
      <div className="absolute left-5 top-1/2 hidden -translate-y-1/2 flex-col gap-3 xl:flex">
        <TopologySketch nodes={data?.counts.nests ?? 0} />
        <ul className="space-y-1.5 font-mono text-[9px] text-grey opacity-70">
          {left.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="absolute right-5 top-1/2 hidden -translate-y-1/2 xl:block">
        <div className="w-[178px] border-l border-line-strong/60 pl-3">
          <p className="font-mono text-[8.5px] text-grey-faint">
            {data && data.recent.length > 0 ? "recent flights" : "engine"}
          </p>
          <ul className="mt-2 space-y-1.5 font-mono text-[9px] text-grey opacity-80">
            {right.map((line) => (
              <li key={line} className={line.includes("✓") ? "text-green-deep" : undefined}>
                {line}
              </li>
            ))}
            <li className="text-ink-soft">
              <span style={{ animation: "finch-blink 1.2s steps(1) infinite" }}>▮</span>
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
