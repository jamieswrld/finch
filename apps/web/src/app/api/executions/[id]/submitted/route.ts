import { createMongoExecutionSink, isDbConfigured } from "@finch/db";
import { buildProofOfFlight, buildRobinhoodChain, getFlightpathTarget } from "@finch/flightpath";
import { createPublicClient, http, isAddress, isHex } from "viem";
import { errorJson, json, rateLimit, readJsonBody, safeErrorMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/executions/[id]/submitted — the user signed the prepared
 * transaction in their own wallet; here is the hash.
 *
 * This is where user-signed execution becomes real, and it is deliberately
 * suspicious. The hash is looked up on chain and the transaction it names is
 * compared field by field to what the finch prepared — to, value, calldata,
 * and the signer the intent was prepared for. A hash that points at some
 * other transaction moves nothing. Only a match advances the record, and it
 * advances by compare-and-set, so a double submit cannot double count.
 *
 * Then the receipt is awaited and the record settles to confirmed or
 * reverted, and a Proof of Flight is built for a confirmed one. Nothing here
 * ever says "successful" because a request returned 200.
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
  const { hash, from } = body.body as { hash?: string; from?: string };
  if (!hash || !isHex(hash) || hash.length !== 66) return errorJson(400, "expected { hash } — a 32-byte transaction hash");
  if (from !== undefined && !isAddress(from)) return errorJson(400, "from must be an address when supplied");

  const sink = createMongoExecutionSink();
  const record = await sink.get(id);
  if (!record) return errorJson(404, `no execution "${id}"`);
  if (record.state !== "awaiting_signature") {
    return json({ id, state: record.state, note: "this execution is not awaiting a signature", tx: record.tx ?? null, receipt: record.receipt ?? null });
  }
  const prepared = record.prepared as { from?: string; to: string; value: string; data?: string; gas: string } | undefined;
  if (!prepared) return errorJson(409, "record has no prepared transaction");

  const target = getFlightpathTarget();
  const client = createPublicClient({ chain: buildRobinhoodChain(), transport: http(target.rpcUrl, { timeout: 15_000 }) });

  // The transaction may not be visible the instant the wallet returns a hash.
  let tx = null as Awaited<ReturnType<typeof client.getTransaction>> | null;
  for (let attempt = 0; attempt < 6 && !tx; attempt += 1) {
    try {
      tx = await client.getTransaction({ hash: hash as `0x${string}` });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }
  if (!tx) return errorJson(409, "transaction not visible on chain yet — retry in a few seconds", { hash });

  // Field-by-field: the signed transaction must be the prepared one.
  const mismatches: string[] = [];
  if ((tx.to ?? "").toLowerCase() !== prepared.to.toLowerCase()) mismatches.push("to");
  if (tx.value !== BigInt(prepared.value)) mismatches.push("value");
  if ((tx.input ?? "0x").toLowerCase() !== (prepared.data ?? "0x").toLowerCase()) mismatches.push("data");
  if (prepared.from && tx.from.toLowerCase() !== prepared.from.toLowerCase()) mismatches.push("from");
  if (from && tx.from.toLowerCase() !== from.toLowerCase()) mismatches.push("from (claimed)");
  if (mismatches.length > 0) {
    return errorJson(422, `the transaction at that hash is not the prepared one (differs in: ${mismatches.join(", ")})`, { hash, mismatches });
  }

  // Exactly one submission may advance the record.
  const claimed = await sink.claimState(id, "awaiting_signature", "submitted");
  if (!claimed) {
    const current = await sink.get(id);
    return json({ id, state: current?.state ?? "unknown", note: "already submitted", tx: current?.tx ?? null });
  }
  // The hash is recorded with a targeted write the instant the CAS wins. A
  // whole-document save here once threw on an unrelated field, after the
  // state had already advanced and the ETH had already moved.
  const at = new Date().toISOString();
  await sink.setTx(id, { hash, submittedAt: at }, { at, event: "submitted", detail: `user-signed by ${tx.from}` });
  record.state = "submitted";
  record.tx = { hash: hash as `0x${string}`, submittedAt: at };

  // Settle. Daily-allowance accounting for user-signed spends is a follow-up;
  // the per-transaction cap was enforced when the intent was prepared.
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1, timeout: 90_000 });
    const confirmedAt = new Date().toISOString();
    record.receipt = {
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      confirmedAt,
    };
    record.state = receipt.status === "success" ? "confirmed" : "reverted";
    await sink.settle(id, record.state, record.receipt as unknown as Record<string, unknown>, { at: confirmedAt, event: record.state, detail: `block ${receipt.blockNumber}` });
  } catch (error) {
    // Still submitted — the hash is real. A reconciliation pass can settle it.
    await sink.setTx(id, { hash, submittedAt: at }, { at: new Date().toISOString(), event: "confirmation.pending", detail: safeErrorMessage(error, 120) }).catch(() => {});
    return json({ id, state: "submitted", tx: record.tx, note: "confirmation did not arrive within 90s; the transaction is submitted and will settle" });
  }

  let proof = null;
  if (record.state === "confirmed") {
    try {
      proof = await buildProofOfFlight(record as never, { target });
    } catch {
      proof = null; // a proof that cannot be built is reported as absent, never faked
    }
  }

  return json({
    id,
    state: record.state,
    tx: record.tx,
    receipt: record.receipt,
    explorerUrl: `${(target.explorerUrl ?? "").replace(/\/$/, "")}/tx/${hash}`,
    proof,
  });
}
