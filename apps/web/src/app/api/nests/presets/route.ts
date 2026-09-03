import { validateTaskGraph } from "@finch/sdk";
import { json } from "@/lib/server/http";
import { NEST_PRESETS } from "@/lib/nest-presets";

export const runtime = "nodejs";

/**
 * GET /api/nests/presets — the runnable preset nests, with their full
 * nest.json manifests. Portable by design: fetch this, save it, run it
 * yourself with @finch/sdk runNest().
 */
export async function GET(): Promise<Response> {
  return json({
    presets: NEST_PRESETS.map((preset) => ({
      id: preset.identity.id,
      name: preset.identity.name,
      objective: preset.identity.objective,
      description: preset.identity.description,
      mode: preset.executionPolicy.mode,
      finchCount: preset.finches.length,
      taskCount: preset.tasks.length,
      graphIssues: validateTaskGraph(preset),
      manifest: preset,
    })),
  });
}
