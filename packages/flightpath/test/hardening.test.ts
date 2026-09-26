import assert from "node:assert/strict";
import { test } from "node:test";
import { executeIntent, resumeApprovedIntent } from "../src/execution.ts";
import { createFlightpath } from "../src/flightpath.ts";
import { PolicyEngine, TOKEN_PROGRAM, type WalletPolicy } from "../src/policy.ts";
import type { ExecutionIntent, ExecutionRecord } from "../src/types.ts";
import { addresses, harness, sentTransfers, solTransfer, tokenTransfer, USDC } from "./solana-fixture.ts";

const [FRIEND, ATTACKER] = await addresses(2);

const NEEDS_APPROVAL: WalletPolicy = {
  mode: "operator",
  allowances: [{ asset: "native", perDay: 1_000n }],
  allowedPrograms: [],
  approvalThreshold: 0.5,
};

const OPEN: WalletPolicy = { mode: "operator", allowances: [{ asset: "native", perDay: 10_000n }], allowedPrograms: [] };

function transfer(from: string, to: string, lamports: bigint, summary = `send ${lamports}`): ExecutionIntent {
  return {
    kind: "transfer.native",
    summary,
    to,
    instructions: [solTransfer(from, to, lamports)],
    spendAsset: "native",
    spendAmount: lamports,
    meta: { recipient: to },
  };
}

test("REGRESSION: an approval cannot be redeemed against a different intent", async () => {
  const { context, operator, calls } = await harness(NEEDS_APPROVAL);
  const parked = await executeIntent(context, "swap-1", transfer(operator.address, FRIEND!, 900n));
  assert.equal(parked.state, "awaiting_approval");

  // The approver reviewed a transfer to FRIEND. Resume must not take an intent
  // from the caller at all — the stored record is the authority.
  const resumed = await resumeApprovedIntent(context, "swap-1", "operator@finch");
  assert.equal(resumed.state, "confirmed");
  const sent = await sentTransfers(calls);
  assert.deepEqual(sent, [{ to: FRIEND, lamports: 900n }], "must send the approved amount to the approved recipient");
});

test("REGRESSION: replaying an id with a swapped intent executes the STORED one", async () => {
  const { context, operator, sends } = await harness(OPEN);
  await executeIntent(context, "dup-1", transfer(operator.address, FRIEND!, 10n));
  assert.equal(sends().length, 1);

  // Same id, attacker-controlled intent: must be a no-op replay, not a resend.
  await executeIntent(context, "dup-1", transfer(operator.address, ATTACKER!, 9_000n));
  assert.equal(sends().length, 1, "a replay must never send a second transaction");
});

test("REGRESSION: approving twice is refused", async () => {
  const { context, operator } = await harness(NEEDS_APPROVAL);
  await executeIntent(context, "twice-1", transfer(operator.address, FRIEND!, 900n));
  await resumeApprovedIntent(context, "twice-1", "operator@finch");
  await assert.rejects(() => resumeApprovedIntent(context, "twice-1", "someone-else"), /not awaiting approval|already been approved/);
});

test("REGRESSION: an empty recipient allowlist denies everyone", async () => {
  const engine = new PolicyEngine({ ...OPEN, allowedRecipients: [] });
  const decision = await engine.evaluate(transfer(FRIEND!, FRIEND!, 1n));
  assert.equal(decision.verdict, "deny", "[] must mean nobody, not everybody");
  assert.equal(decision.rule, "recipients.allowlist");
});

test("REGRESSION: program_invoke cannot launder a transfer past the allowlist", async () => {
  // The Token program is allowlisted, and a raw TransferChecked to ATTACKER is
  // sent through it. The policy decodes the instruction and finds ATTACKER's
  // token account as the counterparty.
  const engine = new PolicyEngine({
    mode: "operator",
    allowances: [{ asset: USDC, perDay: 1_000n }],
    allowedPrograms: [TOKEN_PROGRAM],
    allowedRecipients: [FRIEND!],
  });
  const decision = await engine.evaluate({
    kind: "program.invoke",
    summary: "raw token instruction",
    to: TOKEN_PROGRAM,
    instructions: [await tokenTransfer(FRIEND!, ATTACKER!, USDC, 1_000n)],
    spendAsset: "native",
    spendAmount: 0n,
  });
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "recipients.allowlist");
});

test("REGRESSION: a token transfer via program_invoke is priced in that token", async () => {
  const engine = new PolicyEngine({ mode: "operator", allowances: [{ asset: "native", perDay: 1_000_000n }], allowedPrograms: [TOKEN_PROGRAM] });
  const decision = await engine.evaluate({
    kind: "program.invoke",
    summary: "raw token instruction",
    to: TOKEN_PROGRAM,
    instructions: [await tokenTransfer(FRIEND!, ATTACKER!, USDC, 5n)],
    // The builder claims a zero SOL spend; the instructions say otherwise.
    spendAsset: "native",
    spendAmount: 0n,
  });
  assert.equal(decision.rule, "allowance.missing", "USDC moved, and there is no USDC allowance");
});

