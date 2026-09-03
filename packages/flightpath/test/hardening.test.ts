import assert from "node:assert/strict";
import { test } from "node:test";
import { executeIntent, resumeApprovedIntent, type ExecutionContext } from "../src/execution.ts";
import { MemorySpendTracker, PolicyEngine, decodedCounterparty, decodedSpend, type WalletPolicy } from "../src/policy.ts";
import { createFlightpath } from "../src/flightpath.ts";
import { MemoryExecutionSink, type ExecutionIntent, type ExecutionRecord } from "../src/types.ts";

const FRIEND = "0x3333333333333333333333333333333333333333" as const;
const ATTACKER = "0x4444444444444444444444444444444444444444" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;

function harness(policy: WalletPolicy) {
  const sends: Array<{ to: string; value: bigint }> = [];
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
      sendTransaction: async (tx: { to: string; value: bigint }) => {
        sends.push({ to: tx.to, value: tx.value });
        return `0x${"a".repeat(64)}`;
      },
    },
    account: { address: FRIEND },
    chain: { id: 4663, name: "Robinhood Chain" },
    policy: new PolicyEngine(policy),
    sink: new MemoryExecutionSink(),
  } as unknown as ExecutionContext;
  return { context, sends };
}

const NEEDS_APPROVAL: WalletPolicy = {
  mode: "operator",
  allowances: [{ asset: "native", perDay: 1_000n }],
  allowedContracts: [],
  approvalThreshold: 0.5,
};

const smallApproved: ExecutionIntent = {
  kind: "transfer.native",
  summary: "send 900 to a friend",
  to: FRIEND,
  value: 900n,
  spendAsset: "native",
  spendAmount: 900n,
  meta: { recipient: FRIEND },
};

test("REGRESSION: an approval cannot be redeemed against a different intent", async () => {
  const { context, sends } = harness(NEEDS_APPROVAL);
  const parked = await executeIntent(context, "swap-1", smallApproved);
  assert.equal(parked.state, "awaiting_approval");

  // The approver reviewed a transfer to FRIEND. Resume must not take an intent
  // from the caller at all — the stored record is the authority.
  const resumed = await resumeApprovedIntent(context, "swap-1", "operator@finch");
  assert.equal(resumed.state, "confirmed");
  assert.equal(sends.length, 1);
  assert.equal(sends[0]!.to.toLowerCase(), FRIEND.toLowerCase(), "must send to the approved recipient");
  assert.equal(sends[0]!.value, 900n, "must send the approved amount");
});

test("REGRESSION: replaying an id with a swapped intent executes the STORED one", async () => {
  const { context, sends } = harness({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 10_000n }],
    allowedContracts: [],
  });
  await executeIntent(context, "dup-1", { ...smallApproved, value: 10n, spendAmount: 10n });
  assert.equal(sends.length, 1);
  assert.equal(sends[0]!.value, 10n);

  // Same id, attacker-controlled intent: must be a no-op replay, not a resend.
  await executeIntent(context, "dup-1", { ...smallApproved, to: ATTACKER, value: 9_000n, spendAmount: 9_000n });
  assert.equal(sends.length, 1, "a replay must never send a second transaction");
});

test("REGRESSION: approving twice is refused", async () => {
  const { context } = harness(NEEDS_APPROVAL);
  await executeIntent(context, "twice-1", smallApproved);
  await resumeApprovedIntent(context, "twice-1", "operator@finch");
  await assert.rejects(() => resumeApprovedIntent(context, "twice-1", "someone-else"), /not awaiting approval|already been approved/);
});

test("REGRESSION: an empty recipient allowlist denies everyone", async () => {
  const engine = new PolicyEngine({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 1_000n }],
    allowedContracts: [],
    allowedRecipients: [],
  });
  const decision = await engine.evaluate({ ...smallApproved, value: 1n, spendAmount: 1n });
  assert.equal(decision.verdict, "deny", "[] must mean nobody, not everybody");
  assert.equal(decision.rule, "recipients.allowlist");
});

test("REGRESSION: contract.write cannot launder a transfer past the allowlist", async () => {
  const engine = new PolicyEngine({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 1_000n }],
    allowedContracts: [TOKEN],
    allowedRecipients: [FRIEND],
  });

  // transfer(ATTACKER, 1000) sent as a raw call to the allowlisted token.
  const calldata = `0xa9059cbb${ATTACKER.slice(2).padStart(64, "0")}${(1000).toString(16).padStart(64, "0")}`;
  const decision = await engine.evaluate({
    kind: "contract.write",
    summary: "call transfer on an allowlisted token",
    to: TOKEN,
    value: 0n,
    data: calldata as `0x${string}`,
    spendAsset: "native",
    spendAmount: 0n,
    meta: { functionName: "transfer" },
  });
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "recipients.allowlist");
});

