import { z } from "zod";
import type { ModelProvider } from "@finch/providers";
import { finchManifestSchema, type FinchManifest } from "./manifest.ts";
import { Nest, type HatchOptions } from "./runtime.ts";

/**
 * nest.manifest/0.1 — the portable description of a COORDINATED SWARM.
 *
 * A nest is not a workspace: it is many specialized finches aligned around one
 * objective by a task graph. This document is the nest's whole definition —
 * objective, member finches (each a full portable finch manifest), the task
 * graph with typed channels, permissions, execution policy and budgets. Like
 * finch.json it is inert data: import it, fork it, self-host it, publish it.
 */

export const nestTaskSchema = z.object({
  id: z.string().min(1).max(64),
  /** Handle of a finch declared in this nest. */
  finch: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  /**
   * What this task asks its finch to do. May reference upstream channels with
   * {{channel}} — the coordinator substitutes the producing task's output.
   */
  instruction: z.string().min(1).max(4000),
  dependsOn: z.array(z.string()).default([]),
  /** Typed channel this task publishes on, e.g. "pons.launches". */
  outputChannel: z.string().min(1).max(80),
});

export const nestFinchSchema = z.object({
  handle: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  role: z.string().max(200).default(""),
  /** The member's own portable finch manifest — runs on the standard runtime. */
  manifest: finchManifestSchema,
});

export const nestExecutionPolicySchema = z.object({
  /** preview = read-only, no wallet. simulate/live require Flightpath + policy. */
  mode: z.enum(["preview", "simulate", "live"]).default("preview"),
  maxParallel: z.number().int().positive().max(8).default(3),
  maxTotalTokens: z.number().int().positive().max(2_000_000).default(120_000),
  /** Halt the whole nest after this many task failures. */
  maxTaskFailures: z.number().int().positive().max(20).default(2),
  taskTimeoutMs: z.number().int().positive().max(600_000).default(120_000),
});

export const nestManifestSchema = z.object({
  schema: z.literal("nest.manifest/0.1").default("nest.manifest/0.1"),
  identity: z.object({
    id: z.string().min(2).max(64),
    name: z.string().min(2).max(80),
    /** The single objective every member finch is aligned to. */
    objective: z.string().min(4).max(600),
    description: z.string().max(400).default(""),
  }),
  coordinator: z.object({
    /** Model that decomposes/synthesizes. Same provider abstraction as finches. */
    model: z.object({ provider: z.string(), model: z.string(), temperature: z.number().min(0).max(2).optional() }),
    instructions: z.string().max(4000).default(""),
    /** Ask the coordinator to synthesize a final answer from terminal channels. */
    synthesize: z.boolean().default(true),
  }),
  finches: z.array(nestFinchSchema).min(1).max(24),
  tasks: z.array(nestTaskSchema).min(1).max(48),
  executionPolicy: nestExecutionPolicySchema.default({}),
  publisher: z.string().optional(),
  sourceRepository: z.string().max(300).optional(),
  createdAt: z.string().optional(),
});

export type NestTask = z.infer<typeof nestTaskSchema>;
export type NestFinch = z.infer<typeof nestFinchSchema>;
export type NestManifest = z.infer<typeof nestManifestSchema>;
export type NestManifestInput = z.input<typeof nestManifestSchema>;

export function validateNestManifest(candidate: unknown): NestManifest {
  return nestManifestSchema.parse(candidate);
}

export function safeValidateNestManifest(candidate: unknown):
  | { ok: true; manifest: NestManifest }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const result = nestManifestSchema.safeParse(candidate);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}

// ── Task records ──────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/** The full provenance record for one task. Everything an auditor needs. */
export interface TaskRecord {
  id: string;
  nestRunId: string;
  finch: string;
  finchName: string;
  title: string;
  outputChannel: string;
  dependsOn: string[];
  status: TaskStatus;
  /** Resolved instruction after channel substitution — exactly what the finch saw. */
  input: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  cost: { inputTokens: number; outputTokens: number };
  provenance: {
    model: string;
    provider: string;
    toolSteps: Array<{ name: string; ok: boolean }>;
    haltedBy?: string;
  } | null;
}

