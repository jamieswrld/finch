import { createMongoExecutionSink, isDbConfigured } from "@finch/db";
import { buildProofOfFlight, buildRobinhoodChain, getFlightpathTarget } from "@finch/flightpath";
import { createPublicClient, http } from "viem";
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

  // Reconciliation. A record can be left at "submitted" with a real hash if
  // the request that recorded it died before the receipt arrived — which is
  // exactly what happened once. The chain has the answer; reading it here
  // means a stuck record heals on the next look instead of lying forever.
  if (record.state === "submitted" && record.tx && typeof record.tx.hash === "string") {
    try {
      const target = getFlightpathTarget();
      const client = createPublicClient({ chain: buildRobinhoodChain(), transport: http(target.rpcUrl, { timeout: 10_000 }) });
      const receipt = await client.getTransactionReceipt({ hash: record.tx.hash as `0x${string}` });
      if (receipt) {
        const state = receipt.status === "success" ? "confirmed" : "reverted";
        const confirmedAt = new Date().toISOString();
        await sink.settle(
          id,
          state,
          { status: state === "confirmed" ? "success" : "reverted", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice?.toString(), confirmedAt },
          { at: confirmedAt, event: state, detail: `block ${receipt.blockNumber} (reconciled)` },
        );
        record = (await sink.get(id)) ?? record;
      }
    } catch {
      // Not mined yet, or the RPC did not answer: the record stays exactly as stored.
    }
  }

  let proof = null;
  if (record.state === "confirmed") {
    try {
      proof = await buildProofOfFlight(record as never, { target: getFlightpathTarget() });
    } catch {
      proof = null;
    }
  }
  return json({ ...record, proof });
}
