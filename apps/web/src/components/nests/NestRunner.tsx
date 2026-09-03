"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { NestEvent, NestManifest, NestRunState, TaskRecord, TaskStatus } from "@finch/sdk";
import { DartGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { ConnectNest } from "./ConnectNest";

/**
 * The nest console. A run is a DAG of tasks streamed over SSE — each task card
 * shows its finch, resolved input, output, cost, duration and tool provenance
 * as it happens. Nothing is simulated: a task that fails shows failed.
 */

const STATUS_TONE: Record<TaskStatus, { tone: "green" | "sage" | "gold" | "grey" | "red" | "ink"; label: string }> = {
  pending: { tone: "grey", label: "pending" },
  blocked: { tone: "grey", label: "blocked" },
  ready: { tone: "sage", label: "ready" },
  running: { tone: "gold", label: "running" },
  completed: { tone: "green", label: "done" },
  failed: { tone: "red", label: "failed" },
  skipped: { tone: "grey", label: "skipped" },
  cancelled: { tone: "grey", label: "cancelled" },
};

/** Group tasks into topological levels so the graph reads left-to-right. */
function levelsOf(tasks: TaskRecord[]): TaskRecord[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = new Map<string, number>();
  const compute = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const task = byId.get(id);
    const value = !task || task.dependsOn.length === 0 ? 0 : Math.max(...task.dependsOn.map((d) => compute(d, seen) + 1));
    depth.set(id, value);
    return value;
  };
  tasks.forEach((task) => compute(task.id, new Set()));
  const max = Math.max(0, ...[...depth.values()]);
  return Array.from({ length: max + 1 }, (_, level) => tasks.filter((task) => depth.get(task.id) === level));
}

function TaskCard({ task, onSelect, selected }: { task: TaskRecord; onSelect: () => void; selected: boolean }) {
  const status = STATUS_TONE[task.status];
  const running = task.status === "running";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xs border p-3 text-left transition-colors ${
        selected ? "border-ink bg-bone" : running ? "border-gold/60 bg-gold/5" : "border-line bg-bone-raised hover:border-line-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-grey-faint">
          {task.id}
        </span>
        <Badge tone={status.tone}>
          {running ? (
            <span>
              running<span style={{ animation: "finch-blink 1s steps(1) infinite" }}>▮</span>
            </span>
          ) : (
            status.label
          )}
        </Badge>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.01em] text-ink">
        <DartGlyph size={10} angle={-14} className="shrink-0 text-ink-soft" />
        {task.finchName}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-grey">{task.title}</p>
      <p className="mt-2 font-mono text-[9.5px] text-sage-deep">→ {task.outputChannel}</p>
      {(task.durationMs !== null || task.cost.outputTokens > 0) && (
        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-grey-faint tnum">
          {task.durationMs !== null ? `${(task.durationMs / 1000).toFixed(1)}s` : ""}
          {task.cost.outputTokens > 0 ? ` · ${task.cost.inputTokens}→${task.cost.outputTokens} tok` : ""}
        </p>
      )}
    </button>
  );
}