export type NestRunStatus = "running" | "completed" | "halted" | "failed";

export interface NestRunState {
  runId: string;
  nestId: string;
  objective: string;
  mode: "preview" | "simulate" | "live";
  status: NestRunStatus;
  tasks: TaskRecord[];
  channels: Record<string, string>;
  synthesis: string | null;
  totalCost: { inputTokens: number; outputTokens: number };
  startedAt: string;
  finishedAt: string | null;
  haltReason?: string;
}

export type NestEvent =
  | { type: "nest.started"; run: NestRunState }
  | { type: "task.status"; task: TaskRecord }
  | { type: "channel.published"; channel: string; fromTask: string; preview: string }
  | { type: "nest.synthesis"; text: string }
  | { type: "nest.finished"; run: NestRunState };

// ── Graph validation ──────────────────────────────────────────────────────

export interface GraphIssue {
  code:
    | "unknown_finch"
    | "unknown_dependency"
    | "cycle"
    | "duplicate_task"
    | "duplicate_channel"
    | "unknown_channel"
    | "unreachable_channel";
  detail: string;
}

/** Static analysis of the task graph. Run before execution; never execute a bad graph. */
export function validateTaskGraph(manifest: NestManifest): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const finchHandles = new Set(manifest.finches.map((finch) => finch.handle));
  const taskIds = new Set<string>();
  const channels = new Set<string>();

  for (const task of manifest.tasks) {
    if (taskIds.has(task.id)) issues.push({ code: "duplicate_task", detail: `task id "${task.id}" appears twice` });
    taskIds.add(task.id);
    if (channels.has(task.outputChannel)) {
      issues.push({ code: "duplicate_channel", detail: `channel "${task.outputChannel}" is published by more than one task` });
    }
    channels.add(task.outputChannel);
    if (!finchHandles.has(task.finch)) {
      issues.push({ code: "unknown_finch", detail: `task "${task.id}" assigns unknown finch "${task.finch}"` });
    }
  }

  for (const task of manifest.tasks) {
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) {
        issues.push({ code: "unknown_dependency", detail: `task "${task.id}" depends on unknown task "${dependency}"` });
      }
    }
  }

  // Channel references must resolve, and must resolve to something that has
  // actually run by then. A task reading a channel it does not transitively
  // depend on works only by accident of scheduling order — and ships a raw
  // "{{placeholder}}" into a prompt the moment the graph is rearranged.
  const producerOf = new Map(manifest.tasks.map((task) => [task.outputChannel, task.id]));
  const taskById = new Map(manifest.tasks.map((task) => [task.id, task]));

  const ancestorsOf = (taskId: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(taskById.get(taskId)?.dependsOn ?? [])];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(taskById.get(current)?.dependsOn ?? []));
    }
    return seen;
  };

  for (const task of manifest.tasks) {
    const referenced = [...task.instruction.matchAll(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g)].map((match) => match[1] as string);
    if (referenced.length === 0) continue;
    const ancestors = ancestorsOf(task.id);
    for (const channel of new Set(referenced)) {
      const producer = producerOf.get(channel);
      if (!producer) {
        issues.push({
          code: "unknown_channel",
          detail: `task "${task.id}" reads channel "${channel}", which no task publishes`,
        });
        continue;
      }
      if (producer !== task.id && !ancestors.has(producer)) {
        issues.push({
          code: "unreachable_channel",
          detail: `task "${task.id}" reads channel "${channel}" from task "${producer}", which it does not depend on`,
        });
      }
    }
  }

  // Cycle detection — Kahn's algorithm over the dependency edges.
  const indegree = new Map<string, number>();
  for (const task of manifest.tasks) indegree.set(task.id, 0);
  for (const task of manifest.tasks) {
    // Dedupe: a repeated dependency would inflate indegree and make a valid
    // DAG look like a cycle.
    for (const dependency of new Set(task.dependsOn)) {
      if (indegree.has(task.id) && taskIds.has(dependency)) {
        indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      }
    }
  }
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited++;
    for (const task of manifest.tasks) {
      if (task.dependsOn.includes(current)) {
        const next = (indegree.get(task.id) ?? 1) - 1;
        indegree.set(task.id, next);
        if (next === 0) queue.push(task.id);
      }
    }
  }
  if (visited < manifest.tasks.length) {
    issues.push({ code: "cycle", detail: "task graph contains a cycle — every nest must be a DAG" });
  }

  return issues;
}

