"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { SignPanel, type PreparedExecution } from "./SignPanel";
import { DartGlyph, FinchGlyph } from "@/components/birds/FinchGlyph";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { SCHOOL_PRESETS, type SchoolPreset } from "@/lib/school-presets";

interface TraceStep {
  type: string;
  name?: string;
  ok: boolean;
  at?: string;
  args?: Record<string, unknown>;
  result?: string;
}

type RunState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; output: string | null; haltedBy?: string; error?: string; steps: TraceStep[]; usage: { inputTokens: number; outputTokens: number }; executions: PreparedExecution[]; mode: string }
  | { phase: "not-configured"; hint?: string }
  | { phase: "error"; message: string };

function PresetGrid({ onSelect }: { onSelect: (preset: SchoolPreset) => void }) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {SCHOOL_PRESETS.map((preset) => (
        <button
          key={preset.slug}
          type="button"
          onClick={() => onSelect(preset)}
          className="group bg-bone-raised p-5 text-left transition-colors hover:bg-bone"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-ink">{preset.title}</span>
            <Badge tone="sage">read-only</Badge>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-soft">{preset.blurb}</p>
          <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-green-deep opacity-0 transition-opacity group-hover:opacity-100">
            open →
          </p>
        </button>
      ))}
      <Link href="/app/nests" className="group bg-ink p-5 text-left text-bone transition-colors hover:bg-green-deep">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em]">Build a Nest</span>
          <DartGlyph size={12} angle={-14} className="text-green group-hover:text-bone" />
        </div>
        <p className="mt-2 text-[13px] leading-snug text-bone/70">Combine multiple finches around one objective.</p>
        <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.1em]">open →</p>
      </Link>
    </div>
  );
}

