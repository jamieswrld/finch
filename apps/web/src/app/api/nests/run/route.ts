import { resolveProviderFromEnv } from "@finch/providers";
import { nestManifestSchema, runNest, validateTaskGraph, type NestEvent } from "@finch/sdk";
import { createFlightpath } from "@finch/flightpath";
import { recordRun } from "@finch/db";
import { errorJson, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";
import { resolveIdentity } from "@/lib/server/identity";
import { getNestPreset } from "@/lib/nest-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/nests/run — execute a preset nest in PREVIEW mode, streaming every
 * task transition as Server-Sent Events.
 *
 * SSE (not polling) because a nest run is a long-lived sequence of discrete
 * state changes: the client should see a task flip to running the moment it
 * does. Read-only throughout — observer Flightpath, no wallet, no writes.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 6);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const { nest: nestId, objective, manifest: submitted } = body.body as {
    nest?: string;
    objective?: string;
    manifest?: unknown;
  };

  /**
   * Bring-your-own nest.
   *
   * A submitted manifest is arbitrary work on the operator's inference budget,
   * so it costs a publisher key — the same key publishing costs. Running the
   * builtins stays open to everyone, because their cost is bounded and known.
   */
  let preset;
  if (submitted !== undefined) {
    const identity = await resolveIdentity(request);
    if (!identity.owner) {
      return errorJson(401, "running your own nest requires a publisher key — send it as x-finch-key", {
        hint: "The builtin nests run without a key: POST { nest: \"chain-intelligence\" }.",
      });
    }
    const parsed = nestManifestSchema.safeParse(submitted);
    if (!parsed.success) {
      return errorJson(422, "nest manifest failed validation", {
        issues: parsed.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    // Bounds a key does not lift: one request must not be able to schedule an
    // unbounded amount of paid inference.
    if (parsed.data.finches.length > 8 || parsed.data.tasks.length > 12) {
      return errorJson(413, "submitted nests are limited to 8 finches and 12 tasks on this endpoint", {
        finches: parsed.data.finches.length,
        tasks: parsed.data.tasks.length,
      });
    }
    preset = parsed.data;
  } else {
    if (!nestId) return errorJson(400, "expected { nest } or { manifest }");
    preset = getNestPreset(nestId);
    if (!preset) return errorJson(404, `unknown nest "${nestId}"`);
  }

  const graphIssues = validateTaskGraph(preset);
  if (graphIssues.length > 0) {
    // A submitted graph failing is the caller's problem, not a server fault.
    return errorJson(submitted === undefined ? 500 : 422, "nest graph is invalid", { issues: graphIssues });
  }

  const resolved = resolveProviderFromEnv();
  if (!resolved) {
    return errorJson(503, "model compute is not configured in this environment", {
      configured: false,
      hint: "set any one of GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY (all have free tiers), or run Ollama locally with ENABLE_OLLAMA=1",
    });
  }

  // Objective override lets a visitor point the nest at their own target.
  const manifest = objective && objective.trim().length > 3
    ? { ...preset, identity: { ...preset.identity, objective: objective.trim().slice(0, 500) } }
    : preset;

  const runId = `run_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  // Observer-mode Flightpath shared by every member finch: real chain reads,
  // no signer, every write denied by policy.
  const flightpath = createFlightpath({ agentId: `nest:${manifest.identity.id}` });

  // Hoisted so cancel() can reach it: without this, a client that closes the
  // tab stops receiving SSE while runNest keeps hatching finches and billing.
  const abort = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      abort.abort();
    },
    async start(controller) {
      let closed = false;
      const send = (event: NestEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      request.signal.addEventListener("abort", () => abort.abort(), { once: true });

      const startedMs = Date.now();
      try {
        const finished = await runNest(manifest, {
          runId,
          // Every member finch runs on the configured provider; the manifest
          // names a model, the environment decides who serves it.
          resolveProvider: () => resolved.provider,
          hatchOptions: () => ({ flightpath }),
          onEvent: send,
          signal: abort.signal,
        });
        // Leave a record — a run the product showed you should not vanish.
        await recordRun({
          runId,
          kind: "nest",
          subject: manifest.identity.id,
          subjectName: manifest.identity.name,
          mode: finished.mode,
          objective: manifest.identity.objective,
          status: finished.status === "running" ? "halted" : finished.status,
          haltReason: finished.haltReason ?? null,
          cost: finished.totalCost,
          durationMs: Date.now() - startedMs,
          taskCount: finished.tasks.length,
          tasks: finished.tasks.map((task) => ({
            id: task.id,
            finch: task.finchName,
            status: task.status,
            durationMs: task.durationMs,
            outputTokens: task.cost.outputTokens,
            error: task.error,
          })),
          owner: null,
          startedAt: finished.startedAt,
          finishedAt: finished.finishedAt ?? new Date().toISOString(),
        }).catch(() => {
          // recordRun never throws into the response path; swallow defensively.
        });
      } catch (error) {
        send({
          type: "nest.finished",
          run: {
            runId,
            nestId: manifest.identity.id,
            objective: manifest.identity.objective,
            mode: "preview",
            status: "failed",
            tasks: [],
            channels: {},
            synthesis: null,
            totalCost: { inputTokens: 0, outputTokens: 0 },
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            haltReason: safeErrorMessage(error, 300),
          },
        });
      } finally {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            /* client already gone */
          }
          closed = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
