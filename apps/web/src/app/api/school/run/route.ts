import { hatchFromManifest } from "@finch/sdk";
import { resolveProviderFromEnv } from "@finch/providers";
import { recordRun } from "@finch/db";
import { errorJson, json, rateLimit, readJsonBody } from "@/lib/server/http";
import { getSchoolPreset } from "@/lib/school-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/school/run — run a Flight School preset in PREVIEW mode.
 *
 * This is the real runtime: the preset manifest is hatched with
 * hatchFromManifest and executed observer-only. No wallet, no writes, no
 * pretending: if compute isn't configured, the route says so instead of
 * fabricating a response.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 3);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const { preset: presetSlug, input } = body.body as { preset?: string; input?: string };
  if (!presetSlug || typeof input !== "string") {
    return errorJson(400, "expected { preset, input }");
  }
  const preset = getSchoolPreset(presetSlug);
  if (!preset) return errorJson(404, `unknown preset "${presetSlug}"`);

  const trimmed = input.trim().slice(0, 600);
  if (trimmed.length === 0) return errorJson(400, "input is empty");

  // Any configured provider works; free tiers are preferred automatically.
  const resolved = resolveProviderFromEnv(preset.manifest.model.model);
  if (!resolved) {
    return errorJson(503, "model compute is not configured in this environment", {
      configured: false,
      hint: "set any one of GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY (all have free tiers), or run Ollama locally with ENABLE_OLLAMA=1",
    });
  }

  try {
    const nest = await hatchFromManifest(preset.manifest, { provider: resolved.provider });
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const result = await nest.run(trimmed);
    void recordRun({
      runId: `run_${crypto.randomUUID()}`,
      kind: "finch",
      subject: preset.slug,
      subjectName: preset.title,
      mode: "preview",
      objective: trimmed.slice(0, 600),
      status: result.haltedBy === "completed" ? "completed" : result.output ? "completed" : "failed",
      haltReason: result.error ?? result.haltedBy ?? null,
      cost: result.usage,
      durationMs: Date.now() - startedMs,
      taskCount: result.steps.length,
      tasks: result.steps.map((step, index) => ({
        id: `s${index + 1}`,
        finch: step.name ?? step.type,
        status: step.ok ? "completed" : "failed",
        durationMs: null,
        outputTokens: 0,
        error: null,
      })),
      owner: null,
      startedAt,
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return json({
      mode: "preview",
      preset: preset.slug,
      provider: { id: resolved.spec.id, label: resolved.spec.label, cost: resolved.spec.cost, model: resolved.model },
      // Declared-but-unresolvable service attachments are reported, not hidden.
      unresolvedServices: nest.unresolvedServices,
      output: result.output,
      haltedBy: result.haltedBy,
      error: result.error,
      usage: result.usage,
      // The full audit trail: what each tool was called with and what it returned.
      steps: result.steps.map((step) => ({
        type: step.type,
        name: step.name,
        ok: step.ok,
        at: step.at,
        args: step.args,
        result: step.result,
      })),
    });
  } catch (error) {
    return errorJson(502, `preview run failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
  }
}
