import assert from "node:assert/strict";
import { test } from "node:test";
import { MemorySpendTracker, POLICY_RULES, PolicyEngine, type WalletPolicy } from "../src/policy.ts";
import type { ExecutionIntent } from "../src/types.ts";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const ROUTER = "0x2222222222222222222222222222222222222222" as const;
const FRIEND = "0x3333333333333333333333333333333333333333" as const;
const STRANGER = "0x4444444444444444444444444444444444444444" as const;
const RWA = "0x5555555555555555555555555555555555555555" as const;

function operatorPolicy(overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return {
    mode: "operator",
    allowances: [{ asset: "native", perDay: 1_000n }, { asset: TOKEN, perDay: 1_000n }],
    allowedContracts: [TOKEN, ROUTER],
    ...overrides,
  };
}

const approveIntent = (spender: string, token = TOKEN): ExecutionIntent => ({
  kind: "erc20.approve",
  summary: "approve",
  to: token as `0x${string}`,
  value: 0n,
  data: "0x",
  spendAsset: TOKEN,
  spendAmount: 10n,
  meta: { spender, token },
});

test("observer mode denies every write", async () => {
  const engine = new PolicyEngine({ mode: "observer", allowances: [], allowedContracts: [] });
  const decision = await engine.evaluate(approveIntent(FRIEND));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "wallet.mode");
});

test("erc20.approve is bound by the recipient allowlist via its SPENDER", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND] }));
  assert.equal((await engine.evaluate(approveIntent(FRIEND))).verdict, "allow");

  const denied = await engine.evaluate(approveIntent(STRANGER));
  assert.equal(denied.verdict, "deny", "an approval to a stranger must not pass");
  assert.equal(denied.rule, "recipients.allowlist");
});

test("erc20.approve is bound by the contract allowlist via its TOKEN", async () => {
  const engine = new PolicyEngine(operatorPolicy());
  const unlisted = "0x9999999999999999999999999999999999999999";
  const denied = await engine.evaluate({ ...approveIntent(FRIEND, unlisted), spendAsset: "native" });
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.rule, "contracts.allowlist");
});

test("rwa.interact checks its counterparty against the allowlist", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND] }), new MemorySpendTracker(), {
    rwaApprovedAssets: [RWA],
  });
  const intent: ExecutionIntent = {
    kind: "rwa.interact",
    summary: "rwa transfer",
    to: RWA,
    value: 0n,
    data: "0x",
    spendAsset: RWA,
    spendAmount: 1n,
    meta: { action: "transfer", counterparty: STRANGER },
  };
  const denied = await engine.evaluate(intent);
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.rule, "recipients.allowlist");
});

test("rwa.interact stays gated on the approved registry", async () => {
  const engine = new PolicyEngine(operatorPolicy(), new MemorySpendTracker(), { rwaApprovedAssets: [] });
  const denied = await engine.evaluate({
    kind: "rwa.interact",
    summary: "rwa transfer",
    to: RWA,
    value: 0n,
    spendAsset: RWA,
    spendAmount: 1n,
    meta: { counterparty: FRIEND },
  });
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.rule, "rwa.approved");
});

test("daily allowance exhausts across separate spends", async () => {
  const tracker = new MemorySpendTracker();
  const engine = new PolicyEngine(operatorPolicy(), tracker);
  const intent: ExecutionIntent = {
    kind: "transfer.native",
    summary: "send",
    to: FRIEND,
    value: 600n,
    spendAsset: "native",
    spendAmount: 600n,
    meta: { recipient: FRIEND },
  };
  assert.equal((await engine.evaluate(intent)).verdict, "allow");
  await engine.recordSpend(intent);
  const second = await engine.evaluate(intent);
  assert.equal(second.verdict, "deny");
  assert.equal(second.rule, "allowance.daily");
});

