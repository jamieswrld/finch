import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProofUnavailableError,
  buildProofOfFlight,
  verifyProofOfFlight,
} from "../src/proof.ts";
import type { ExecutionRecord } from "../src/types.ts";

const SIGNATURE = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const RECIPIENT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const confirmed = (): ExecutionRecord => ({
  id: "exec-1",
  agentId: "courier",
  chain: "solana:mainnet",
  createdAt: "2026-09-26T00:00:00.000Z",
  state: "confirmed",
  intent: {
    kind: "transfer.native",
    summary: `transfer 0.01 SOL → ${RECIPIENT}`,
    to: RECIPIENT,
    instructions: [],
    spendAsset: "native",
    spendAmount: "10000000",
  },
  policy: { verdict: "allow", rule: "default", reason: "within policy" },
  simulation: { ok: true, computeUnits: "150", simulatedAt: "2026-09-26T00:00:01.000Z" },
  tx: { signature: SIGNATURE, submittedAt: "2026-09-26T00:00:02.000Z" },
  receipt: {
    status: "success",
    slot: "450000000",
    feeLamports: "5000",
    computeUnits: "150",
    confirmedAt: "2026-09-26T00:00:03.000Z",
  },
  log: [],
});

test("a confirmed execution yields a verifiable proof", async () => {
  const proof = await buildProofOfFlight(confirmed(), { nestId: "chain-intelligence", taskId: "t1" });
  assert.equal(proof.version, "proof-of-flight/0.2");
  assert.equal(proof.finchId, "courier");
  assert.equal(proof.nestId, "chain-intelligence");
  assert.equal(proof.chain, "solana:mainnet");
  assert.equal(proof.signature, SIGNATURE);
  assert.equal(proof.slot, "450000000");
  assert.equal(proof.feeLamports, "5000");
  assert.match(proof.executionHash, /^[0-9a-f]{64}$/);
  assert.match(proof.explorerUrl ?? "", new RegExp(`/tx/${SIGNATURE}`));

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
    { slot: "999" },
    { summary: "transfer 100 SOL → attacker" },
    { finchId: "someone-else" },
    { feeLamports: "0" },
    { chain: "solana:devnet" },
    { policy: { verdict: "allow", rule: "human.approval" } },
  ] as const) {
    const edited = { ...proof, ...tamper };
    const { valid } = await verifyProofOfFlight(edited as typeof proof);
    assert.equal(valid, false, `tampering with ${Object.keys(tamper)[0]} must invalidate the proof`);
  }
});

test("REGRESSION: a signature differing only in case is a different transaction", async () => {
  // Base58 is case-sensitive. Lowercasing before hashing (as hex hashes could
  // be) would make two distinct signatures verify as the same proof.
  const proof = await buildProofOfFlight(confirmed());
  const { valid } = await verifyProofOfFlight({ ...proof, signature: SIGNATURE.toLowerCase() });
  assert.equal(valid, false);
});

test("no proof exists for an action that did not confirm", async () => {
  for (const [state, patch] of [
    ["denied", { state: "denied" }],
    ["awaiting_approval", { state: "awaiting_approval" }],
    ["awaiting_signature", { state: "awaiting_signature" }],
    ["submitted", { state: "submitted" }],
  ] as const) {
    await assert.rejects(
      () => buildProofOfFlight({ ...confirmed(), ...patch } as ExecutionRecord),
      ProofUnavailableError,
      `${state} must not yield a proof`,
    );
  }
});

test("a failed transaction yields no proof even when the record says confirmed", async () => {
  const record = confirmed();
  record.receipt!.status = "failed";
  await assert.rejects(() => buildProofOfFlight(record), ProofUnavailableError);
});

test("an unsimulated execution yields no proof", async () => {
  const record = confirmed();
  record.simulation = { ok: false, error: "simulation failed", simulatedAt: "2026-09-26T00:00:01.000Z" };
  await assert.rejects(() => buildProofOfFlight(record), ProofUnavailableError);
});

test("a human approval is carried into the proof and covered by the hash", async () => {
  const record = confirmed();
  record.approval = { approvedBy: "operator@finch", at: "2026-09-26T00:00:01.500Z" };
  const proof = await buildProofOfFlight(record);
  assert.equal(proof.approval?.approvedBy, "operator@finch");
  const { valid } = await verifyProofOfFlight({ ...proof, approval: { approvedBy: "nobody", at: proof.approval!.at } });
  assert.equal(valid, false);
});