test("REGRESSION: recordSpend debits the token the instructions actually moved", async () => {
  const engine = new PolicyEngine({ mode: "operator", allowances: [{ asset: USDC, perDay: 10n }], allowedPrograms: [TOKEN_PROGRAM] });
  await engine.recordSpend({
    kind: "program.invoke",
    summary: "raw",
    to: TOKEN_PROGRAM,
    instructions: [await tokenTransfer(FRIEND!, FRIEND!, USDC, 8n)],
    spendAsset: "native",
    spendAmount: 0n,
  });
  assert.equal(await engine.spendTracker.spentInWindow(USDC, 86_400_000), 8n);
  assert.equal(await engine.spendTracker.spentInWindow("native", 86_400_000), 0n);
});

test("REGRESSION: re-deriving a Flightpath does not reset the daily allowance", async () => {
  const flightpath = createFlightpath({ policy: { mode: "operator", allowances: [{ asset: "native", perDay: 100n }], allowedPrograms: [] } });
  await flightpath.policyEngine.recordSpend(transfer(FRIEND!, FRIEND!, 90n));

  const derived = flightpath.derive({ agentId: "second-hatch" });
  const decision = await derived.policyEngine.evaluate(transfer(FRIEND!, FRIEND!, 90n));
  assert.equal(decision.verdict, "deny", "a derived finch must inherit spend already made");
  assert.equal(decision.rule, "allowance.daily");
});

test("REGRESSION: a nonsensical approvalThreshold is refused, not silently ignored", () => {
  for (const approvalThreshold of [1.5, -0.1, Number.NaN]) {
    assert.throws(() => new PolicyEngine({ ...OPEN, approvalThreshold }), /invalid approvalThreshold/);
  }
});

test("REGRESSION: concurrent calls on one fresh id produce exactly one transaction", async () => {
  const { context, operator, sends } = await harness(OPEN);
  const intent = transfer(operator.address, FRIEND!, 100n);

  // Fire them together, before either has saved anything.
  const results = await Promise.all([
    executeIntent(context, "race-1", intent),
    executeIntent(context, "race-1", intent),
    executeIntent(context, "race-1", intent),
  ]);

  assert.equal(sends().length, 1, "three racing callers must yield one broadcast");
  assert.ok(results.every((record) => record.id === "race-1"));
});

test("REGRESSION: a double-clicked approve broadcasts once", async () => {
  const { context, operator, sends } = await harness(NEEDS_APPROVAL);
  await executeIntent(context, "dbl-1", transfer(operator.address, FRIEND!, 900n));

  const outcomes = await Promise.allSettled([
    resumeApprovedIntent(context, "dbl-1", "operator@finch"),
    resumeApprovedIntent(context, "dbl-1", "operator@finch"),
  ]);

  assert.equal(sends().length, 1, "one human approval must not become two transactions");
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
});

test("a sink without reservation still works, but records that it is unprotected", async () => {
  // A third-party sink that implements only the required surface — no atomic
  // primitives. This is the realistic case the warning exists for.
  const stored = new Map<string, ExecutionRecord>();
  const { context, operator } = await harness(OPEN);
  context.sink = {
    async save(record: ExecutionRecord) {
      stored.set(record.id, structuredClone(record));
    },
    async get(id: string) {
      const found = stored.get(id);
      return found ? structuredClone(found) : null;
    },
  };

  const record = await executeIntent(context, "unprotected-1", transfer(operator.address, FRIEND!, 1n));
  assert.equal(record.state, "confirmed");
  assert.ok(
    record.log.some((entry) => entry.event === "sink.no_reservation"),
    "the record must say it ran without concurrency protection rather than implying it had it",
  );
});

test("REGRESSION: a replay during an in-flight approved resume broadcasts once", async () => {
  const { context, operator, sends, handlers } = await harness(NEEDS_APPROVAL);

  // Simulation runs BEFORE the approval gate, so the initial park simulates
  // too. Only hold the resume's simulation open, or the park deadlocks.
  let holdEnabled = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realSimulate = handlers.simulateTransaction!;
  handlers.simulateTransaction = async (...args: unknown[]) => {
    if (holdEnabled) {
      holdEnabled = false;
      await held;
    }
    return realSimulate(...args);
  };

  const intent = transfer(operator.address, FRIEND!, 900n);
  const parked = await executeIntent(context, "inflight-1", intent);
  assert.equal(parked.state, "awaiting_approval");

  holdEnabled = true;
  const resuming = resumeApprovedIntent(context, "inflight-1", "operator@finch");
  // Let the resume reach the held simulation before replaying the id.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const replay = await executeIntent(context, "inflight-1", intent);
  release();
  await resuming;

  assert.equal(sends().length, 1, "one approval must not become two transactions");
  assert.equal(replay.id, "inflight-1");
});