test("per-transaction cap is enforced independently of the daily cap", async () => {
  const engine = new PolicyEngine(
    operatorPolicy({ allowances: [{ asset: "native", perDay: 1_000n, perTx: 100n }] }),
  );
  const decision = await engine.evaluate({
    kind: "transfer.native",
    summary: "send",
    to: FRIEND,
    value: 500n,
    spendAsset: "native",
    spendAmount: 500n,
    meta: { recipient: FRIEND },
  });
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "allowance.perTx");
});

test("spends above the approval threshold need a human", async () => {
  const engine = new PolicyEngine(operatorPolicy({ approvalThreshold: 0.5 }));
  const decision = await engine.evaluate({
    kind: "transfer.native",
    summary: "send",
    to: FRIEND,
    value: 900n,
    spendAsset: "native",
    spendAmount: 900n,
    meta: { recipient: FRIEND },
  });
  assert.equal(decision.verdict, "needs_approval");
});

test("POLICY_RULES documents every rule the engine can actually emit", async () => {
  const emitted = new Set<string>();

  const observer = new PolicyEngine({ mode: "observer", allowances: [], allowedContracts: [] });
  emitted.add((await observer.evaluate(approveIntent(FRIEND))).rule);

  const recipients = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND] }));
  emitted.add((await recipients.evaluate(approveIntent(STRANGER))).rule);

  const contracts = new PolicyEngine(operatorPolicy());
  emitted.add(
    (await contracts.evaluate({ ...approveIntent(FRIEND, "0x9999999999999999999999999999999999999999"), spendAsset: "native" })).rule,
  );

  const rwa = new PolicyEngine(operatorPolicy(), new MemorySpendTracker(), { rwaApprovedAssets: [] });
  emitted.add(
    (await rwa.evaluate({
      kind: "rwa.interact",
      summary: "x",
      to: RWA,
      value: 0n,
      spendAsset: RWA,
      spendAmount: 1n,
      meta: { counterparty: FRIEND },
    })).rule,
  );

  const noAllowance = new PolicyEngine({ mode: "operator", allowances: [], allowedContracts: [] });
  emitted.add(
    (await noAllowance.evaluate({
      kind: "transfer.native",
      summary: "x",
      to: FRIEND,
      value: 5n,
      spendAsset: "native",
      spendAmount: 5n,
      meta: { recipient: FRIEND },
    })).rule,
  );

  const perTx = new PolicyEngine(operatorPolicy({ allowances: [{ asset: "native", perDay: 1_000n, perTx: 10n }] }));
  emitted.add(
    (await perTx.evaluate({
      kind: "transfer.native",
      summary: "x",
      to: FRIEND,
      value: 500n,
      spendAsset: "native",
      spendAmount: 500n,
      meta: { recipient: FRIEND },
    })).rule,
  );

  const daily = new PolicyEngine(operatorPolicy());
  const bigSpend = {
    kind: "transfer.native" as const,
    summary: "x",
    to: FRIEND,
    value: 900n,
    spendAsset: "native" as const,
    spendAmount: 900n,
    meta: { recipient: FRIEND },
  };
  await daily.recordSpend(bigSpend);
  emitted.add((await daily.evaluate(bigSpend)).rule);

  const threshold = new PolicyEngine(operatorPolicy({ approvalThreshold: 0.5 }));
  emitted.add((await threshold.evaluate(bigSpend)).rule);

  const allowed = new PolicyEngine(operatorPolicy());
  emitted.add(
    (await allowed.evaluate({
      kind: "transfer.native",
      summary: "x",
      to: FRIEND,
      value: 1n,
      spendAsset: "native",
      spendAmount: 1n,
      meta: { recipient: FRIEND },
    })).rule,
  );

  const documented = new Set(POLICY_RULES.map((rule) => rule.id));
  for (const rule of emitted) {
    assert.ok(documented.has(rule as never), `rule "${rule}" is emitted but not documented in POLICY_RULES`);
  }
  // Sanity: we exercised a meaningful spread, not one branch.
  assert.ok(emitted.size >= 8, `expected to exercise at least 8 distinct rules, saw ${emitted.size}`);
});
