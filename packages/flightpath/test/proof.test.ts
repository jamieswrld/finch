import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProofUnavailableError,
  buildProofOfFlight,
  verifyProofOfFlight,
} from "../src/proof.ts";
import type { ExecutionRecord } from "../src/types.ts";

const confirmed = (): ExecutionRecord => ({
  id: "exec-1",
  agentId: "network-scout",
  chainId: 4663,
  createdAt: "2026-09-03T00:00:00.000Z",
  state: "confirmed",
  intent: {
    kind: "transfer.native",
    summary: "transfer 0.01 ETH → 0xabc",
    to: "0x3333333333333333333333333333333333333333",
    value: "10000000000000000",
    spendAsset: "native",
    spendAmount: "10000000000000000",
  },
  policy: { verdict: "allow", rule: "default", reason: "within policy" },
  simulation: { ok: true, gasEstimate: "21000", simulatedAt: "2026-09-03T00:00:01.000Z" },
  tx: { hash: `0x${"a".repeat(64)}`, submittedAt: "2026-09-03T00:00:02.000Z" },
  receipt: {
    status: "success",
    blockNumber: "53000000",
    gasUsed: "21000",
    confirmedAt: "2026-09-03T00:00:03.000Z",
  },
  log: [],
});

test("a confirmed execution yields a verifiable proof", async () => {
  const proof = await buildProofOfFlight(confirmed(), { nestId: "chain-intelligence", taskId: "t1" });
  assert.equal(proof.version, "proof-of-flight/0.1");
  assert.equal(proof.finchId, "network-scout");
  assert.equal(proof.nestId, "chain-intelligence");
  assert.equal(proof.chainId, 4663);
  assert.equal(proof.blockNumber, "53000000");
  assert.match(proof.executionHash, /^[0-9a-f]{64}$/);

  const { valid } = await verifyProofOfFlight(proof);
  assert.equal(valid, true);
});

test("the hash is deterministic across independent builds", async () => {
  const a = await buildProofOfFlight(confirmed(), { nestId: "n", taskId: "t1" });
  const b = await buildProofOfFlight(confirmed(), { nestId: "n", taskId: "t1" });
  assert.equal(a.executionHash, b.executionHash);
});

test("editing ANY fact invalidates the proof", async () => {
  const proof = await buildProofOfFlight(confirmed());
  for (const tamper of [
    { blockNumber: "999" },
    { summary: "transfer 100 ETH → 0xattacker" },
    { finchId: "someone-else" },
    { policy: { verdict: "allow", rule: "human.approval" } },
  ] as const) {
    const edited = { ...proof, ...tamper };
    const { valid } = await verifyProofOfFlight(edited as typeof proof);
    assert.equal(valid, false, `tampering with ${Object.keys(tamper)[0]} must invalidate the proof`);
  }
});

test("no proof exists for an action that did not confirm", async () => {
  for (const [state, patch] of [
    ["denied", { state: "denied" }],
    ["awaiting_approval", { state: "awaiting_approval" }],
    ["submitted", { state: "submitted" }],
  ] as const) {
    await assert.rejects(
      () => buildProofOfFlight({ ...confirmed(), ...patch } as ExecutionRecord),
      ProofUnavailableError,
      `${state} must not yield a proof`,
    );
  }
});

test("a reverted transaction yields no proof even when the record says confirmed", async () => {
  const record = confirmed();
  record.receipt!.status = "reverted";
  await assert.rejects(() => buildProofOfFlight(record), ProofUnavailableError);
});

test("an unsimulated execution yields no proof", async () => {
  const record = confirmed();
  record.simulation = { ok: false, error: "reverted", simulatedAt: "2026-09-03T00:00:01.000Z" };
  await assert.rejects(() => buildProofOfFlight(record), ProofUnavailableError);
});

test("a human approval is carried into the proof and covered by the hash", async () => {
  const record = confirmed();
  record.approval = { approvedBy: "operator@finch", at: "2026-09-03T00:00:01.500Z" };
  const proof = await buildProofOfFlight(record);
  assert.equal(proof.approval?.approvedBy, "operator@finch");
  const { valid } = await verifyProofOfFlight({ ...proof, approval: { approvedBy: "nobody", at: proof.approval!.at } });
  assert.equal(valid, false);
});
