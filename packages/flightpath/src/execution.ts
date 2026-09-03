import type { Account, Chain, PublicClient, WalletClient } from "viem";
import type { PolicyEngine } from "./policy.ts";
import type { ExecutionIntent, ExecutionRecord, ExecutionSink } from "./types.ts";

const now = (): string => new Date().toISOString();

export interface ExecutionContext {
  publicClient: PublicClient;
  walletClient?: WalletClient;
  account?: Account;
  chain: Chain;
  policy: PolicyEngine;
  sink: ExecutionSink;
  agentId?: string;
  confirmations?: number;
  confirmationTimeoutMs?: number;
}

function baseRecord(context: ExecutionContext, id: string, intent: ExecutionIntent): ExecutionRecord {
  return {
    id,
    agentId: context.agentId,
    chainId: context.chain.id,
    createdAt: now(),
    state: "created",
    intent: {
      kind: intent.kind,
      summary: intent.summary,
      to: intent.to,
      value: intent.value.toString(),
      data: intent.data,
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

  // 2. Simulation — mandatory before anything is signed.
  try {
    const account = context.account;
    const gas = await context.publicClient.estimateGas({
      account: account ?? undefined,
      to: effectiveIntent.to,
      value: effectiveIntent.value,
      data: effectiveIntent.data,
    });
    if (effectiveIntent.data) {
      // eth_call surfaces reverts with reasons that estimateGas can miss.
      await context.publicClient.call({
        account: account ?? undefined,
        to: effectiveIntent.to,
        value: effectiveIntent.value,
        data: effectiveIntent.data,
      });
    }
    record.simulation = { ok: true, gasEstimate: gas.toString(), simulatedAt: now() };
    push(record, "simulated", `gas ≈ ${gas.toString()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.state = "simulation_failed";
    record.simulation = { ok: false, error: message, simulatedAt: now() };
    record.error = { stage: "simulation", message };
    push(record, "simulation.failed", message.slice(0, 300));
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
  let submittedHash: `0x${string}`;
  if (!context.walletClient || !context.account) {
    record.state = "failed";
    record.error = { stage: "submission", message: "no operator wallet attached (observer mode)" };
    push(record, "submission.failed", "no wallet client");
    await context.sink.save(record);
    return record;
  }

  try {
    const hash = await context.walletClient.sendTransaction({
      account: context.account,
      chain: context.chain,
      to: effectiveIntent.to,
      value: effectiveIntent.value,
      data: effectiveIntent.data,
    });
    submittedHash = hash;
  } catch (error) {
    // Nothing was broadcast: this is the only place "failed" is honest.
    const message = error instanceof Error ? error.message : String(error);
    record.state = "failed";
    record.error = { stage: "submission", message };
    push(record, "submission.failed", message.slice(0, 300));
    await context.sink.save(record);
    return record;
  }

  // ── Past this line a transaction is LIVE on chain. ───────────────────────
  // Nothing that follows may mark the record "failed": bookkeeping that throws
  // after a successful broadcast used to do exactly that, reporting a real
  // transaction as failed AND skipping the allowance debit, which freed the
  // agent to spend the same budget again.
  record.tx = { hash: submittedHash, submittedAt: now() };
  record.state = "submitted";
  push(record, "submitted", submittedHash);

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
    const receipt = await context.publicClient.waitForTransactionReceipt({
      hash: record.tx.hash,
      confirmations: context.confirmations ?? 1,
      timeout: context.confirmationTimeoutMs ?? 120_000,
    });
    record.receipt = {
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      confirmedAt: now(),
    };
    if (receipt.status === "success") {
      record.state = "confirmed";
      push(record, "confirmed", `block ${receipt.blockNumber}`);
    } else {
      record.state = "reverted";
      record.error = { stage: "confirmation", message: "transaction reverted onchain" };
      push(record, "reverted", `block ${receipt.blockNumber}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The tx may still land later — the record keeps the hash so a
    // reconciliation job can settle final state.
    record.state = "failed";
    record.error = { stage: "confirmation", message: `confirmation timed out or failed: ${message}` };
    push(record, "confirmation.failed", message.slice(0, 300));
  }

  try {
    await context.sink.save(record);
  } catch (error) {
    // Same rule as above: the transaction is real whether or not we managed to
    // write it down. Throwing here would lose the record — and its hash — in
    // the caller, which is strictly worse than returning it unpersisted.
    const message = error instanceof Error ? error.message : String(error);
    push(record, "sink.save_failed", message.slice(0, 200));
  }
  return record;
}

/** Rebuild the exact intent a human saw when they approved it. */
function intentFromRecord(record: ExecutionRecord): ExecutionIntent {
  return {
    kind: record.intent.kind,
    summary: record.intent.summary,
    to: record.intent.to,
    value: BigInt(record.intent.value),
    data: record.intent.data,
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

