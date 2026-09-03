"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { NestDoc, NestNode } from "@finch/db";
import { Badge, DataBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlocks";
import { Field, TextInput } from "@/components/build/fields";
import { slugify } from "@/components/build/draft";
import { liftComposedNest } from "@/lib/compose-to-nest";
import { useFetch } from "@/lib/use-fetch";
import { NestCanvas } from "./NestCanvas";

interface NestsResponse {
  source: "db" | "seed";
  degraded?: boolean;
  note?: string;
  nests: NestDoc[];
}

const PERMISSION_PRESETS = [
  "read:web",
  "read:prices",
  "read:portfolio",
  "veto:execution",
  "wallet:operator",
  "contracts:allowlist",
];

function newNestTemplate(): NestDoc {
  const now = new Date().toISOString();
  return {
    slug: `nest-${Math.random().toString(36).slice(2, 7)}`,
    name: "Untitled Nest",
    description: "",
    stages: [
      { id: "stage-1", name: "Signals", finches: [] },
      { id: "stage-2", name: "Execution", finches: [] },
    ],
    edges: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/** Topological routing preview — static analysis only, nothing executes. */
function routingPreview(nest: NestDoc): string[] {
  const inbound = new Map<string, number>();
  const all = nest.stages.flatMap((stage) => stage.finches.map((finch) => finch.handle));
  for (const handle of all) inbound.set(handle, 0);
  for (const edge of nest.edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  const queue = all.filter((handle) => (inbound.get(handle) ?? 0) === 0);
  const order: string[] = [];
  const remaining = [...nest.edges];
  while (queue.length > 0) {
    const handle = queue.shift() as string;
    order.push(handle);
    for (const edge of remaining.filter((candidate) => candidate.from === handle)) {
      const count = (inbound.get(edge.to) ?? 1) - 1;
      inbound.set(edge.to, count);
      if (count === 0) queue.push(edge.to);
    }
  }
  const lines = nest.edges.map((edge) => `${edge.from} —${edge.channel}→ ${edge.to}`);
  const unreachable = all.filter((handle) => !order.includes(handle));
  if (unreachable.length > 0) lines.push(`⚠ cycle or orphan: ${unreachable.join(", ")}`);
  return lines;
}

export function NestComposer() {
  const state = useFetch<NestsResponse>("/api/nests");
  const searchParams = useSearchParams();
  const [nest, setNest] = useState<NestDoc | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{
    phase: "idle" | "saving" | "saved" | "unsaved-nodb" | "error" | "lifted";
    message?: string;
  }>({ phase: "idle" });

  // A finch handed over from the Aviary or Flight School (?finch=<handle>).
  // The controls that navigate here promise the finch comes with them, so it
  // is seeded into a fresh nest rather than dropped on the floor.
  const carried = searchParams.get("finch");

  useEffect(() => {
    if (state.status !== "ready" || nest) return;

    if (carried && /^[a-z0-9-]{2,64}$/.test(carried)) {
      const draft = newNestTemplate();
      draft.name = `Nest with ${carried}`;
      const firstStage = draft.stages[0];
      if (firstStage) {
        firstStage.finches.push({
          handle: carried,
          name: carried,
          role: "",
          inputs: [],
          outputs: [],
          permissions: [],
        });
      }
      setNest(draft);
      setSelectedSlug(null);
      setSaveState({ phase: "idle", message: `${carried} added — give it a role, then save the nest.` });
      return;
    }

    const preset = searchParams.get("preset");
    const initial =
      (preset && state.data.nests.find((candidate) => candidate.slug === preset)) ?? state.data.nests[0];
    if (initial) {
      setNest(structuredClone(initial));
      setSelectedSlug(initial.slug);
    }
  }, [state, nest, searchParams, carried]);

  const preview = useMemo(() => (nest ? routingPreview(nest) : []), [nest]);

  if (state.status === "loading") return <LoadingBlock label="loading nests" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const selectNest = (slug: string) => {
    const found = state.data.nests.find((candidate) => candidate.slug === slug);
    if (found) {
      setNest(structuredClone(found));
      setSelectedSlug(slug);
      setSaveState({ phase: "idle" });
    }
  };

  const mutate = (patch: (draft: NestDoc) => void) => {
    setNest((current) => {
      if (!current) return current;
      const draft = structuredClone(current);
      patch(draft);
      draft.updatedAt = new Date().toISOString();
      return draft;
    });
    setSaveState({ phase: "idle" });
  };

  async function saveNest(): Promise<void> {
    if (!nest) return;
    setSaveState({ phase: "saving" });
    try {
      const response = await fetch("/api/nests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: nest.slug,
          name: nest.name,
          description: nest.description,
          stages: nest.stages,
          edges: nest.edges,
        }),
      });
      const payload = (await response.json()) as { saved?: boolean; error?: string; note?: string };
      if (!response.ok && payload.error) {
        setSaveState({ phase: "error", message: payload.error });
        return;
      }
      setSaveState(payload.saved ? { phase: "saved" } : { phase: "unsaved-nodb", message: payload.note });
    } catch (error) {
      setSaveState({ phase: "error", message: error instanceof Error ? error.message : "network failure" });
    }
  }

  function exportRunnableNest(): void {
    if (!nest) return;
    const lifted = liftComposedNest(nest);
    if (!lifted.ok) {
      setSaveState({
        phase: "error",
        message: `cannot lift to a runnable nest: ${lifted.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
      });
      return;
    }
    const blob = new Blob([JSON.stringify(lifted.manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${nest.slug}.nest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveState({
      phase: "lifted",
      message:
        lifted.notes.length > 0
          ? `exported a runnable nest.manifest/0.1 — ${lifted.notes.join(" ")}`
          : "exported a runnable nest.manifest/0.1 — run it with runNest() from @finch/sdk",
    });
  }

  function exportNest(): void {
    if (!nest) return;
    const blob = new Blob([JSON.stringify(nest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${nest.slug}.diagram.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* nest switcher */}
      <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
        {state.data.nests.map((candidate) => (
          <button
            key={candidate.slug}
            type="button"
            onClick={() => selectNest(candidate.slug)}
            className={`rounded-xs border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
              selectedSlug === candidate.slug
                ? "border-ink bg-ink text-bone"
                : "border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            {candidate.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const fresh = newNestTemplate();
            setNest(fresh);
            setSelectedSlug(null);
            setSaveState({ phase: "idle" });
          }}
          className="rounded-xs border border-dashed border-line-strong px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-grey hover:border-green-deep hover:text-green-deep"
        >
          + custom nest
        </button>
        <span className="ml-auto flex items-center gap-2">
          <span title="Simulate and Live modes activate with the Robinhood execution release.">
            <Badge tone="sage">mode · preview</Badge>
          </span>
          <DataBadge source={state.data.source === "db" ? "db" : "seed"} />
          {state.data.note && <span className="text-[11px] text-gold-deep">{state.data.note}</span>}
        </span>
      </div>

      {!nest ? (
        <div className="mt-8">
          <EmptyBlock title="no nest selected">Pick a preset above or start a custom nest.</EmptyBlock>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {/* meta */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="nest name" htmlFor="fb-name">
              <TextInput
                id="fb-name"
                value={nest.name}
                onChange={(event) =>
                  mutate((draft) => {
                    draft.name = event.target.value;
                    if (!selectedSlug) draft.slug = slugify(event.target.value) || draft.slug;
                  })
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="objective" htmlFor="fb-desc">
                <TextInput
                  id="fb-desc"
                  value={nest.description}
                  placeholder="e.g. monitor pons launches and detect unusual activity"
                  onChange={(event) => mutate((draft) => void (draft.description = event.target.value))}
                />
              </Field>
            </div>
          </div>

          <NestCanvas
            nest={nest}
            editable
            onRemoveFinch={(stageId, handle) =>
              mutate((draft) => {
                const stage = draft.stages.find((candidate) => candidate.id === stageId);
                if (stage) stage.finches = stage.finches.filter((finch) => finch.handle !== handle);
                draft.edges = draft.edges.filter((edge) => edge.from !== handle && edge.to !== handle);
              })
            }
          />

          <AddFinchForm nest={nest} mutate={mutate} />

          {/* routing preview */}
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono flex items-center gap-2">
              routing preview <Badge tone="grey">static analysis — nothing executes</Badge>
            </p>
            {preview.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-grey">Connect finches to see the message routing.</p>
            ) : (
              <ol className="mt-3 space-y-1.5">
                {preview.map((line) => (
                  <li key={line} className={`font-mono text-[12px] ${line.startsWith("⚠") ? "text-gold-deep" : "text-ink-soft"}`}>
                    {line}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* save */}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveNest} disabled={saveState.phase === "saving"}>
              {saveState.phase === "saving" ? "saving…" : "Save Nest"}
            </Button>
            <Button variant="secondary" onClick={exportRunnableNest}>
              export runnable nest.json
            </Button>
            <Button variant="secondary" onClick={exportNest}>
              export diagram
            </Button>
            {saveState.phase === "saved" && <span className="font-mono text-[11.5px] text-green-deep">draft saved to registry</span>}
            {saveState.phase === "unsaved-nodb" && (
              <span className="font-mono text-[11.5px] text-gold-deep">
                {saveState.message ?? "no database configured — use export instead"}
              </span>
            )}
            {saveState.phase === "lifted" && (
              <span className="font-mono text-[11.5px] text-green-deep">{saveState.message}</span>
            )}
            {saveState.phase === "error" && <span className="font-mono text-[11.5px] text-red-deep">{saveState.message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddFinchForm({ nest, mutate }: { nest: NestDoc; mutate: (patch: (draft: NestDoc) => void) => void }) {
  const [stageId, setStageId] = useState(nest.stages[0]?.id ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [outputs, setOutputs] = useState("");
  const [source, setSource] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [newStageName, setNewStageName] = useState("");

  useEffect(() => {
    if (!nest.stages.some((stage) => stage.id === stageId)) {
      setStageId(nest.stages[0]?.id ?? "");
    }
  }, [nest, stageId]);

  const stageIndex = nest.stages.findIndex((stage) => stage.id === stageId);
  const previousStage = stageIndex > 0 ? nest.stages[stageIndex - 1] : undefined;

  const addFinch = () => {
    if (name.trim().length < 2 || !stageId) return;
    const handleBase = slugify(name) || "finch";
    mutate((draft) => {
      const existing = new Set(draft.stages.flatMap((stage) => stage.finches.map((finch) => finch.handle)));
      let handle = handleBase;
      let suffix = 2;
      while (existing.has(handle)) handle = `${handleBase}-${suffix++}`;

      const sourceFinch = previousStage?.finches.find((finch) => finch.handle === source);
      const channel = sourceFinch?.outputs[0] ?? (sourceFinch ? `${sourceFinch.handle}.out` : "");
      const node: NestNode = {
        handle,
        name: name.trim(),
        role: role.trim() || "—",
        inputs: sourceFinch ? [channel] : [],
        outputs: outputs
          .split(",")
          .map((output) => output.trim())
          .filter(Boolean),
        permissions,
      };
      const stage = draft.stages.find((candidate) => candidate.id === stageId);
      stage?.finches.push(node);
      if (sourceFinch) draft.edges.push({ from: sourceFinch.handle, to: handle, channel });
    });
    setName("");
    setRole("");
    setOutputs("");
    setSource("");
    setPermissions([]);
  };

  return (
    <div className="rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono">add a finch</p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="stage" htmlFor="fb-stage">
          <select
            id="fb-stage"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className="h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12.5px] text-ink focus:border-green-deep"
          >
            {nest.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="name" htmlFor="fb-finch-name">
          <TextInput id="fb-finch-name" value={name} placeholder="Risk Finch" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="role" htmlFor="fb-role">
          <TextInput id="fb-role" value={role} placeholder="Checks limits; can veto." onChange={(event) => setRole(event.target.value)} />
        </Field>
        <Field label="outputs — comma separated" htmlFor="fb-outputs">
          <TextInput id="fb-outputs" value={outputs} placeholder="risk.approval" onChange={(event) => setOutputs(event.target.value)} />
        </Field>
        <Field
          label="input from — previous stage"
          htmlFor="fb-source"
          hint={previousStage ? undefined : "First-stage finches take external triggers as input."}
        >
          <select
            id="fb-source"
            value={source}
            disabled={!previousStage || previousStage.finches.length === 0}
            onChange={(event) => setSource(event.target.value)}
            className="h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12.5px] text-ink focus:border-green-deep disabled:opacity-45"
          >
            <option value="">none</option>
            {previousStage?.finches.map((finch) => (
              <option key={finch.handle} value={finch.handle}>
                {finch.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="permissions">
            <div className="flex flex-wrap gap-1.5">
              {PERMISSION_PRESETS.map((preset) => {
                const active = permissions.includes(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setPermissions((current) =>
                        active ? current.filter((permission) => permission !== preset) : [...current, preset],
                      )
                    }
                    className={`rounded-xs border px-2 py-1 font-mono text-[10.5px] transition-colors ${
                      active ? "border-green-deep bg-green-wash/50 text-green-deep" : "border-line text-grey hover:border-line-strong"
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" onClick={addFinch} disabled={name.trim().length < 2}>
            add finch
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <div className="w-56">
          <Field label="new stage" htmlFor="fb-new-stage">
            <TextInput
              id="fb-new-stage"
              value={newStageName}
              placeholder="Analysis"
              onChange={(event) => setNewStageName(event.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          disabled={newStageName.trim().length < 2}
          onClick={() => {
            mutate((draft) => {
              draft.stages.push({ id: `stage-${Date.now().toString(36)}`, name: newStageName.trim(), finches: [] });
            });
            setNewStageName("");
          }}
        >
          add stage
        </Button>
      </div>
    </div>
  );
}
