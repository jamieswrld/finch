import type { TransactionSigner } from "@solana/kit";
import type { FlightpathTarget } from "./chain.ts";
import { describeRpcError } from "./network.ts";
import type { PolicyEngine } from "./policy.ts";
import { computeUnitLimitFor, readReceipt, signAndSend, simulate, waitForSignature } from "./transaction.ts";
import type { ExecutionIntent, ExecutionRecord, ExecutionSink } from "./types.ts";

const now = (): string => new Date().toISOString();

export interface ExecutionContext {
  target: FlightpathTarget;
  /** The operator keypair, when this process signs. Server-side only. */
  signer?: TransactionSigner;
  policy: PolicyEngine;
  sink: ExecutionSink;
  agentId?: string;
  confirmationTimeoutMs?: number;
  /**
   * Who signs. "server" is the operator keypair on this context. "external" is
   * a wallet this process never holds — a visitor's browser — so execution
   * stops after simulation with the exact instructions prepared, and resumes
   * only when a landed transaction that matches them is presented.
   */
  signing?: "server" | "external";
  /** The address the transaction is prepared for when signing is external. */
  externalSigner?: string;
}

function baseRecord(context: ExecutionContext, id: string, intent: ExecutionIntent): ExecutionRecord {
  return {
    id,
    agentId: context.agentId,
    chain: context.target.chain,
    createdAt: now(),
    state: "created",
    intent: {
      kind: intent.kind,
      summary: intent.summary,
      to: intent.to,
      instructions: intent.instructions,
      addressLookupTables: intent.addressLookupTables,
      spendAsset: intent.spendAsset,
      spendAmount: intent.spendAmount.toString(),
      meta: intent.meta,
    },
    log: [{ at: now(), event: "created", detail: intent.summary }],
  };
}

function push(record: ExecutionRecord, event: string, detail?: string): void {
  record.log.push({ at: now(), event, detail });
}

/** Who would pay for and sign this transaction, if anyone. */
function feePayerOf(context: ExecutionContext): string | undefined {
  return context.signing === "external" ? context.externalSigner : context.signer?.address;
}

/**
 * The one path every onchain write takes. No agent code may submit a
 * transaction any other way:
 *
 *   policy → simulation → (approval gate) → submission → confirmation → log
 *
 * Idempotent on `id`: replaying a completed execution returns the stored
 * record instead of re-submitting.
 */