test("REGRESSION: a save failing after broadcast must not report a live tx as failed", async () => {
  const { context, operator, sends } = await harness(OPEN);
  const sink = context.sink as { save: (record: ExecutionRecord) => Promise<void> };
  const realSave = sink.save.bind(sink);
  sink.save = async (record: ExecutionRecord) => {
    if (record.tx?.signature) throw new Error("sink unavailable");
    return realSave(record);
  };

  const record = await executeIntent(context, "postbroadcast-1", transfer(operator.address, FRIEND!, 100n));

  assert.equal(sends().length, 1, "the transaction really was broadcast");
  assert.ok(record.tx?.signature, "the signature must be kept so the tx can be reconciled");
  assert.notEqual(record.state, "failed", "a broadcast transaction is not a failed one");
  assert.ok(
    record.log.some((entry) => entry.event === "sink.save_failed"),
    "the persistence failure must be surfaced, not swallowed",
  );
});

test("REGRESSION: concurrent executions cannot overspend one daily allowance", async () => {
  // Room for exactly two 400-lamport sends.
  const { context, operator, sends } = await harness({ mode: "operator", allowances: [{ asset: "native", perDay: 1_000n }], allowedPrograms: [] });

  const results = await Promise.all([
    executeIntent(context, "cap-1", transfer(operator.address, FRIEND!, 400n, "send 1")),
    executeIntent(context, "cap-2", transfer(operator.address, FRIEND!, 400n, "send 2")),
    executeIntent(context, "cap-3", transfer(operator.address, FRIEND!, 400n, "send 3")),
  ]);

  assert.equal(sends().length, 2, "1000 lamports of allowance must fund exactly two 400-lamport sends");
  const refused = results.filter((record) => record.state === "failed");
  assert.equal(refused.length, 1);
  assert.match(refused[0]?.error?.message ?? "", /daily allowance/);
});

test("external signing parks with the exact prepared instructions and sends nothing", async () => {
  // The step from read-only to "does things", without a server key: the
  // finch proposes, policy and simulation run, and the record stops with the
  // instructions prepared for the visitor's wallet. Nothing is broadcast.
  const { context, sends, calls } = await harness({ mode: "operator", allowances: [{ asset: "native", perDay: 10_000n, perTx: 1_000n }], allowedPrograms: [] });
  context.signing = "external";
  context.externalSigner = FRIEND;
  context.signer = undefined; // this process holds no key

  const intent = transfer(FRIEND!, ATTACKER!, 500n);
  const record = await executeIntent(context, "ext-1", intent);

  assert.equal(sends().length, 0, "nothing may be broadcast from a process with no signer");
  assert.equal(record.state, "awaiting_signature");
  assert.equal(record.simulation?.ok, true, "simulation still ran, as the signer");
  assert.ok(calls.some((call) => call.method === "simulateTransaction"));
  assert.equal(record.prepared?.feePayer, FRIEND);
  assert.deepEqual(record.prepared?.instructions, intent.instructions, "exactly the instructions the policy approved");
  assert.ok(Number(record.prepared?.computeUnits) > 450, "the compute budget comes from the simulation, with headroom");
});

test("external signing turns needs_approval into awaiting_signature — the signer is the approver", async () => {
  const { context, sends } = await harness(NEEDS_APPROVAL);
  context.signing = "external";
  context.externalSigner = FRIEND;
  context.signer = undefined;

  const record = await executeIntent(context, "ext-2", transfer(FRIEND!, ATTACKER!, 900n));
  assert.equal(sends().length, 0);
  assert.equal(record.state, "awaiting_signature");
  assert.equal(record.policy?.verdict, "needs_approval", "the verdict is recorded, not erased");
  assert.ok(record.log.some((entry) => /signer is the approver/.test(entry.detail ?? "")));
});

test("an operator-mode policy with no signer at all fails before simulation, honestly", async () => {
  const { context, operator, calls } = await harness(OPEN);
  context.signer = undefined;
  context.signing = undefined;
  const record = await executeIntent(context, "nosigner-1", transfer(operator.address, FRIEND!, 1n));
  assert.equal(record.state, "failed");
  assert.match(record.error?.message ?? "", /no signer/);
  assert.ok(!calls.some((call) => call.method === "simulateTransaction"), "nothing to simulate as");
});