// ── Coordinator ───────────────────────────────────────────────────────────

export interface RunNestOptions {
  runId: string;
  /** Resolve a member finch's provider. Server supplies this (keys stay server-side). */
  resolveProvider: (manifest: FinchManifest) => ModelProvider;
  /** Extra hatch options per member finch (memory, flightpath, sink). */
  hatchOptions?: (manifest: FinchManifest) => Partial<HatchOptions>;
  onEvent?: (event: NestEvent) => void;
  signal?: AbortSignal;
}

const CHANNEL_PATTERN = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;

/** Substitute {{channel}} references with upstream outputs. */
export function resolveInstruction(instruction: string, channels: Record<string, string>): string {
  return instruction.replace(CHANNEL_PATTERN, (match, key: string) => {
    // Own properties only: "{{constructor}}" must not resolve to something off
    // Object.prototype and get injected into a prompt.
    if (!Object.prototype.hasOwnProperty.call(channels, key)) return match;
    const value = channels[key];
    if (typeof value !== "string") return match;
    return value.length > 6000 ? `${value.slice(0, 6000)}\n…[truncated]` : value;
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyTaskRecord(runId: string, task: NestTask, finch: NestFinch): TaskRecord {
  return {
    id: task.id,
    nestRunId: runId,
    finch: task.finch,
    finchName: finch.name,
    title: task.title,
    outputChannel: task.outputChannel,
    dependsOn: task.dependsOn,
    status: task.dependsOn.length === 0 ? "ready" : "blocked",
    input: null,
    output: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    cost: { inputTokens: 0, outputTokens: 0 },
    provenance: null,
  };
}

/**
 * Execute a nest: schedule the DAG, run each task on its member finch through
 * the standard runtime, publish outputs onto typed channels, and stream every
 * transition. Honest by construction — a task that fails is reported failed,
 * a halted nest says why, and nothing is synthesized from missing data.
 */
export async function runNest(manifest: NestManifest, options: RunNestOptions): Promise<NestRunState> {
  const issues = validateTaskGraph(manifest);
  if (issues.length > 0) {
    throw new Error(`nest graph invalid: ${issues.map((issue) => issue.detail).join("; ")}`);
  }

  const policy = manifest.executionPolicy;
  if (policy.mode !== "preview") {
    throw new Error(
      `nest execution mode "${policy.mode}" is not available yet — only preview (read-only) nests can run today`,
    );
  }

  const finchByHandle = new Map(manifest.finches.map((finch) => [finch.handle, finch]));
  const taskById = new Map(manifest.tasks.map((task) => [task.id, task]));

  const run: NestRunState = {
    runId: options.runId,
    nestId: manifest.identity.id,
    objective: manifest.identity.objective,
    mode: policy.mode,
    status: "running",
    tasks: manifest.tasks.map((task) => emptyTaskRecord(options.runId, task, finchByHandle.get(task.finch)!)),
    channels: {},
    synthesis: null,
    totalCost: { inputTokens: 0, outputTokens: 0 },
    startedAt: nowIso(),
    finishedAt: null,
  };

  const recordById = new Map(run.tasks.map((record) => [record.id, record]));
  const emit = (event: NestEvent) => options.onEvent?.(event);

  emit({ type: "nest.started", run: structuredClone(run) });

  let failures = 0;
  const completed = new Set<string>();
  const failed = new Set<string>();

  const readyTasks = (): TaskRecord[] =>
    run.tasks.filter(
      (record) =>
        (record.status === "ready" || record.status === "blocked") &&
        record.dependsOn.every((dependency) => completed.has(dependency)),
    );

  async function executeTask(record: TaskRecord): Promise<void> {
    const task = taskById.get(record.id)!;
    const member = finchByHandle.get(task.finch)!;

    if (options.signal?.aborted) {
      // Never start a task for a run that is already cancelled — that would buy
      // inference for a result nobody is waiting on.
      record.status = "cancelled";
      record.error = "run cancelled";
      record.finishedAt = nowIso();
      emit({ type: "task.status", task: structuredClone(record) });
      return;
    }

    record.status = "running";
    record.startedAt = nowIso();
    record.input = resolveInstruction(task.instruction, run.channels);
    emit({ type: "task.status", task: structuredClone(record) });

    const started = Date.now();
    try {
      const provider = options.resolveProvider(member.manifest);
      const extra = options.hatchOptions?.(member.manifest) ?? {};
      const hatched = await Nest.hatch(member.manifest, { ...extra, provider });

      const objectiveHeader = `Nest objective: ${manifest.identity.objective}\nYour task: ${task.title}\n\n`;
      // Enforce the declared per-task timeout, and let an aborted run stop a
      // task that is still waiting on a model. Both were previously declared
      // in the execution policy but never actually applied.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const running = hatched.run(objectiveHeader + record.input);
      // Even when the race is lost, recover what the orphaned run spent so the
      // nest token budget accounts for it.
      running
        .then((late) => {
          if (record.status !== "running") {
            run.totalCost.inputTokens += late.usage.inputTokens;
            run.totalCost.outputTokens += late.usage.outputTokens;
          }
        })
        .catch(() => {});

      const result = await Promise.race([
        running,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            hatched.stop();
            reject(new Error(`task exceeded taskTimeoutMs (${policy.taskTimeoutMs}ms)`));
          }, policy.taskTimeoutMs);
          if (options.signal) {
            onAbort = () => {
              hatched.stop();
              reject(new Error("run cancelled"));
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
        if (onAbort && options.signal) options.signal.removeEventListener("abort", onAbort);
      });

      record.cost = result.usage;
      run.totalCost.inputTokens += result.usage.inputTokens;
      run.totalCost.outputTokens += result.usage.outputTokens;
      record.provenance = {
        model: member.manifest.model.model,
        provider: member.manifest.model.provider,
        toolSteps: result.steps.filter((step) => step.type === "tool").map((step) => ({ name: step.name ?? "tool", ok: step.ok })),
        haltedBy: result.haltedBy,
      };

      if (result.output && result.output.trim().length > 0) {
        record.output = result.output;
        record.status = "completed";
        run.channels[task.outputChannel] = result.output;
        completed.add(record.id);
        emit({
          type: "channel.published",
          channel: task.outputChannel,
          fromTask: record.id,
          preview: result.output.slice(0, 240),
        });
      } else {
        record.status = "failed";
        record.error = result.error ?? `finch produced no output (halted: ${result.haltedBy ?? "unknown"})`;
        failed.add(record.id);
        failures++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "task failed";
      const cancelled = options.signal?.aborted || /run cancelled/i.test(message);
      // A client pressing Stop is not the finch failing. Counting it as a
      // failure produced the lie "halted after 2 task failures" on every
      // cancellation of a wave.
      record.status = cancelled ? "cancelled" : "failed";
      record.error = message.slice(0, 400);
      if (!cancelled) {
        failed.add(record.id);
        failures++;
      }
    } finally {
      record.finishedAt = nowIso();
      record.durationMs = Date.now() - started;
      emit({ type: "task.status", task: structuredClone(record) });
    }
  }

  // Schedule waves of ready tasks, bounded by maxParallel.
  while (run.status === "running") {
    if (options.signal?.aborted) {
      run.status = "halted";
      run.haltReason = "cancelled by client";
      break;
    }

    const ready = readyTasks();
    if (ready.length === 0) break;

    const wave = ready.slice(0, policy.maxParallel);
    for (const record of wave) record.status = "ready";
    await Promise.all(wave.map((record) => executeTask(record)));

    // Cancellation is judged before failures, so a stopped run reports being
    // stopped rather than blaming the finches.
    if (options.signal?.aborted) {
      run.status = "halted";
      run.haltReason = "cancelled by client";
      break;
    }

    if (failures >= policy.maxTaskFailures) {
      run.status = "halted";
      run.haltReason = `halted after ${failures} task failure${failures === 1 ? "" : "s"} (limit ${policy.maxTaskFailures})`;
      break;
    }
    const spent = run.totalCost.inputTokens + run.totalCost.outputTokens;
    if (spent > policy.maxTotalTokens) {
      run.status = "halted";
      run.haltReason = `token budget exhausted (${spent} > ${policy.maxTotalTokens})`;
      break;
    }
  }

  // Anything still unreachable was blocked by a failed upstream.
  for (const record of run.tasks) {
    if (record.status === "blocked" || record.status === "pending") {
      record.status = "skipped";
      record.error = "upstream task did not produce its channel";
      emit({ type: "task.status", task: structuredClone(record) });
    }
  }

  if (run.status === "running") {
    run.status = failed.size > 0 ? "failed" : "completed";
  }

  // Synthesis: only from channels that actually exist.
  if (manifest.coordinator.synthesize && Object.keys(run.channels).length > 0 && run.status !== "halted") {
    try {
      const terminalChannels = manifest.tasks
        .filter((task) => !manifest.tasks.some((other) => other.dependsOn.includes(task.id)))
        .map((task) => task.outputChannel)
        .filter((channel) => Object.prototype.hasOwnProperty.call(run.channels, channel) && run.channels[channel]);

      const sourceChannels = terminalChannels.length > 0 ? terminalChannels : Object.keys(run.channels);
      const body = sourceChannels
        .map((channel) => `## ${channel}\n${(run.channels[channel] ?? "").slice(0, 4000)}`)
        .join("\n\n");

      const coordinatorFinch = manifest.finches[0]!;
      const provider = options.resolveProvider({
        ...coordinatorFinch.manifest,
        model: {
          ...coordinatorFinch.manifest.model,
          provider: manifest.coordinator.model.provider,
          model: manifest.coordinator.model.model,
        },
      });

      const response = await provider.chat({
        messages: [
          {
            role: "system",
            content:
              `You are the coordinator of the nest "${manifest.identity.name}". Objective: ${manifest.identity.objective}\n` +
              (manifest.coordinator.instructions || "") +
              "\nSynthesize the member finches' outputs into one answer to the objective. Cite which channel each claim came from.\n\n" +
              "GROUNDING — these override everything above:\n" +
              "- You may only state what appears in the channel outputs below. You have no other source.\n" +
              "- A member finch describing what something 'would' look like is NOT a finding. Ignore hypotheticals, " +
              "typical-case explanations and invented identifiers rather than carrying them into your answer — " +
              "formatting a guess into a table is exactly what makes it dangerous.\n" +
              "- If the members found nothing, the correct answer is one or two sentences saying so, plus what would be " +
              "needed to answer it. Do not restate their speculation as a framework.\n" +
              "- Never invent contract functions, events, error codes, field names or standards.\n" +
              "- Match length to substance. Two real sentences beat a page of structure.",
          },
          { role: "user", content: `Channel outputs:\n\n${body}\n\nWrite the nest's answer to its objective.` },
        ],
        temperature: manifest.coordinator.model.temperature ?? 0.2,
        maxTokens: 1200,
      });

      if (response.content) {
        run.synthesis = response.content;
        run.totalCost.inputTokens += response.usage.inputTokens;
        run.totalCost.outputTokens += response.usage.outputTokens;
        emit({ type: "nest.synthesis", text: response.content });
      }
    } catch (error) {
      run.synthesis = null;
      run.haltReason = run.haltReason ?? `synthesis failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`;
    }
  }

  run.finishedAt = nowIso();
  emit({ type: "nest.finished", run: structuredClone(run) });
  return run;
}
