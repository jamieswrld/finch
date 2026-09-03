import assert from "node:assert/strict";
import { test } from "node:test";
import { executeIntent, resumeApprovedIntent, type ExecutionContext } from "../src/execution.ts";
import { PolicyEngine, type WalletPolicy } from "../src/policy.ts";
import { MemoryExecutionSink, type ExecutionIntent } from "../src/types.ts";

const FRIEND = "0x3333333333333333333333333333333333333333" as const;
const CHAIN = { id: 4663, name: "Robinhood Chain" } as never;

/** Counts every send so a bypass shows up as a real extra transaction. */
function harness(policy: WalletPolicy) {
  const sends: unknown[] = [];
  const sink = new MemoryExecutionSink();
  const context = {
    publicClient: {
      estimateGas: async () => 21_000n,
      call: async () => ({ data: "0x" }),
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 1n,
        gasUsed: 21_000n,
        effectiveGasPrice: 1n,
      }),
    },
    walletClient: {
      sendTransaction: async (tx: unknown) => {
        sends.push(tx);
        return `0x${"a".repeat(64)}`;
      },
    },
    account: { address: FRIEND },
    chain: CHAIN,
    policy: new PolicyEngine(policy),
    sink,
  } as unknown as ExecutionContext;
  return { context, sends, sink };
}

const bigSpend: ExecutionIntent = {
  kind: "transfer.native",
  summary: "send 900",
  to: FRIEND,
  value: 900n,
  spendAsset: "native",
  spendAmount: 900n,
  meta: { recipient: FRIEND },
};

const needsApproval: WalletPolicy = {
  mode: "operator",
  allowances: [{ asset: "native", perDay: 1_000n }],
  allowedContracts: [],
  approvalThreshold: 0.5,
};

test("an intent over the approval threshold parks instead of sending", async () => {
  const { context, sends } = harness(needsApproval);
  const record = await executeIntent(context, "exec-1", bigSpend);
  assert.equal(record.state, "awaiting_approval");
  assert.equal(sends.length, 0, "nothing may be broadcast before sign-off");
});

test("REGRESSION: replaying a parked intent must NOT submit it", async () => {
  const { context, sends } = harness(needsApproval);
  await executeIntent(context, "exec-2", bigSpend);

  // Same id, no approval — this used to slip past the gate and send.
  const second = await executeIntent(context, "exec-2", bigSpend);
  assert.equal(second.state, "awaiting_approval");
  assert.equal(sends.length, 0, "a replay must never be a way around the approval gate");

  const third = await executeIntent(context, "exec-2", bigSpend);
  assert.equal(third.state, "awaiting_approval");
  assert.equal(sends.length, 0);
});

test("an explicit approval releases the intent exactly once", async () => {
  const { context, sends } = harness(needsApproval);
  await executeIntent(context, "exec-3", bigSpend);

  // The intent comes from the stored record, never from the caller.
  const resumed = await resumeApprovedIntent(context, "exec-3", "operator@finch");
  assert.equal(resumed.state, "confirmed");
  assert.equal(resumed.approval?.approvedBy, "operator@finch");
  assert.equal(sends.length, 1);

  // Replaying the now-settled execution is a no-op, not a second transfer.
  const replay = await executeIntent(context, "exec-3", bigSpend);
  assert.equal(replay.state, "confirmed");
  assert.equal(sends.length, 1, "idempotent on id");
});

test("a denied intent never reaches simulation or submission", async () => {
  const { context, sends } = harness({ mode: "observer", allowances: [], allowedContracts: [] });
  const record = await executeIntent(context, "exec-4", bigSpend);
  assert.equal(record.state, "denied");
  assert.equal(record.simulation, undefined, "policy runs before simulation");
  assert.equal(sends.length, 0);
});

test("a simulation failure halts before signing", async () => {
  const { context, sends } = harness({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 10_000n }],
    allowedContracts: [],
  });
  (context.publicClient as unknown as { estimateGas: () => Promise<bigint> }).estimateGas = async () => {
    throw new Error("execution reverted: insufficient funds");
  };
  const record = await executeIntent(context, "exec-5", bigSpend);
  assert.equal(record.state, "simulation_failed");
  assert.match(record.error?.message ?? "", /reverted/);
  assert.equal(sends.length, 0);
});

test("spend is debited at submission so a lost receipt cannot inflate the cap", async () => {
  const { context, sends } = harness({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 1_000n }],
    allowedContracts: [],
  });
  // Receipt never arrives — the transaction may still land.
  (context.publicClient as unknown as { waitForTransactionReceipt: () => Promise<never> }).waitForTransactionReceipt =
    async () => {
      throw new Error("timeout waiting for receipt");
    };

  const first = await executeIntent(context, "exec-6", { ...bigSpend, value: 600n, spendAmount: 600n });
  assert.equal(first.state, "failed");
  assert.equal(sends.length, 1);
  assert.ok(first.tx?.hash, "the hash is retained for reconciliation");

  // The 600 must already count against the 1000 daily cap.
  const second = await executeIntent(context, "exec-7", { ...bigSpend, value: 600n, spendAmount: 600n });
  assert.equal(second.state, "denied");
  assert.equal(second.policy?.rule, "allowance.daily");
  assert.equal(sends.length, 1, "the second spend must not be broadcast");
});