function Inspector({ task }: { task: TaskRecord }) {
  return (
    <div className="rounded-xs border border-line bg-bone-raised">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          {task.id} · {task.finchName}
        </span>
        <Badge tone={STATUS_TONE[task.status].tone}>{STATUS_TONE[task.status].label}</Badge>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-grey-faint tnum">
          {task.durationMs !== null ? `${(task.durationMs / 1000).toFixed(2)}s` : "—"} ·{" "}
          {task.cost.inputTokens}→{task.cost.outputTokens} tok
        </span>
      </header>
      <dl className="divide-y divide-line/60">
        <div className="px-4 py-3">
          <dt className="label-mono">dependencies</dt>
          <dd className="mt-1 font-mono text-[11.5px] text-ink-soft">
            {task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none — entry task"}
          </dd>
        </div>
        <div className="px-4 py-3">
          <dt className="label-mono">publishes channel</dt>
          <dd className="mt-1 font-mono text-[11.5px] text-sage-deep">{task.outputChannel}</dd>
        </div>
        {task.provenance && (
          <div className="px-4 py-3">
            <dt className="label-mono">provenance</dt>
            <dd className="mt-1 font-mono text-[11px] text-ink-soft">
              {task.provenance.provider}/{task.provenance.model}
              {task.provenance.toolSteps.length > 0 && (
                <>
                  {" · tools: "}
                  {task.provenance.toolSteps.map((step, index) => (
                    <span key={index} className={step.ok ? "text-green-deep" : "text-red-deep"}>
                      {step.name}
                      {step.ok ? "✓" : "✗"}{" "}
                    </span>
                  ))}
                </>
              )}
              {task.provenance.haltedBy && <> · halted: {task.provenance.haltedBy}</>}
            </dd>
          </div>
        )}
        {task.input && (
          <div className="px-4 py-3">
            <dt className="label-mono">resolved input — exactly what the finch saw</dt>
            <dd className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xs border border-line bg-bone p-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
              {task.input}
            </dd>
          </div>
        )}
        {task.output && (
          <div className="px-4 py-3">
            <dt className="label-mono">output</dt>
            <dd className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{task.output}</dd>
          </div>
        )}
        {task.error && (
          <div className="px-4 py-3">
            <dt className="label-mono text-red-deep">error</dt>
            <dd className="mt-1 font-mono text-[11.5px] text-red-deep">{task.error}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Sent by /api/nests/run before the first task, so the run explains its own shape. */
interface RunConfig {
  type: "run.config";
  providers: string[];
  excluded: string[];
  parallelism: { requested: number; effective: number; reason: string };
}

export function NestRunner({ manifest }: { manifest: NestManifest }) {
  // Whatever host the visitor is on — so a copied command targets the site
  // they are looking at, not a hardcoded domain that may not be theirs.
  const origin = typeof window === "undefined" ? "https://finch.fun" : window.location.origin;

  const [objective, setObjective] = useState(manifest.identity.objective);
  const [run, setRun] = useState<NestRunState | null>(null);
  // Emitted by the route before the nest starts: which providers are live,
  // which were excluded for a rejected key, and whether the run fans out or
  // goes one task at a time — and why. A run that silently went sequential
  // would look slow for no reason; this says the reason.
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error" | "not-configured">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showManifest, setShowManifest] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(false);

  const applyEvent = useCallback((event: NestEvent) => {
    if ((event as { type: string }).type === "run.config") {
      // Route-level event, not part of the SDK's union: the run's shape.
      setConfig(event as unknown as RunConfig);
    } else if (event.type === "nest.started") {
      setRun(event.run);
      setSelectedId((current) => current ?? event.run.tasks[0]?.id ?? null);
    } else if (event.type === "task.status") {
      setRun((current) => {
        if (!current) return current;
        return { ...current, tasks: current.tasks.map((task) => (task.id === event.task.id ? event.task : task)) };
      });
      if (event.task.status === "running") setSelectedId(event.task.id);
    } else if (event.type === "channel.published") {
      setRun((current) =>
        current ? { ...current, channels: { ...current.channels, [event.channel]: event.preview } } : current,
      );
    } else if (event.type === "nest.synthesis") {
      setRun((current) => (current ? { ...current, synthesis: event.text } : current));
    } else if (event.type === "nest.finished") {
      setRun(event.run);
      setPhase("done");
      finishedRef.current = true;
      if (event.run.haltReason) setMessage(event.run.haltReason);
    }
  }, []);

  const start = useCallback(async () => {
    setPhase("running");
    setMessage(null);
    setRun(null);
    setConfig(null);
    finishedRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/nests/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nest: manifest.identity.id, objective }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; configured?: boolean; hint?: string };
        if (response.status === 503 && payload.configured === false) {
          setPhase("not-configured");
          setMessage(payload.hint ?? "model compute is not configured in this environment");
          return;
        }
        setPhase("error");
        setMessage(payload.error ?? `request failed (${response.status})`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            applyEvent(JSON.parse(payload) as NestEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
      // A stream that simply ended is NOT a completed run — a platform timeout
      // or a killed function looks identical at the socket. Only an observed
      // nest.finished event means the nest actually finished.
      if (!finishedRef.current) {
        setPhase("error");
        setMessage("the run stream ended before the nest reported finishing — the result is unknown");
        return;
      }
      setPhase((current) => (current === "running" ? "done" : current));
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setPhase("done");
        setMessage("run cancelled");
        return;
      }
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "network failure");
    }
  }, [applyEvent, manifest.identity.id, objective]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const levels = useMemo(() => (run ? levelsOf(run.tasks) : []), [run]);
  const selected = run?.tasks.find((task) => task.id === selectedId) ?? null;
  const doneCount = run?.tasks.filter((task) => task.status === "completed").length ?? 0;

  return (
    <div className="rounded-xs border border-line bg-bone-raised">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-ink">
          nest/{manifest.identity.id}
        </span>
        <Badge tone="sage">read-only</Badge>
        <Badge tone="grey">{manifest.finches.length} finches</Badge>
        <Badge tone="grey">{manifest.tasks.length} tasks</Badge>
        {config && (
          <span title={config.parallelism.reason}>
            <Badge tone={config.parallelism.effective > 1 ? "green" : "grey"}>
              {config.parallelism.effective > 1 ? "parallel" : "sequential"} · {config.providers.join(" → ")}
            </Badge>
          </span>
        )}
        {run && (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-grey tnum">
            {doneCount}/{run.tasks.length} done · {run.totalCost.inputTokens}→{run.totalCost.outputTokens} tok
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowManifest((value) => !value)}
          className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-grey underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
          title="The exact document this nest runs — export it and run it yourself"
        >
          {showManifest ? "hide definition" : "definition"}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {phase === "running" ? (
            <Button variant="secondary" className="h-8 px-3" onClick={stop}>
              stop
            </Button>
          ) : (
            <Button className="h-8 px-3" onClick={start}>
              run nest →
            </Button>
          )}
        </span>
      </header>

      <div className="border-b border-line px-5 py-3">
        <label className="label-mono block" htmlFor={`objective-${manifest.identity.id}`}>
          objective — the single goal every finch is aligned to
        </label>
        <textarea
          id={`objective-${manifest.identity.id}`}
          value={objective}
          rows={2}
          onChange={(event) => setObjective(event.target.value)}
          className="mt-1.5 w-full rounded-xs border border-line bg-bone px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink focus:border-green-deep"
        />
      </div>

      {showManifest && (
        <div className="border-b border-line p-4">
          <CodeBlock title={`${manifest.identity.id}.nest.json`} code={JSON.stringify(manifest, null, 2)} />
        </div>
      )}

      {message && (
        <p
          className={`border-b border-line px-5 py-2.5 font-mono text-[11.5px] ${
            phase === "error" ? "text-red-deep" : phase === "not-configured" ? "text-gold-deep" : "text-grey"
          }`}
        >
          {message}
        </p>
      )}

      <div className="p-5">
        {!run && phase !== "running" && (
          <div className="rounded-xs border border-dashed border-line-strong p-8 text-center">
            <p className="label-mono">nest idle</p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-grey">
              Press <span className="font-mono text-ink">run nest</span> to watch {manifest.finches.length} finches
              coordinate through {manifest.tasks.length} tasks. Read-only: real chain reads, no wallet, no writes.
            </p>
          </div>
        )}

        {run && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid-paper overflow-x-auto rounded-xs border border-line p-4">
              <div className="flex min-w-[560px] items-start gap-3">
                {levels.map((level, index) => (
                  <div key={index} className="flex flex-1 flex-col gap-2">
                    <p className="label-mono text-green-deep">
                      {String(index + 1).padStart(2, "0")} · stage
                    </p>
                    {level.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={task.id === selectedId}
                        onSelect={() => setSelectedId(task.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.1em] text-grey-faint">
                stages resolve by dependency — tasks in a stage run in parallel
              </p>
            </div>

            <div className="flex flex-col gap-4">
              {selected && <Inspector task={selected} />}

              {Object.keys(run.channels).length > 0 && (
                <div className="rounded-xs border border-line bg-bone-raised p-4">
                  <p className="label-mono">channels published</p>
                  <ul className="mt-2 space-y-1">
                    {Object.entries(run.channels).map(([channel, preview]) => (
                      <li key={channel} className="font-mono text-[11px]">
                        <span className="text-sage-deep">{channel}</span>{" "}
                        <span className="text-grey-faint">— {preview.slice(0, 60).replace(/\s+/g, " ")}…</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {run?.synthesis && (
          <div className="mt-5 rounded-xs border border-green-deep/40 bg-green-wash/30 p-5">
            <p className="label-mono text-green-deep">coordinator synthesis</p>
            <div className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{run.synthesis}</div>
          </div>
        )}

        {run && phase === "done" && (
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey-faint tnum">
            run {run.runId.slice(0, 12)}… · status {run.status} · {run.totalCost.inputTokens}→
            {run.totalCost.outputTokens} tokens
            {run.haltReason ? ` · ${run.haltReason}` : ""}
          </p>
        )}
      </div>

      <ConnectNest manifest={manifest} origin={origin} />
    </div>
  );
}
