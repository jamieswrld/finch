import { getCollections, isDbConfigured, listRuns } from "@finch/db";
import { seedAviaryListings, seedNests } from "@finch/db/seeds";
import { POLICY_RULES } from "@finch/flightpath";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/activity — what the protocol has actually done.
 *
 * This replaces the old infrastructure readout. "RPC reachable" is plumbing:
 * it tells a visitor the lights are on, which is the least interesting thing
 * true about a network. Work is the interesting thing — what was asked, which
 * nest answered, how many tasks it took, whether it held policy.
 *
 * The spec rule still binds: never invent a number. Every count here is a
 * count of rows that exist. `provenance` says whether those rows are live
 * registrations or labeled seed, and the UI renders that difference rather
 * than dressing sample data as traffic.
 */

interface Counts {
  finches: number;
  nests: number;
  runs: number;
  tasks: number;
  proofs: number;
}

const EMPTY: Counts = { finches: 0, nests: 0, runs: 0, tasks: 0, proofs: 0 };

export async function GET(): Promise<Response> {
  const history = await listRuns(12);

  // Tasks and proofs are derived from real rows, never estimated. A run with
  // no recorded tasks contributes zero, not a guess.
  const tasks = history.runs.reduce((sum, run) => sum + run.taskCount, 0);

  let counts: Counts = { ...EMPTY, runs: history.runs.length, tasks };
  // Provenance is per-figure, because the two halves have different origins.
  // Runs are always real events; the registry counts may be seed rows. One
  // real run does not turn a seeded listing into a registration.
  let registryProvenance: "live" | "seed" | "empty" = "empty";

  if (isDbConfigured()) {
    try {
      const collections = await getCollections();
      const [finches, nests, proofs, seeded, runTotal] = await Promise.all([
        collections.aviaryListings.countDocuments({}),
        collections.nests.countDocuments({}),
        collections.executions.countDocuments({ state: "confirmed" }),
        collections.aviaryListings.countDocuments({ source: "seed" }),
        collections.runs.countDocuments({}),
      ]);
      counts = { finches, nests, runs: runTotal, tasks, proofs };
      // Rows that came from the seed file are seed rows no matter which
      // database they are sitting in.
      registryProvenance = seeded > 0 ? "seed" : finches + nests > 0 ? "live" : "empty";
    } catch {
      counts = { ...counts, finches: seedAviaryListings.length, nests: seedNests.length };
      registryProvenance = "seed";
    }
  } else {
    counts = { ...counts, finches: seedAviaryListings.length, nests: seedNests.length };
    registryProvenance = "seed";
  }

  return json({
    /** Where the finches/nests counts came from. Runs and tasks are always real. */
    provenance: registryProvenance,
    registryProvenance,
    runsProvenance: history.runs.length > 0 ? "live" : "empty",
    durable: history.source === "db",
    counts,
    /** Most recent real work, newest first — objective, scale, outcome. */
    recent: history.runs.slice(0, 8).map((run) => ({
      runId: run.runId,
      kind: run.kind,
      subject: run.subjectName || run.subject,
      objective: run.objective,
      mode: run.mode,
      status: run.status,
      taskCount: run.taskCount,
      durationMs: run.durationMs,
      finishedAt: run.finishedAt,
    })),
    /**
     * Properties of the machine itself. These hold at zero traffic because
     * they are enforced in code on every execution, not claims about volume.
     */
    guarantees: {
      policyRules: POLICY_RULES.length,
      denyByDefault: true,
      modes: ["preview", "simulate", "live"],
      simulationRequired: true,
    },
    at: new Date().toISOString(),
  });
}
