import assert from "node:assert/strict";
import { test } from "node:test";
import { executeIntent, resumeApprovedIntent } from "../src/execution.ts";
import type { WalletPolicy } from "../src/policy.ts";
import type { ExecutionIntent } from "../src/types.ts";
import { addresses, harness, solTransfer } from "./solana-fixture.ts";

const [FRIEND] = await addresses(1);

const needsApproval: WalletPolicy = {
  mode: "operator",
  allowances: [{ asset: "native", perDay: 1_000n }],
  allowedPrograms: [],
  approvalThreshold: 0.5,
};

function spend(from: string, lamports: bigint): ExecutionIntent {
  return {
    kind: "transfer.native",
    summary: `send ${lamports}`,
    to: FRIEND!,
    instructions: [solTransfer(from, FRIEND!, lamports)],
    spendAsset: "native",
    spendAmount: lamports,
    meta: { recipient: FRIEND! },
  };
}

test("an intent over the approval threshold parks instead of sending", async () => {
  const { context, operator, sends } = await harness(needsApproval);
  const record = await executeIntent(context, "exec-1", spend(operator.address, 900n));
  assert.equal(record.state, "awaiting_approval");
  assert.equal(sends().length, 0, "nothing may be broadcast before sign-off");
});

test("REGRESSION: replaying a parked intent must NOT submit it", async () => {
  const { context, operator, sends } = await harness(needsApproval);
  const big = spend(operator.address, 900n);
  await executeIntent(context, "exec-2", big);

  // Same id, no approval — this must never slip past the gate.
  assert.equal((await executeIntent(context, "exec-2", big)).state, "awaiting_approval");
  assert.equal((await executeIntent(context, "exec-2", big)).state, "awaiting_approval");
  assert.equal(sends().length, 0, "a replay must never be a way around the approval gate");
});

test("an explicit approval releases the intent exactly once", async () => {
  const { context, operator, sends } = await harness(needsApproval);
  const big = spend(operator.address, 900n);
  await executeIntent(context, "exec-3", big);

  // The intent comes from the stored record, never from the caller.
  const resumed = await resumeApprovedIntent(context, "exec-3", "operator@finch");
  assert.equal(resumed.state, "confirmed");
  assert.equal(resumed.approval?.approvedBy, "operator@finch");
  assert.equal(resumed.receipt?.slot, "42");
  assert.equal(resumed.receipt?.feeLamports, "5000");
  assert.equal(sends().length, 1);

  // Replaying the now-settled execution is a no-op, not a second transfer.
  const replay = await executeIntent(context, "exec-3", big);
  assert.equal(replay.state, "confirmed");
  assert.equal(sends().length, 1, "idempotent on id");
});

test("a denied intent never reaches simulation or submission", async () => {
  const { context, operator, sends, calls } = await harness({ mode: "observer", allowances: [], allowedPrograms: [] });
  const record = await executeIntent(context, "exec-4", spend(operator.address, 900n));
  assert.equal(record.state, "denied");
  assert.equal(record.simulation, undefined, "policy runs before simulation");
  assert.ok(!calls.some((call) => call.method === "simulateTransaction"));
  assert.equal(sends().length, 0);
});

test("a simulation failure halts before signing, with the program's own reason", async () => {
  const { context, operator, sends } = await harness(
    { mode: "operator", allowances: [{ asset: "native", perDay: 10_000n }], allowedPrograms: [] },
    {
      simulateTransaction: () => ({
        context: { slot: 1n },
        value: { err: { InstructionError: [0, { Custom: 1 }] }, logs: ["Transfer: insufficient lamports 0, need 900"], unitsConsumed: 150n, accounts: null },
      }),
    },
  );
  const record = await executeIntent(context, "exec-5", spend(operator.address, 900n));
  assert.equal(record.state, "simulation_failed");
  assert.match(record.error?.message ?? "", /insufficient lamports/);
  assert.equal(sends().length, 0);
});

test("a transaction that lands with an error is reverted, not confirmed", async () => {
  const { context, operator } = await harness(
    { mode: "operator", allowances: [{ asset: "native", perDay: 10_000n }], allowedPrograms: [] },
    {
      getSignatureStatuses: () => ({ context: { slot: 1n }, value: [{ slot: 42n, confirmations: 1n, err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] }),
      getTransaction: () => ({ slot: 42n, meta: { err: { InstructionError: [0, "Custom"] }, fee: 5_000n, computeUnitsConsumed: 300n }, transaction: ["", "base64"] }),
    },
  );
  const record = await executeIntent(context, "exec-rev", spend(operator.address, 100n));
  assert.equal(record.state, "reverted");
  assert.equal(record.receipt?.status, "failed");
  assert.equal(record.receipt?.feeLamports, "5000", "a failed transaction still paid its fee");
});

test("an expired blockhash is a definite 'nothing happened'", async () => {
  const { context, operator } = await harness(
    { mode: "operator", allowances: [{ asset: "native", perDay: 10_000n }], allowedPrograms: [] },
    {
      getSignatureStatuses: () => ({ context: { slot: 1n }, value: [null] }),
      getBlockHeight: () => 2_000n, // past lastValidBlockHeight 1000
    },
  );
  const record = await executeIntent(context, "exec-exp", spend(operator.address, 100n));
  assert.equal(record.state, "failed");
  assert.match(record.error?.message ?? "", /blockhash expired/);
});

test("spend is debited at submission so a lost confirmation cannot inflate the cap", async () => {
  const { context, operator, sends } = await harness(
    { mode: "operator", allowances: [{ asset: "native", perDay: 1_000n }], allowedPrograms: [] },
    // Confirmation never arrives — the transaction may still land.
    { getSignatureStatuses: () => ({ context: { slot: 1n }, value: [null] }), getBlockHeight: () => 10n },
  );
  context.confirmationTimeoutMs = 300;

  const first = await executeIntent(context, "exec-6", spend(operator.address, 600n));
  assert.equal(first.state, "failed");
  assert.equal(sends().length, 1);
  assert.ok(first.tx?.signature, "the signature is retained for reconciliation");

  // The 600 must already count against the 1000 daily cap.
  const second = await executeIntent(context, "exec-7", spend(operator.address, 600n));
  assert.equal(second.state, "denied");
  assert.equal(second.policy?.rule, "allowance.daily");
  assert.equal(sends().length, 1, "the second spend must not be broadcast");
});