test("calldata decoding finds the recipient for each value-moving selector", () => {
  const addr = ATTACKER.slice(2).padStart(64, "0");
  const amount = (1).toString(16).padStart(64, "0");
  assert.equal(decodedCounterparty(`0xa9059cbb${addr}${amount}`)?.toLowerCase(), ATTACKER.toLowerCase());
  assert.equal(decodedCounterparty(`0x095ea7b3${addr}${amount}`)?.toLowerCase(), ATTACKER.toLowerCase());
  // transferFrom: recipient is the SECOND address argument
  const from = FRIEND.slice(2).padStart(64, "0");
  assert.equal(decodedCounterparty(`0x23b872dd${from}${addr}${amount}`)?.toLowerCase(), ATTACKER.toLowerCase());
  // an unknown selector is not treated as value-moving
  assert.equal(decodedCounterparty(`0xdeadbeef${addr}`), undefined);
  assert.equal(decodedCounterparty(undefined), undefined);
});

test("REGRESSION: re-deriving a Flightpath does not reset the daily allowance", async () => {
  const flightpath = createFlightpath({
    policy: { mode: "operator", allowances: [{ asset: "native", perDay: 100n }], allowedContracts: [] },
  });
  await flightpath.policyEngine.recordSpend({ ...smallApproved, value: 90n, spendAmount: 90n });

  const derived = flightpath.derive({ agentId: "second-hatch" });
  const decision = await derived.policyEngine.evaluate({ ...smallApproved, value: 90n, spendAmount: 90n });
  assert.equal(decision.verdict, "deny", "a derived finch must inherit spend already made");
  assert.equal(decision.rule, "allowance.daily");
});

test("REGRESSION: an ERC20 transfer via contract.write is priced in that token", async () => {
  const engine = new PolicyEngine({
    mode: "operator",
    // Generous native allowance, tight token allowance — the point is which
    // one the smuggled transfer is charged against.
    allowances: [
      { asset: "native", perDay: 10n ** 30n },
      { asset: TOKEN, perDay: 100n },
    ],
    allowedContracts: [TOKEN],
    allowedRecipients: [FRIEND],
  });

  const huge = (10n ** 24n).toString(16).padStart(64, "0");
  const calldata = `0xa9059cbb${FRIEND.slice(2).padStart(64, "0")}${huge}`;
  const decision = await engine.evaluate({
    kind: "contract.write",
    summary: "transfer via raw call",
    to: TOKEN,
    value: 0n,
    data: calldata as `0x${string}`,
    // What the intent CLAIMS to spend — zero native. The policy must not
    // believe it.
    spendAsset: "native",
    spendAmount: 0n,
    meta: { functionName: "transfer" },
  });
  assert.equal(decision.verdict, "deny", "a smuggled ERC20 transfer must not skip allowances");
  assert.match(decision.rule, /^allowance\./);
});

test("REGRESSION: recordSpend debits the token a contract.write actually moved", async () => {
  const tracker = new MemorySpendTracker();
  const engine = new PolicyEngine(
    {
      mode: "operator",
      allowances: [{ asset: TOKEN, perDay: 100n }],
      allowedContracts: [TOKEN],
      allowedRecipients: [FRIEND],
    },
    tracker,
  );
  const amount = (60).toString(16).padStart(64, "0");
  const intent: ExecutionIntent = {
    kind: "contract.write",
    summary: "transfer 60 via raw call",
    to: TOKEN,
    value: 0n,
    data: `0xa9059cbb${FRIEND.slice(2).padStart(64, "0")}${amount}` as `0x${string}`,
    spendAsset: "native",
    spendAmount: 0n,
    meta: {},
  };
  assert.equal((await engine.evaluate(intent)).verdict, "allow");
  await engine.recordSpend(intent);
  assert.equal(await tracker.spentInWindow(TOKEN, 86_400_000), 60n, "the token must be debited, not native");

  // 60 + 60 > 100 → the second one is refused.
  const second = await engine.evaluate(intent);
  assert.equal(second.verdict, "deny");
  assert.equal(second.rule, "allowance.daily");
});

test("ERC721 safeTransferFrom is recipient-checked but not priced as fungible", () => {
  const from = FRIEND.slice(2).padStart(64, "0");
  const to = ATTACKER.slice(2).padStart(64, "0");
  const tokenId = (7).toString(16).padStart(64, "0");
  const data = `0x42842e0e${from}${to}${tokenId}`;
  assert.equal(decodedCounterparty(data)?.toLowerCase(), ATTACKER.toLowerCase());
  assert.equal(decodedSpend(data), undefined, "a token id is not an amount");
});

