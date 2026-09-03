import { z } from "zod";
import { isDbConfigured } from "./client.ts";
import { getCollections } from "./collections.ts";

/**
 * Run history.
 *
 * Every Flight School preview and every nest run leaves a record: what was
 * asked, which finch or nest answered, what it cost, how long it took, and
 * whether it succeeded. Without this the product can show you a run happening
 * and then forget it ever did.
 *
 * When MongoDB is configured runs persist there. Otherwise they land in a
 * bounded in-process ring buffer so the surface still works in development —
 * and the API labels which of the two you are looking at, so nobody mistakes
 * a dev buffer for durable history.
 */

export const runTaskSummarySchema = z.object({
  id: z.string(),
  finch: z.string(),
  status: z.string(),
  durationMs: z.number().nullable(),
  outputTokens: z.number(),
  error: z.string().nullable(),
});

export const runDocSchema = z.object({
  runId: z.string().min(4).max(80),
  kind: z.enum(["finch", "nest"]),
  /** Preset slug or nest id. */
  subject: z.string().min(1).max(80),
  subjectName: z.string().max(120).default(""),
  mode: z.enum(["preview", "simulate", "live"]).default("preview"),
  objective: z.string().max(600).default(""),
  status: z.enum(["completed", "failed", "halted"]),
  haltReason: z.string().max(300).nullable().default(null),
  cost: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  durationMs: z.number().nonnegative(),
  taskCount: z.number().int().nonnegative().default(0),
  tasks: z.array(runTaskSummarySchema).default([]),
  owner: z.string().max(128).nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string(),
});

export type RunDoc = z.infer<typeof runDocSchema>;
export type RunTaskSummary = z.infer<typeof runTaskSummarySchema>;

const MEMORY_LIMIT = 50;
const memoryRuns: RunDoc[] = [];

export type RunSource = "db" | "memory";

/** Persist a finished run. Never throws into the caller's response path. */
export async function recordRun(candidate: unknown): Promise<{ saved: boolean; source: RunSource }> {
  const parsed = runDocSchema.safeParse(candidate);
  if (!parsed.success) return { saved: false, source: "memory" };
  const run = parsed.data;

  if (isDbConfigured()) {
    try {
      const { runs } = await getCollections();
      await runs.updateOne({ runId: run.runId }, { $setOnInsert: run }, { upsert: true });
      return { saved: true, source: "db" };
    } catch {
      // fall through to the buffer rather than losing the record entirely
    }
  }

  memoryRuns.unshift(run);
  if (memoryRuns.length > MEMORY_LIMIT) memoryRuns.length = MEMORY_LIMIT;
  return { saved: true, source: "memory" };
}

export async function listRuns(
  limit = 25,
): Promise<{ source: RunSource; configured: boolean; degraded: boolean; runs: RunDoc[] }> {
  const capped = Math.min(Math.max(limit, 1), 100);
  if (isDbConfigured()) {
    try {
      const { runs } = await getCollections();
      const rows = await runs
        .find({}, { projection: { _id: 0 } })
        .sort({ finishedAt: -1 })
        .limit(capped)
        .toArray();
      return { source: "db", configured: true, degraded: false, runs: rows };
    } catch {
      // Configured but unreachable is a different fact from "no database
      // configured", and the UI must not report one as the other.
      return { source: "memory", configured: true, degraded: true, runs: memoryRuns.slice(0, capped) };
    }
  }
  return { source: "memory", configured: false, degraded: false, runs: memoryRuns.slice(0, capped) };
}
