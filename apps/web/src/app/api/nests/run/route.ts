import { isAddress as isSignerAddress, parseUnits as signerUnits, type Address as SignerAddress } from "viem";
import { effectiveParallelism, resolveLiveChain, withFailover } from "@finch/providers";
import { runNest, subjectOf, validateTaskGraph, type NestEvent } from "@finch/sdk";
import { createFlightpath, type ExecutionSink, type WalletPolicy } from "@finch/flightpath";
import { appendHiveFindings, createHiveMemory, createMongoExecutionSink, createMongoSpendTracker, isDbConfigured, recordRun } from "@finch/db";
import { errorJson, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";
import { resolveIdentity } from "@/lib/server/identity";
import { getNestPreset } from "@/lib/nest-presets";
import { UnresolvedFinchError, hydrateNestMembers, nestInputSchema } from "@/lib/registry";

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

  const { nest: nestId, objective, manifest: submitted, signer } = body.body as {
    signer?: string;
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
    // Members may be registry references ({ handle, ref: "registry" }) — the
    // composition feature. They are resolved to real manifests here, before the
    // strict schema and the graph validator ever see the nest.
    const loose = nestInputSchema.safeParse(submitted);
    if (!loose.success) {
      return errorJson(422, "nest manifest failed validation", {
        issues: loose.error.issues.slice(0, 12).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    let hydrated;
    try {
      hydrated = await hydrateNestMembers(loose.data);
    } catch (error) {
      if (error instanceof UnresolvedFinchError) {
        return errorJson(422, error.message, { unresolved: error.handles });
      }
      throw error;
    }
    const parsed = { success: true as const, data: hydrated };
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

  // Every configured provider whose key the probe has NOT seen rejected,
  // cheapest first. A rate limit on one hands the task to the next; a dead
  // key is never in the chain, so a parallel burst cannot all walk into it.
  const live = await resolveLiveChain();
  const chain = live.chain;
  const resolved = chain[0] ?? null;
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

  // A free tier is a per-minute token budget; fanning three tool-heavy finches
  // out at once exhausts it on the first turn and the nest halts having done
  // nothing. Run one at a time on free tiers, and say so in the stream.
  const parallelism = effectiveParallelism(live, manifest.executionPolicy.maxParallel);
  const executable = {
    ...manifest,
    executionPolicy: { ...manifest.executionPolicy, maxParallel: parallelism.value },
  };

  // The hive: shared memory keyed by what this run is about. Every member
  // finch reads prior findings on the subject before working; a completed
  // BUILTIN run writes its channel outputs back. Submitted nests read but do
  // not write — shared memory is an injection surface, and a stranger's
  // manifest must not be able to seed what every later finch is told.
  const subject = subjectOf(manifest.identity.objective);
  const hive = isDbConfigured() && subject ? createHiveMemory({ subject }) : undefined;
  const mayWriteHive = Boolean(hive) && submitted === undefined;

  const runId = `run_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();

  // Observer-mode Flightpath shared by every member finch: real chain reads,
  // no signer, every write denied by policy.
  // With a signer, a nest whose policy is not read-only gets a Flightpath
  // that prepares writes for that wallet — same path as the school: the
  // record parks at awaiting_signature in the durable sink, the wallet signs,
  // /submitted verifies the hash field by field. The spend allowance is the
  // signer's own, kept durably. Without a signer nothing changes: preview.
  if (signer !== undefined && !isSignerAddress(signer)) return errorJson(400, "signer must be an EVM address when supplied");
  const signing = Boolean(signer) && isDbConfigured() && manifest.executionPolicy.mode !== "preview";
  const sink = signing ? (createMongoExecutionSink() as unknown as ExecutionSink) : undefined;
  const signerPolicy: WalletPolicy = {
    mode: "operator",
    allowances: [{ asset: "native", perDay: signerUnits("0.05", 18), perTx: signerUnits("0.01", 18) }],
    allowedContracts: [],
    rwaApprovedOnly: true,
  };
  const flightpath = signing && sink && signer
    ? createFlightpath({ agentId: `nest:${manifest.identity.id}`, externalSigner: signer as SignerAddress, policy: signerPolicy, sink, spendTracker: createMongoSpendTracker({ owner: signer }) })
    : createFlightpath({ agentId: `nest:${manifest.identity.id}` });

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
        send({
          type: "run.config",
          providers: chain.map((entry) => entry.spec.id),
          excluded: live.excluded,
          signing: signing && signer ? { mode: "external", signer } : { mode: "none" },
          parallelism: { requested: manifest.executionPolicy.maxParallel, effective: parallelism.value, reason: parallelism.reason },
        } as unknown as NestEvent);
        const finished = await runNest(executable, {
          runId,
          // Every member finch runs on the configured provider; the manifest
          // names a model, the environment decides who serves it.
          resolveProvider: () => withFailover(chain),
          hatchOptions: () => ({ flightpath, ...(sink ? { sink } : {}), ...(hive ? { memory: hive } : {}) }),
          onEvent: send,
          signal: abort.signal,
        });
        // A completed builtin run teaches the hive. Failed or halted runs do
        // not: a channel that was never produced has nothing true to say.
        if (mayWriteHive && hive && subject && finished.status === "completed") {
          try {
            const written = await appendHiveFindings({
              runId,
              nestId: manifest.identity.id,
              subject,
              tasks: finished.tasks.map((task) => ({ finch: task.finch, outputChannel: task.outputChannel, status: task.status })),
              channels: finished.channels,
            });
            send({ type: "hive.written", subject, findings: written } as unknown as NestEvent);
          } catch {
            // Memory is a convenience layered on a run that already succeeded;
            // a write failure must not be reported as a run failure.
          }
        }
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
