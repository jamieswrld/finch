import { createMongoExecutionSink, createMongoSpendTracker, isDbConfigured } from "@finch/db";
import {
  buildProofOfFlight,
  describeRpcError,
  explorerTxUrl,
  getFlightpathTarget,
  isSolanaAddress,
  isSolanaSignature,
  matchSignedTransaction,
  readLandedTransaction,
  spendLegs,
  intentFromRecord,
  waitForSignature,
  type ExecutionRecord,
  type SerializedInstruction,
} from "@finch/flightpath";
import { errorJson, json, rateLimit, readJsonBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/executions/[id]/submitted — the visitor's wallet signed and sent
 * the prepared transaction; here is its signature.
 *
 * This is where user-signed execution becomes real, and it is deliberately
 * suspicious. The signature is looked up on chain and the transaction it
 * names is compared instruction by instruction to what the finch prepared —
 * same fee payer as the only signer, same programs, accounts and data, with
 * nothing added but compute-budget or wallet assertion instructions. A
 * signature that points at some other transaction moves nothing. Only a match
 * advances the record, and it advances by compare-and-set, so a double
 * submit cannot double count.
 *
 * A Solana transaction is only readable once it is confirmed, so the answer
 * here is final: confirmed, or reverted (landed with an error — the fee was
 * paid, nothing else changed). Nothing here ever says "successful" because a
 * request returned 200.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = rateLimit(request, 4);
  if (limited) return limited;

  const { id } = await context.params;
  if (!/^exec_[a-zA-Z0-9-]{8,80}$/.test(id)) return errorJson(400, "invalid execution id");

  if (!isDbConfigured()) {
    // A prepared record lives in the execution store. Without a durable one,
    // the instance that prepared it and the instance answering this request
    // are not the same process, and the record is simply gone.
    return errorJson(503, "user-signed execution needs a durable execution store, and none is configured here");
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { signature, from } = (body.body ?? {}) as { signature?: string; from?: string };
  if (!isSolanaSignature(signature)) return errorJson(400, "expected { signature } — a base58 transaction signature");
  if (from !== undefined && !isSolanaAddress(from)) return errorJson(400, "from must be a Solana address when supplied");

  const sink = createMongoExecutionSink();
  const record = await sink.get(id);
  if (!record) return errorJson(404, `no execution "${id}"`);
  if (record.state !== "awaiting_signature") {
    return json({ id, state: record.state, note: "this execution is not awaiting a signature", tx: record.tx ?? null, receipt: record.receipt ?? null });
  }
  const prepared = record.prepared as { feePayer: string; instructions: SerializedInstruction[] } | undefined;
  if (!prepared) return errorJson(409, "record has no prepared transaction");
  if (from && from !== prepared.feePayer) {
    return errorJson(422, "the claimed signer is not the wallet this transaction was prepared for", { mismatches: ["from (claimed)"] });
  }

  const target = getFlightpathTarget();

  // Wait for the network to confirm the signature. An expired blockhash with
  // nothing landed is a definite answer; a timeout is not, and leaves the
  // record waiting so the client can ask again.
  const outcome = await waitForSignature(target.rpc, signature, { timeoutMs: 60_000 }).catch(() => ({ status: "timeout" as const }));
  if (outcome.status !== "confirmed") {
    return json(
      { id, state: record.state, signature, note: "not confirmed on chain yet — the transaction may still land; submit the signature again in a few seconds" },
      { status: 202 },
    );
  }

  let landed: Awaited<ReturnType<typeof readLandedTransaction>>;
  try {
    landed = await readLandedTransaction(target.rpc, signature);
  } catch (error) {
    return errorJson(502, `could not read the confirmed transaction: ${describeRpcError(error, target.rpcUrls).slice(0, 160)}`);
  }
  if (!landed) return json({ id, state: record.state, signature, note: "confirmed but not yet readable from this node; submit again shortly" }, { status: 202 });

  // Instruction by instruction: the landed transaction must be the prepared one.
  const match = matchSignedTransaction(prepared, landed);
  if (!match.ok) {
    return errorJson(422, `the transaction at that signature is not the prepared one (differs in: ${match.mismatches.join(", ")})`, {
      signature,
      mismatches: match.mismatches,
    });
  }

  // Exactly one submission may advance the record.
  const claimed = await sink.claimState(id, "awaiting_signature", "submitted");
  if (!claimed) {
    const current = await sink.get(id);
    return json({ id, state: current?.state ?? "unknown", note: "already submitted", tx: current?.tx ?? null });
  }
  // The signature is recorded with a targeted write the instant the CAS wins,
  // so an unrelated field can never block it after value has moved.
  const at = new Date().toISOString();
  await sink.setTx(id, { signature, submittedAt: at }, { at, event: "submitted", detail: `user-signed by ${landed.feePayer}` });

  // The spend counts against the signer's daily allowance from this moment,
  // durably, so the next intent this wallet prepares — on any instance — sees
  // it. Priced from the instructions, exactly as the policy priced them.
  const tracker = createMongoSpendTracker({ owner: landed.feePayer });
  for (const leg of spendLegs(intentFromRecord(record as unknown as ExecutionRecord))) {
    await tracker.recordSpend(leg.asset, leg.amount).catch(() => {});
  }

  const confirmedAt = new Date().toISOString();
  const receipt = {
    status: landed.receipt.status,
    slot: landed.receipt.slot,
    feeLamports: landed.receipt.feeLamports,
    computeUnits: landed.receipt.computeUnits,
    confirmedAt,
  };
  const state = landed.receipt.status === "success" ? "confirmed" : "reverted";
  await sink.settle(id, state, receipt, {
    at: confirmedAt,
    event: state,
    detail: state === "confirmed" ? `slot ${receipt.slot}` : `slot ${receipt.slot}: ${landed.receipt.error ?? "instruction error"}`,
  });

  let proof = null;
  if (state === "confirmed") {
    try {
      proof = await buildProofOfFlight(
        { ...(record as unknown as ExecutionRecord), state, tx: { signature, submittedAt: at }, receipt },
        { target },
      );
    } catch {
      proof = null; // a proof that cannot be built is reported as absent, never faked
    }
  }

  return json({
    id,
    state,
    tx: { signature, submittedAt: at },
    receipt,
    explorerUrl: explorerTxUrl(signature, target),
    proof,
    ...(state === "reverted" ? { note: "the transaction landed with an error: the network fee was paid and nothing else changed" } : {}),
  });
}
