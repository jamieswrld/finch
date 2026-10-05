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
import { SwarmCanvas } from "./SwarmCanvas";

interface SwarmsResponse {
  source: "db" | "builtin";
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
  "programs:allowlist",
];

function newSwarmTemplate(): NestDoc {
  const now = new Date().toISOString();
  return {
    slug: `swarm-${Math.random().toString(36).slice(2, 7)}`,
    name: "Untitled Swarm",
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
function routingPreview(swarm: NestDoc): string[] {
  const inbound = new Map<string, number>();
  const all = swarm.stages.flatMap((stage) => stage.finches.map((agent) => agent.handle));
  for (const handle of all) inbound.set(handle, 0);
  for (const edge of swarm.edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  const queue = all.filter((handle) => (inbound.get(handle) ?? 0) === 0);
  const order: string[] = [];
  const remaining = [...swarm.edges];
  while (queue.length > 0) {
    const handle = queue.shift() as string;
    order.push(handle);
    for (const edge of remaining.filter((candidate) => candidate.from === handle)) {
      const count = (inbound.get(edge.to) ?? 1) - 1;
      inbound.set(edge.to, count);
      if (count === 0) queue.push(edge.to);
    }
  }
  const lines = swarm.edges.map((edge) => `${edge.from} —${edge.channel}→ ${edge.to}`);
  const unreachable = all.filter((handle) => !order.includes(handle));
  if (unreachable.length > 0) lines.push(`⚠ cycle or orphan: ${unreachable.join(", ")}`);
  return lines;
}

export function SwarmComposer() {
  const state = useFetch<SwarmsResponse>("/api/swarms");
  const searchParams = useSearchParams();
  const [swarm, setSwarm] = useState<NestDoc | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{
    phase: "idle" | "saving" | "saved" | "unsaved-nodb" | "error" | "lifted";
    message?: string;
  }>({ phase: "idle" });

  // An agent handed over from the directory or the playground (?agent=<handle>;
  // older links used ?finch=, which is still honoured). The controls that
  // navigate here promise the agent comes with them, so it is seeded into a
  // fresh swarm rather than dropped on the floor.
  const carried = searchParams.get("agent") ?? searchParams.get("finch");

  useEffect(() => {
    if (state.status !== "ready" || swarm) return;

    if (carried && /^[a-z0-9-]{2,64}$/.test(carried)) {
      const draft = newSwarmTemplate();
      draft.name = `Swarm with ${carried}`;
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
      setSwarm(draft);
      setSelectedSlug(null);
      setSaveState({ phase: "idle", message: `${carried} added — give it a role, then save the swarm.` });
      return;
    }

    const preset = searchParams.get("preset");
    const initial =
      (preset && state.data.nests.find((candidate) => candidate.slug === preset)) ?? state.data.nests[0];
    if (initial) {
      setSwarm(structuredClone(initial));
      setSelectedSlug(initial.slug);
    }
  }, [state, swarm, searchParams, carried]);

  const preview = useMemo(() => (swarm ? routingPreview(swarm) : []), [swarm]);

  if (state.status === "loading") return <LoadingBlock label="loading swarms" />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={state.retry} />;

  const selectSwarm = (slug: string) => {
    const found = state.data.nests.find((candidate) => candidate.slug === slug);
    if (found) {
      setSwarm(structuredClone(found));
      setSelectedSlug(slug);
      setSaveState({ phase: "idle" });
    }
  };

  const mutate = (patch: (draft: NestDoc) => void) => {
    setSwarm((current) => {
      if (!current) return current;
      const draft = structuredClone(current);
      patch(draft);
      draft.updatedAt = new Date().toISOString();
      return draft;
    });
    setSaveState({ phase: "idle" });
  };

  async function saveSwarm(): Promise<void> {
    if (!swarm) return;
    setSaveState({ phase: "saving" });
    try {
      const response = await fetch("/api/swarms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: swarm.slug,
          name: swarm.name,
          description: swarm.description,
          stages: swarm.stages,
          edges: swarm.edges,
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

  function exportRunnableSwarm(): void {
    if (!swarm) return;
    const lifted = liftComposedNest(swarm);
    if (!lifted.ok) {
      setSaveState({
        phase: "error",
        message: `cannot lift to a runnable swarm: ${lifted.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
      });
      return;
    }
    const blob = new Blob([JSON.stringify(lifted.manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${swarm.slug}.swarm.json`;
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

  function exportSwarm(): void {
    if (!swarm) return;
    const blob = new Blob([JSON.stringify(swarm, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${swarm.slug}.diagram.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* swarm switcher */}
      <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
        {state.data.nests.map((candidate) => (
          <button
            key={candidate.slug}
            type="button"
            onClick={() => selectSwarm(candidate.slug)}
            className={`rounded-xs border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
              selectedSlug === candidate.slug
                ?"border-ink bg-ink text-bone"
                : "border-line text-ink-soft hover:border-line-strong"
            }`}
          >
            {candidate.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const fresh = newSwarmTemplate();
            setSwarm(fresh);
            setSelectedSlug(null);
            setSaveState({ phase: "idle" });
          }}
          className="rounded-xs border border-dashed border-line-strong px-2.5 py-1.5 font-mono text-[11px] text-grey hover:border-green-deep hover:text-green-deep"
        >
          + custom swarm
        </button>
        <span className="ml-auto flex items-center gap-2">
          <span title="Composed swarms run in preview: read-only, no wallet, no writes.">
            <Badge tone="sage">read-only</Badge>
          </span>
          <DataBadge source={state.data.source === "db" ? "db" : "builtin"} />
          {state.data.note && <span className="text-[11px] text-gold-deep">{state.data.note}</span>}
        </span>
      </div>

      {!swarm ? (
        <div className="mt-8">
          <EmptyBlock title="no swarm selected">Pick a preset above or start a custom swarm.</EmptyBlock>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {/* meta */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="swarm name" htmlFor="fb-name">
              <TextInput
                id="fb-name"
                value={swarm.name}
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
                  value={swarm.description}
                  placeholder="e.g. monitor new solana token launches and detect unusual activity"
                  onChange={(event) => mutate((draft) => void (draft.description = event.target.value))}
                />
              </Field>
            </div>
          </div>

          <SwarmCanvas
            swarm={swarm}
            editable
            onRemoveAgent={(stageId, handle) =>
              mutate((draft) => {
                const stage = draft.stages.find((candidate) => candidate.id === stageId);
                if (stage) stage.finches = stage.finches.filter((agent) => agent.handle !== handle);
                draft.edges = draft.edges.filter((edge) => edge.from !== handle && edge.to !== handle);
              })
            }
          />

          <AddAgentForm swarm={swarm} mutate={mutate} />

          {/* routing preview */}
          <div className="rounded-xs border border-line bg-bone-raised p-5">
            <p className="label-mono flex items-center gap-2">
              routing preview <Badge tone="grey">static analysis — nothing executes</Badge>
            </p>
            {preview.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-grey">Connect agents to see the message routing.</p>
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
            <Button onClick={saveSwarm} disabled={saveState.phase === "saving"}>
              {saveState.phase === "saving" ? "saving…" : "Save swarm"}
            </Button>
            <Button variant="secondary" onClick={exportRunnableSwarm} title="Downloads the runnable swarm.json — run it yourself with runNest() from @finch/sdk">
              Export swarm
            </Button>
            <Button variant="secondary" onClick={exportSwarm}>
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

function AddAgentForm({ swarm, mutate }: { swarm: NestDoc; mutate: (patch: (draft: NestDoc) => void) => void }) {
  const [stageId, setStageId] = useState(swarm.stages[0]?.id ?? "");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [outputs, setOutputs] = useState("");
  const [source, setSource] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [newStageName, setNewStageName] = useState("");

  useEffect(() => {
    if (!swarm.stages.some((stage) => stage.id === stageId)) {
      setStageId(swarm.stages[0]?.id ?? "");
    }
  }, [swarm, stageId]);

  const stageIndex = swarm.stages.findIndex((stage) => stage.id === stageId);
  const previousStage = stageIndex > 0 ? swarm.stages[stageIndex - 1] : undefined;

  const addAgent = () => {
    if (name.trim().length < 2 || !stageId) return;
    const handleBase = slugify(name) || "agent";
    mutate((draft) => {
      const existing = new Set(draft.stages.flatMap((stage) => stage.finches.map((agent) => agent.handle)));
      let handle = handleBase;
      let suffix = 2;
      while (existing.has(handle)) handle = `${handleBase}-${suffix++}`;

      const sourceAgent = previousStage?.finches.find((agent) => agent.handle === source);
      const channel = sourceAgent?.outputs[0] ?? (sourceAgent ? `${sourceAgent.handle}.out` : "");
      const node: NestNode = {
        handle,
        name: name.trim(),
        role: role.trim() || "—",
        inputs: sourceAgent ? [channel] : [],
        outputs: outputs
          .split(",")
          .map((output) => output.trim())
          .filter(Boolean),
        permissions,
      };
      const stage = draft.stages.find((candidate) => candidate.id === stageId);
      stage?.finches.push(node);
      if (sourceAgent) draft.edges.push({ from: sourceAgent.handle, to: handle, channel });
    });
    setName("");
    setRole("");
    setOutputs("");
    setSource("");
    setPermissions([]);
  };

  return (
    <div className="rounded-xs border border-line bg-bone-raised p-5">
      <p className="label-mono">add an agent</p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="stage" htmlFor="fb-stage">
          <select
            id="fb-stage"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
            className="h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12.5px] text-ink focus:border-green-deep"
          >
            {swarm.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="name" htmlFor="fb-agent-name">
          <TextInput id="fb-agent-name" value={name} placeholder="Risk Agent" onChange={(event) => setName(event.target.value)} />
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
          hint={previousStage ? undefined : "First-stage agents take external triggers as input."}
        >
          <select
            id="fb-source"
            value={source}
            disabled={!previousStage || previousStage.finches.length === 0}
            onChange={(event) => setSource(event.target.value)}
            className="h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12.5px] text-ink focus:border-green-deep disabled:opacity-45"
          >
            <option value="">none</option>
            {previousStage?.finches.map((agent) => (
              <option key={agent.handle} value={agent.handle}>
                {agent.name}
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
                      active ?"border-green-deep bg-green-wash/50 text-green-deep" : "border-line text-grey hover:border-line-strong"
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
          <Button variant="secondary" onClick={addAgent} disabled={name.trim().length < 2}>
            add agent
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
