import { getCollections, isDbConfigured, type FinchDoc } from "@finch/db";
import { REGISTRY_FINCH_DOCS, mergeWithBuiltins } from "@/lib/registry";
import { safeValidateManifest } from "@finch/sdk";
import { errorJson, json, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";
import { describeGate, checkPublisher } from "@/lib/server/publish-gate";
import { canWrite, resolveIdentity } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/finches — stored finches (drafts + hatched), or seed examples. */
export async function GET(): Promise<Response> {
  if (isDbConfigured()) {
    try {
      const { finches } = await getCollections();
      const rows = await finches.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).limit(100).toArray();
      return json({
        source: rows.length > 0 ? "db" : "builtin",
        finches: mergeWithBuiltins(REGISTRY_FINCH_DOCS, rows),
      });
    } catch (error) {
      return json({
        source: "builtin",
        degraded: true,
        note: `database unreachable (${safeErrorMessage(error, 120)})`,
        finches: REGISTRY_FINCH_DOCS,
      });
    }
  }
  return json({ source: "builtin", finches: REGISTRY_FINCH_DOCS });
}

/**
 * POST /api/finches — save a hatched manifest as a draft finch.
 *
 * Honest state contract: this persists a DRAFT. It does not start a runtime
 * and never claims onchain or execution success. When the database is not
 * configured it says so and returns the validated manifest for local export.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 4);
  if (limited) return limited;

  const identity = await resolveIdentity(request);

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  // The one token-gated action on Finch. Locked until $FINCH exists; a hold
  // check on the publisher's wallet once it does. Never silently open.
  const gate = describeGate();
  if (gate.state !== "open") return errorJson(423, gate.reason, { gate });
  const verdict = await checkPublisher((body.body as { publisher?: string })?.publisher);
  if (!verdict.ok) return errorJson(verdict.status, verdict.reason, { gate: verdict.gate, balance: verdict.balance ?? null });


  const candidate = (body.body as { manifest?: unknown })?.manifest ?? body.body;
  const validated = safeValidateManifest(candidate);
  if (!validated.ok) {
    return errorJson(422, "manifest failed validation", { issues: validated.issues });
  }
  const manifest = validated.manifest;

  if (!isDbConfigured()) {
    return json({
      saved: false,
      reason: "db-not-configured",
      note: "No registry database in this environment — download the manifest and hatch it with the Finch SDK.",
      manifest,
    });
  }

  try {
    const { finches } = await getCollections();
    const now = new Date().toISOString();
    const doc: FinchDoc = {
      handle: manifest.identity.handle,
      manifest: manifest as unknown as Record<string, unknown>,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    const existing = await finches.findOne({ handle: doc.handle });
    const verdict = canWrite(identity, existing ? existing.owner ?? null : undefined);
    if (!verdict.ok) {
      return errorJson(verdict.status, verdict.reason, { handle: doc.handle });
    }
    if (verdict.mode === "update") {
      await finches.updateOne({ handle: doc.handle }, { $set: { manifest: doc.manifest, updatedAt: now } });
      return json({ saved: true, updated: true, handle: doc.handle, status: "draft" });
    }
    await finches.insertOne({ ...doc, owner: identity.owner ?? undefined });
    return json({ saved: true, updated: false, handle: doc.handle, status: "draft" }, { status: 201 });
  } catch (error) {
    return errorJson(502, `finch save failed: ${safeErrorMessage(error, 160)}`);
  }
}