function Console({ preset, onBack }: { preset: SchoolPreset; onBack: () => void }) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const { address } = useAccount();
  const [showManifest, setShowManifest] = useState(false);

  async function run(prompt?: string): Promise<void> {
    const text = (prompt ?? input).trim();
    if (!text || state.phase === "running") return;
    if (prompt) setInput(prompt);
    setState({ phase: "running" });
    try {
      const response = await fetch("/api/school/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signer: address ?? undefined, preset: preset.slug, input: text }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (response.status === 503 && payload.configured === false) {
        setState({ phase: "not-configured", hint: payload.hint as string | undefined });
        return;
      }
      if (!response.ok) {
        setState({ phase: "error", message: (payload.error as string) ?? `request failed (${response.status})` });
        return;
      }
      setState({
        phase: "done",
        output: (payload.output as string | null) ?? null,
        haltedBy: payload.haltedBy as string | undefined,
        executions: (payload.executions as PreparedExecution[] | undefined) ?? [],
        mode: (payload.mode as string | undefined) ?? "preview",
        error: payload.error as string | undefined,
        steps: (payload.steps as TraceStep[]) ?? [],
        usage: (payload.usage as { inputTokens: number; outputTokens: number }) ?? { inputTokens: 0, outputTokens: 0 },
      });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : "network failure" });
    }
  }

  return (
    <div className="rounded-xs border border-line bg-bone-raised">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <button type="button" onClick={onBack} className="font-mono text-[11px] uppercase tracking-[0.1em] text-grey hover:text-ink">
          ← school
        </button>
        <span className="h-4 w-px bg-line-strong" aria-hidden />
        <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-ink">
          {preset.title}
        </span>
        <Badge tone="sage">read only</Badge>
        <button
          type="button"
          onClick={() => setShowManifest((value) => !value)}
          className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-grey underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
          title="The exact document this finch runs — fork it and run it yourself"
        >
          {showManifest ? "hide definition" : "definition"}
        </button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/app/build?school=${preset.slug}`}
            className="rounded-xs border border-line-strong px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft hover:border-green-deep hover:text-green-deep"
          >
            fork this finch
          </Link>
          <Link
            href={`/app/nests?tab=compose&finch=${preset.slug}`}
            className="rounded-xs border border-line-strong px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-soft hover:border-green-deep hover:text-green-deep"
          >
            add to nest
          </Link>
        </span>
      </header>

      {showManifest && (
        <div className="border-b border-line p-4">
          <CodeBlock title={`${preset.slug}.finch.json`} code={JSON.stringify(preset.manifest, null, 2)} />
        </div>
      )}

      <div className="p-5">
        <div className="flex flex-wrap gap-1.5">
          {preset.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => run(prompt)}
              className="rounded-xs border border-line px-2 py-1 font-mono text-[10.5px] text-ink-soft transition-colors hover:border-green-deep hover:text-green-deep"
            >
              {prompt}
            </button>
          ))}
        </div>

        <form
          className="mt-4 flex items-center gap-2 rounded-xs border border-line bg-bone px-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <span className="font-mono text-[13px] text-green-deep" aria-hidden>
            &gt;
          </span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={`ask ${preset.title.toLowerCase()}…`}
            aria-label={`Ask ${preset.title}`}
            className="h-11 w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-grey-faint"
          />
          <Button type="submit" variant="secondary" className="h-8 px-3" disabled={state.phase === "running"}>
            {state.phase === "running" ? "flying…" : "run"}
          </Button>
        </form>

        <div className="mt-4" aria-live="polite">
          {state.phase === "running" && (
            <p className="font-mono text-[11.5px] text-grey">
              hatching preset → running
              <span style={{ animation: "finch-blink 1.2s steps(1) infinite" }}> ▮</span>
            </p>
          )}

          {state.phase === "not-configured" && (
            <div className="rounded-xs border border-gold/50 bg-gold/10 p-4">
              <p className="label-mono text-gold-deep">compute not configured</p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
                This environment has no model provider key, so previews can't run — nothing is faked instead.
                {state.hint && <span className="mt-1 block font-mono text-[11.5px] text-grey">{state.hint}</span>}
              </p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="rounded-xs border border-red-deep/40 bg-red-wash/50 p-4">
              <p className="label-mono text-red-deep">run failed</p>
              <p className="mt-1.5 font-mono text-[11.5px] text-ink-soft">{state.message}</p>
            </div>
          )}

          {state.phase === "done" && (
            <div className="space-y-3">
              {state.output ? (
                <div className="rounded-xs border border-line bg-bone p-4">
                  <p className="label-mono mb-2">response</p>
                  <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{state.output}</div>
                </div>
              ) : (
                <div className="rounded-xs border border-gold/50 bg-gold/10 p-4">
                  <p className="label-mono text-gold-deep">halted: {state.haltedBy}</p>
                  {state.error && <p className="mt-1.5 font-mono text-[11.5px] text-ink-soft">{state.error}</p>}
                </div>
              )}
              <details className="rounded-xs border border-line bg-bone">
                <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-grey">
                  audit trail — {state.steps.filter((step) => step.type === "tool").length} tool call
                  {state.steps.filter((step) => step.type === "tool").length === 1 ? "" : "s"} ·{" "}
                  <span className="tnum">
                    {state.usage.inputTokens}→{state.usage.outputTokens} tokens
                  </span>
                </summary>
                <ol className="divide-y divide-line/60 border-t border-line">
                  {state.executions
                    .filter((execution) => execution.state === "awaiting_signature")
                    .map((execution) => (
                      <div key={execution.id} className="mb-4">
                        <SignPanel execution={execution} />
                      </div>
                    ))}
                  {state.steps.map((step, index) => (
                    <li key={index} className="px-3 py-2.5">
                      <p className="flex items-center gap-2 font-mono text-[11px]">
                        <span className={step.ok ? "text-green-deep" : "text-red-deep"}>{step.ok ? "✓" : "✗"}</span>
                        <span className="text-ink">{step.type === "tool" ? step.name : "model"}</span>
                      </p>
                      {step.args && Object.keys(step.args).length > 0 && (
                        <p className="mt-1 break-all font-mono text-[10.5px] text-grey">
                          called with {JSON.stringify(step.args)}
                        </p>
                      )}
                      {step.result && (
                        <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-ink-soft">
                          {step.result}
                        </pre>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SchoolConsole() {
  const [selected, setSelected] = useState<SchoolPreset | null>(null);
  return (
    <div>
      {selected ? (
        <Console preset={selected} onBack={() => setSelected(null)} />
      ) : (
        <PresetGrid onSelect={setSelected} />
      )}
      <p className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-grey-faint">
        <FinchGlyph size={13} className="text-grey-faint" />
        no wallet required — previews are read-only and run on the same runtime developers use
      </p>
    </div>
  );
}
