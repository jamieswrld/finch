import { hatchFromManifest } from "@finch/sdk";
import { createFlightpath, type ExecutionSink, type WalletPolicy } from "@finch/flightpath";
import { isAddress, parseUnits } from "viem";
import { resolveLiveChain, withFailover } from "@finch/providers";
import { createMongoExecutionSink, isDbConfigured, recordRun } from "@finch/db";
import { errorJson, json, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";
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

  const { preset: presetSlug, input, signer } = body.body as { preset?: string; input?: string; signer?: string };
  if (signer !== undefined && !isAddress(signer)) return errorJson(400, "signer must be an address");
  if (!presetSlug || typeof input !== "string") {
    return errorJson(400, "expected { preset, input }");
  }
  const preset = getSchoolPreset(presetSlug);
  if (!preset) return errorJson(404, `unknown preset "${presetSlug}"`);

  const trimmed = input.trim().slice(0, 600);
  if (trimmed.length === 0) return errorJson(400, "input is empty");

  // Any configured provider works; free tiers are preferred automatically.
  // Pass the manifest's provider/model as a PAIR. Forwarding the model id
  // alone sent a Hyperbolic model name to Groq, which 404s.
  const live = await resolveLiveChain({
    provider: preset.manifest.model.provider,
    model: preset.manifest.model.model,
  });
  const chain = live.chain;
  const resolved = chain[0] ?? null;
  if (!resolved) {
    return errorJson(503, "model compute is not configured in this environment", {
      configured: false,
      hint: "set any one of GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY (all have free tiers), or run Ollama locally with ENABLE_OLLAMA=1",
    });
  }

  try {
    // A connected wallet turns a read-only preview into prepare-for-signature:
    // the finch proposes, policy and simulation check, and the exact
    // transaction parks for the visitor to sign. That record must outlive
    // this request, so it needs the durable store; without one, the route
    // stays read-only and says so rather than preparing something that
    // would vanish.
    const externalSigner = signer && isDbConfigured() && preset.manifest.permissions.allowWrites ? (signer as `0x${string}`) : undefined;
    const mode = externalSigner ? "live" : "preview";
    // The caps here are the product's, mirrored from the preset's manifest;
    // hatch intersects the two, and a manifest can only ever narrow them.
    const basePolicy: WalletPolicy = {
      mode: "operator",
      allowances: [{ asset: "native", perDay: parseUnits("0.05", 18), perTx: parseUnits("0.01", 18) }],
      allowedContracts: [],
      rwaApprovedOnly: true,
    };
    // ONE sink instance, handed to both the Flightpath and hatch(). hatch()
    // derives the member's Flightpath with `options.sink ?? new memory sink`,
    // overriding whatever the passed Flightpath carried — so a sink given only
    // to the Flightpath was silently replaced, the prepared record landed in
    // process memory, and /submitted found nothing while the visitor's ETH had
    // already moved on chain. Structurally an ExecutionSink; zod's record type
    // for `intent` is wider than the SDK's, which is all the cast covers.
    const sink = externalSigner ? (createMongoExecutionSink() as unknown as ExecutionSink) : undefined;
    const flightpath = externalSigner && sink
      ? createFlightpath({ externalSigner, policy: basePolicy, agentId: `school:${preset.slug}`, sink })
      : undefined;
    const nest = await hatchFromManifest(preset.manifest, {
      provider: withFailover(chain),
      ...(flightpath && sink ? { flightpath, sink } : {}),
    });
    const startedMs = Date.now();
    const startedAt = new Date().toISOString();
    const result = await nest.run(trimmed);
    void recordRun({
      runId: `run_${crypto.randomUUID()}`,
      kind: "finch",
      subject: preset.slug,
      subjectName: preset.title,
      mode,
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
      mode,
      signer: externalSigner ?? null,
      preset: preset.slug,
      provider: { id: resolved.spec.id, label: resolved.spec.label, cost: resolved.spec.cost, model: resolved.model },
      // Declared-but-unresolvable service attachments are reported, not hidden.
      unresolvedServices: nest.unresolvedServices,
      output: result.output,
      haltedBy: result.haltedBy,
      // Every execution record this run produced. One in awaiting_signature
      // carries the exact transaction for the visitor's wallet.
      executions: result.executions.map((record) => ({
        id: record.id,
        state: record.state,
        intent: { kind: record.intent.kind, summary: record.intent.summary },
        policy: record.policy,
        simulation: record.simulation,
        prepared: record.prepared,
        error: record.error,
      })),
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
    return errorJson(502, `preview run failed: ${safeErrorMessage(error, 200)}`);
  }
}