test("REGRESSION: a value-moving contract.write to a registry asset still hits the RWA gate", async () => {
  const RWA = "0x5555555555555555555555555555555555555555" as const;
  const OTHER_RWA = "0x6666666666666666666666666666666666666666" as const;
  // OTHER_RWA is a known registry asset; RWA is not approved.
  const engine = new PolicyEngine(
    {
      mode: "operator",
      allowances: [{ asset: "native", perDay: 10n ** 30n }, { asset: RWA, perDay: 10n ** 30n }],
      allowedContracts: [RWA, OTHER_RWA],
      allowedRecipients: [FRIEND],
    },
    new MemorySpendTracker(),
    { rwaApprovedAssets: [OTHER_RWA] },
  );

  // Claiming rwa.interact on an unapproved asset is denied.
  const direct = await engine.evaluate({
    kind: "rwa.interact",
    summary: "rwa transfer",
    to: RWA,
    value: 0n,
    spendAsset: RWA,
    spendAmount: 1n,
    meta: { counterparty: FRIEND },
  });
  assert.equal(direct.rule, "rwa.approved");

  // And a raw call to an APPROVED registry asset is still routed through the
  // RWA rules rather than skipping them because of its intent kind.
  const amount = (1).toString(16).padStart(64, "0");
  const viaContractWrite = await engine.evaluate({
    kind: "contract.write",
    summary: "transfer via raw call",
    to: OTHER_RWA,
    value: 0n,
    data: `0xa9059cbb${FRIEND.slice(2).padStart(64, "0")}${amount}` as `0x${string}`,
    spendAsset: "native",
    spendAmount: 0n,
    meta: {},
  });
  // Approved + allowlisted contract + allowlisted counterparty, but it must
  // have been priced in the token rather than as a free native call.
  assert.equal(viaContractWrite.verdict, "deny");
  assert.equal(viaContractWrite.rule, "allowance.missing", "priced in the RWA token, which has no allowance");
});

test("REGRESSION: a nonsensical approvalThreshold is refused, not silently ignored", () => {
  const base = {
    mode: "operator" as const,
    allowances: [{ asset: "native" as const, perDay: 1_000n }],
    allowedContracts: [],
  };
  // 1.5 used to make the human gate disappear entirely.
  assert.throws(() => new PolicyEngine({ ...base, approvalThreshold: 1.5 }), /invalid approvalThreshold/);
  assert.throws(() => new PolicyEngine({ ...base, approvalThreshold: -1 }), /invalid approvalThreshold/);
  assert.throws(() => new PolicyEngine({ ...base, approvalThreshold: Number.NaN }), /invalid approvalThreshold/);
  // A valid one still constructs and still gates.
  assert.doesNotThrow(() => new PolicyEngine({ ...base, approvalThreshold: 0.5 }));
});

test("REGRESSION: concurrent calls on one fresh id produce exactly one transaction", async () => {
  const { context, sends } = harness({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 10_000n }],
    allowedContracts: [],
  });
  const intent: ExecutionIntent = {
    kind: "transfer.native",
    summary: "send",
    to: FRIEND,
    value: 100n,
    spendAsset: "native",
    spendAmount: 100n,
    meta: { recipient: FRIEND },
  };

  // Fire them together, before either has saved anything.
  const results = await Promise.all([
    executeIntent(context, "race-1", intent),
    executeIntent(context, "race-1", intent),
    executeIntent(context, "race-1", intent),
  ]);

  assert.equal(sends.length, 1, "three racing callers must yield one broadcast");
  assert.ok(results.every((record) => record.id === "race-1"));
});

test("REGRESSION: a double-clicked approve broadcasts once", async () => {
  const { context, sends } = harness(NEEDS_APPROVAL);
  await executeIntent(context, "dbl-1", smallApproved);

  const outcomes = await Promise.allSettled([
    resumeApprovedIntent(context, "dbl-1", "operator@finch"),
    resumeApprovedIntent(context, "dbl-1", "operator@finch"),
  ]);

  assert.equal(sends.length, 1, "one human approval must not become two transactions");
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
});

test("a sink without reservation still works, but records that it is unprotected", async () => {
  // A third-party sink that implements only the required surface — no atomic
  // primitives. This is the realistic case the warning exists for.
  const stored = new Map<string, ExecutionRecord>();
  const minimalSink = {
    async save(record: ExecutionRecord) {
      stored.set(record.id, structuredClone(record));
    },
    async get(id: string) {
      const found = stored.get(id);
      return found ? structuredClone(found) : null;
    },
  };

  const { context } = harness({
    mode: "operator",
    allowances: [{ asset: "native", perDay: 10_000n }],
    allowedContracts: [],
  });
  (context as { sink: unknown }).sink = minimalSink;

  const record = await executeIntent(context, "unprotected-1", {
    kind: "transfer.native",
    summary: "send",
    to: FRIEND,
    value: 1n,
    spendAsset: "native",
    spendAmount: 1n,
    meta: { recipient: FRIEND },
  });
  assert.equal(record.state, "confirmed");
  assert.ok(
    record.log.some((entry) => entry.event === "sink.no_reservation"),
    "the record must say it ran without concurrency protection rather than implying it had it",
  );
});
