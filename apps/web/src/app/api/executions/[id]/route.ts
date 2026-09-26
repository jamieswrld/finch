import { createMongoExecutionSink, isDbConfigured } from "@finch/db";
import { buildProofOfFlight, getFlightpathTarget, readReceipt, type ExecutionRecord } from "@finch/flightpath";
import { errorJson, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/executions/[id] — one execution record, exactly as stored.
 *
 * State is reported as recorded: awaiting_signature, submitted, confirmed,
 * reverted, denied, failed. A client polling this after signing sees the
 * transition the chain actually produced, not one the UI assumed.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!/^exec_[a-zA-Z0-9-]{8,80}$/.test(id)) return errorJson(400, "invalid execution id");
  if (!isDbConfigured()) return errorJson(503, "no durable execution store is configured here");
  const sink = createMongoExecutionSink();
  let record = await sink.get(id);
  if (!record) return errorJson(404, `no execution "${id}"`);

  // Reconciliation. A record can be left at "submitted" with a real signature
  // if the request that recorded it died before settling. The chain has the
  // answer; reading it here means a stuck record heals on the next look
  // instead of lying forever.
  const tx = record.tx as { signature?: unknown } | undefined;
  if (record.state === "submitted" && typeof tx?.signature === "string") {
    try {
      const receipt = await readReceipt(getFlightpathTarget().rpc, tx.signature);
      if (receipt) {
        const state = receipt.status === "success" ? "confirmed" : "reverted";
        const confirmedAt = new Date().toISOString();
        await sink.settle(
          id,
          state,
          { status: receipt.status, slot: receipt.slot, feeLamports: receipt.feeLamports, computeUnits: receipt.computeUnits, confirmedAt },
          { at: confirmedAt, event: state, detail: `slot ${receipt.slot} (reconciled)` },
        );
        record = (await sink.get(id)) ?? record;
      }
    } catch {
      // Not confirmed yet, or the RPC did not answer: the record stays exactly as stored.
    }
  }

  let proof = null;
  if (record.state === "confirmed") {
    try {
      proof = await buildProofOfFlight(record as unknown as ExecutionRecord, { target: getFlightpathTarget() });
    } catch {
      proof = null;
    }
  }
  return json({ ...record, proof });
}
