import { createMongoExecutionSink, isDbConfigured } from "@finch/db";
import { buildUnsignedTransaction, describeRpcError, getFlightpathTarget, type SerializedInstruction } from "@finch/flightpath";
import { errorJson, json, rateLimit } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/executions/[id]/transaction — the unsigned transaction for a
 * visitor's wallet.
 *
 * Built at the moment of asking, from the record's prepared instructions and
 * fee payer, with a fresh blockhash: a Solana transaction expires about a
 * minute after its blockhash, so building it when the finch prepared the
 * intent would hand the wallet something already stale. Nothing is signed
 * here and nothing is stored — the wallet signs and sends, and /submitted
 * checks what landed against the prepared instructions, not against these
 * bytes.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = rateLimit(request, 3);
  if (limited) return limited;

  const { id } = await context.params;
  if (!/^exec_[a-zA-Z0-9-]{8,80}$/.test(id)) return errorJson(400, "invalid execution id");
  if (!isDbConfigured()) return errorJson(503, "user-signed execution needs a durable execution store, and none is configured here");

  const record = await createMongoExecutionSink().get(id);
  if (!record) return errorJson(404, `no execution "${id}"`);
  if (record.state !== "awaiting_signature" || !record.prepared) {
    return errorJson(409, "this execution is not awaiting a signature", { state: record.state });
  }

  const prepared = record.prepared as {
    feePayer: string;
    instructions: SerializedInstruction[];
    addressLookupTables?: string[] | null;
    computeUnits: string;
  };
  const target = getFlightpathTarget();
  try {
    const built = await buildUnsignedTransaction(
      {
        feePayer: prepared.feePayer,
        instructions: prepared.instructions,
        addressLookupTables: prepared.addressLookupTables ?? undefined,
        computeUnits: prepared.computeUnits,
      },
      target.rpc,
    );
    return json(
      { id, chain: target.chain, feePayer: prepared.feePayer, transaction: built.transaction, lastValidBlockHeight: built.lastValidBlockHeight },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorJson(502, `could not build the transaction: ${describeRpcError(error, target.rpcUrls).slice(0, 160)}`);
  }
}