export async function executeIntent(
  context: ExecutionContext,
  id: string,
  intent: ExecutionIntent,
): Promise<ExecutionRecord> {
  const existing = await context.sink.get(id);
  if (existing) {
    // Parked at the gate: ONLY resumeApprovedIntent releases it. Re-calling
    // with the same id must never be a way around the gate.
    if (existing.state === "awaiting_approval") return existing;

    // An id reserved but wedged before anything was signed is retryable: no
    // transaction exists, so re-running risks nothing. Without this, a
    // transient policy-store or sink error burned the execution id forever —
    // every replay saw a non-"awaiting_approval" state and returned the stub.
    const retryable =
      existing.state === "failed" && !existing.tx && existing.error?.stage === "policy";
    if (retryable) {
      if (context.sink.claimState) {
        const won = await context.sink.claimState(id, "failed", "created");
        if (!won) return (await context.sink.get(id)) ?? existing;
      }
      existing.state = "created";
      existing.error = undefined;
      push(existing, "retry", "re-entered after an infrastructure failure with nothing broadcast");
    } else if (existing.state !== "approved") {
      // Anything settled or already in flight is a no-op replay.
      return existing;
    }

    // "approved" is the one releasable state, and exactly one caller may take
    // it. Claiming it moves the record out of that state before any RPC, so a
    // replay arriving during simulation finds it already taken. Without this
    // the record stayed releasable across every await and a second call
    // broadcast a second transaction against one human approval.
    if (!existing.approval) return existing;
    if (context.sink.claimState) {
      const won = await context.sink.claimState(id, "approved", "created");
      if (!won) return (await context.sink.get(id)) ?? existing;
      existing.state = "created";
    } else {
      push(
        existing,
        "sink.no_state_claim",
        "sink cannot transition states atomically — a concurrent replay of this approval is not protected",
      );
    }
  }

  // A stored record is authoritative: replaying an id with a different intent
  // must never swap the transaction out from under a recorded approval.
  const record = existing ?? baseRecord(context, id, intent);
  const effectiveIntent = existing ? intentFromRecord(existing) : intent;

  if (!existing) {
    // Claim the id BEFORE simulating or signing. Two requests racing on one
    // fresh id would otherwise both read "nothing stored" and both submit.
    if (context.sink.reserve) {
      const won = await context.sink.reserve(record);
      if (!won) {
        // Someone else owns this execution; return their record, never a
        // second transaction.
        return (await context.sink.get(id)) ?? record;
      }
    } else {
      push(
        record,
        "sink.no_reservation",
        "sink cannot reserve ids atomically — concurrent calls on this id are not protected",
      );
    }
  }

  // 1. Policy.
  let decision: Awaited<ReturnType<typeof context.policy.evaluate>>;
  try {
    decision = await context.policy.evaluate(effectiveIntent);
  } catch (error) {
    // The spend tracker may be backed by a database. An outage here must not
    // silently leave the record in "created" with no explanation and no way
    // back — mark it retryable and say why.
    const message = error instanceof Error ? error.message : String(error);
    record.state = "failed";
    record.error = { stage: "policy", message };
    push(record, "policy.unavailable", message.slice(0, 300));
    await context.sink.save(record).catch(() => {});
    return record;
  }
  record.policy = decision;
  if (decision.verdict === "deny") {
    record.state = "denied";
    record.error = { stage: "policy", message: decision.reason };
    push(record, "policy.denied", `${decision.rule}: ${decision.reason}`);
    await context.sink.save(record);
    return record;
  }
  push(record, "policy.passed", decision.rule);

  // Nothing can be simulated, let alone signed, without a fee payer.
  const feePayer = feePayerOf(context);
  if (!feePayer || effectiveIntent.instructions.length === 0) {
    record.state = "failed";
    record.error = { stage: "submission", message: "no signer attached (observer mode) — there is no wallet to simulate or sign as" };
    push(record, "submission.failed", "no signer");
    await context.sink.save(record);
    return record;
  }

  // 2. Simulation — mandatory before anything is signed. Simulated as whoever
  // will actually sign: an external signer's balance is what the chain will
  // check, not the server's.
  let units: bigint | null = null;
  try {
    const outcome = await simulate({
      rpc: context.target.rpc,
      feePayer,
      instructions: effectiveIntent.instructions,
      addressLookupTables: effectiveIntent.addressLookupTables,
    });
    units = outcome.unitsConsumed;
    record.simulation = {
      ok: outcome.ok,
      computeUnits: outcome.unitsConsumed?.toString(),
      feeLamports: outcome.feeLamports?.toString(),
      logs: outcome.logs,
      error: outcome.error,
      simulatedAt: now(),
    };
    if (!outcome.ok) throw new Error(outcome.error ?? "simulation failed");
    push(record, "simulated", `compute units ≈ ${outcome.unitsConsumed?.toString() ?? "unknown"}`);
  } catch (error) {
    const message = describeRpcError(error, context.target.rpcUrls);
    record.state = "simulation_failed";
    record.simulation = { ...(record.simulation ?? {}), ok: false, error: message, simulatedAt: now() };
    record.error = { stage: "simulation", message };
    push(record, "simulation.failed", message.slice(0, 300));
    await context.sink.save(record);
    return record;
  }
  const computeUnitLimit = computeUnitLimitFor(units);

  // 3a. External signing: stop here with the transaction prepared.
  //
  // Nothing past this point can run without a signer this process does not
  // have. The record parks with the exact instructions, and the policy
  // verdict — including needs_approval — travels with it: when the visitor's
  // own wallet is the signer, the visitor is the approver, and signing is the
  // approval. Spend is accounted when a matching landed transaction arrives,
  // never for one that was only proposed.
  if (context.signing === "external") {
    record.state = "awaiting_signature";
    record.prepared = {
      feePayer,
      instructions: effectiveIntent.instructions,
      addressLookupTables: effectiveIntent.addressLookupTables,
      computeUnits: String(computeUnitLimit ?? 0),
    };
    push(
      record,
      "awaiting_signature",
      decision.verdict === "needs_approval"
        ? `prepared for ${feePayer} — policy flagged a large spend; the signer is the approver`
        : `prepared for ${feePayer}`,
    );
    await context.sink.save(record);
    return record;
  }

  // 3. Approval gate.
  // Gate on a recorded approval, never on the record's own parked state.
  if (decision.verdict === "needs_approval" && !record.approval) {
    record.state = "awaiting_approval";
    push(record, "awaiting_approval", decision.reason);
    await context.sink.save(record);
    return record;
  }

  // 4. Allowance reservation — the real enforcement point.
  //
  // evaluate() checked the cap earlier, but that check and the later debit are
  // separated by simulation, so concurrent executions could all read the same
  // figure and all decide they fit. Reserving here collapses read and write
  // into one atomic step at the last moment before value can move.
  const refusal = await context.policy.reserveSpend(effectiveIntent);
  if (refusal) {
    record.state = "failed";
    record.error = { stage: "policy", message: refusal.reason };
    push(record, `policy.${refusal.rule}`, refusal.reason);
    await context.sink.save(record);
    return record;
  }

  // 5. Submission.
  if (!context.signer) {
    record.state = "failed";
    record.error = { stage: "submission", message: "no operator wallet attached (observer mode)" };
    push(record, "submission.failed", "no signer");
    await context.sink.save(record);
    return record;
  }

  let sent: Awaited<ReturnType<typeof signAndSend>>;
  try {
    sent = await signAndSend({
      rpc: context.target.rpc,
      feePayer: context.signer,
      instructions: effectiveIntent.instructions,
      addressLookupTables: effectiveIntent.addressLookupTables,
      computeUnitLimit,
      rpcUrls: context.target.rpcUrls,
    });
  } catch (error) {
    // Failed while building or signing: nothing reached the network.
    const message = describeRpcError(error, context.target.rpcUrls);
    record.state = "failed";
    record.error = { stage: "submission", message };
    push(record, "submission.failed", message.slice(0, 300));
    await context.sink.save(record);
    return record;
  }

  if (sent.sendError) {
    // The node refused the bytes (preflight) or the connection dropped. The
    // signature is known either way, so ask the chain instead of guessing: a
    // transaction that landed despite the error is live and must be tracked.
    const seen = await waitForSignature(context.target.rpc, sent.signature, {
      lastValidBlockHeight: sent.lastValidBlockHeight,
      timeoutMs: 8_000,
    }).catch(() => ({ status: "timeout" as const }));
    if (seen.status !== "confirmed") {
      record.state = "failed";
      record.error = { stage: "submission", message: sent.sendError };
      push(record, "submission.failed", sent.sendError.slice(0, 300));
      await context.sink.save(record);
      return record;
    }
  }

  // ── Past this line a transaction is LIVE on chain. ───────────────────────
  // Nothing that follows may mark the record "failed" for bookkeeping
  // reasons: reporting a real transaction as failed would also skip the
  // allowance debit and free the agent to spend the same budget again.
  record.tx = { signature: sent.signature, submittedAt: now() };
  record.state = "submitted";
  push(record, "submitted", sent.signature);

  // The allowance was already debited by the reservation above, so there is
  // nothing to record here — and nothing that can fail and leave a live
  // transaction unaccounted for.

  try {
    await context.sink.save(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    push(record, "sink.save_failed", message.slice(0, 200));
  }

  // 6. Confirmation + reconciliation.
  try {
    const outcome = await waitForSignature(context.target.rpc, sent.signature, {
      lastValidBlockHeight: sent.lastValidBlockHeight,
      timeoutMs: context.confirmationTimeoutMs ?? 90_000,
    });
    if (outcome.status === "expired") {
      // The blockhash aged out and the signature never landed: definitively
      // nothing happened on chain.
      record.state = "failed";
      record.error = { stage: "confirmation", message: "blockhash expired before the transaction landed — nothing was executed" };
      push(record, "confirmation.expired", "blockhash expired; transaction never landed");
    } else if (outcome.status === "timeout") {
      // It may still land — the record keeps the signature so a
      // reconciliation pass can settle final state.
      record.state = "failed";
      record.error = { stage: "confirmation", message: "confirmation timed out; the transaction may still land" };
      push(record, "confirmation.failed", "timed out");
    } else {
      const receipt = await readReceipt(context.target.rpc, sent.signature).catch(() => null);
      record.receipt = {
        status: outcome.err ? "failed" : "success",
        slot: (receipt?.slot ?? outcome.slot.toString()),
        feeLamports: receipt?.feeLamports ?? "0",
        computeUnits: receipt?.computeUnits,
        confirmedAt: now(),
      };
      if (!outcome.err) {
        record.state = "confirmed";
        push(record, "confirmed", `slot ${record.receipt.slot}`);
      } else {
        record.state = "reverted";
        record.error = { stage: "confirmation", message: `transaction landed with an error: ${receipt?.error ?? JSON.stringify(outcome.err)}` };
        push(record, "reverted", `slot ${record.receipt.slot}`);
      }
    }
  } catch (error) {
    const message = describeRpcError(error, context.target.rpcUrls);
    record.state = "failed";
    record.error = { stage: "confirmation", message: `confirmation failed: ${message}` };
    push(record, "confirmation.failed", message.slice(0, 300));
  }

  try {
    await context.sink.save(record);
  } catch (error) {
    // Same rule as above: the transaction is real whether or not we managed to
    // write it down. Throwing here would lose the record — and its signature —
    // in the caller, which is strictly worse than returning it unpersisted.
    const message = error instanceof Error ? error.message : String(error);
    push(record, "sink.save_failed", message.slice(0, 200));
  }
  return record;
}

/** Rebuild the exact intent a human saw when they approved it. */
export function intentFromRecord(record: ExecutionRecord): ExecutionIntent {
  return {
    kind: record.intent.kind,
    summary: record.intent.summary,
    to: record.intent.to,
    instructions: record.intent.instructions,
    addressLookupTables: record.intent.addressLookupTables,
    spendAsset: record.intent.spendAsset,
    spendAmount: BigInt(record.intent.spendAmount),
    meta: record.intent.meta,
  };
}

/**
 * Resume an execution parked at the approval gate, after human sign-off.
 *
 * The intent is reconstructed from the STORED record — never taken from the
 * caller. Approving execution id X must execute the transaction the approver
 * actually reviewed; accepting a caller-supplied intent here would let an
 * approval for a small transfer be redeemed against an arbitrary one.
 */
export async function resumeApprovedIntent(
  context: ExecutionContext,
  id: string,
  approvedBy: string,
): Promise<ExecutionRecord> {
  const record = await context.sink.get(id);
  if (!record || record.state !== "awaiting_approval") {
    throw new Error(`execution ${id} is not awaiting approval`);
  }
  if (record.approval) {
    throw new Error(`execution ${id} has already been approved by ${record.approval.approvedBy}`);
  }
  const approval = { approvedBy, at: now() };

  // Claim the approval atomically where the sink can: a double-clicked approve
  // button must produce one broadcast, not two.
  if (context.sink.claimApproval) {
    const claimed = await context.sink.claimApproval(id, approval);
    if (!claimed) {
      throw new Error(`execution ${id} was already approved by someone else`);
    }
  }

  // Stamp the approval AND leave the parked state in the same step. The stamp
  // is what opens the gate; staying in "awaiting_approval" while RPC is in
  // flight is what used to let a concurrent replay through it.
  record.approval = approval;
  record.state = "approved";
  record.log.push({ at: now(), event: "approved", detail: `by ${approvedBy}` });
  record.policy = { verdict: "allow", rule: "human.approval", reason: `approved by ${approvedBy}` };
  await context.sink.save(record);
  return executeIntent(context, id, intentFromRecord(record));
}
