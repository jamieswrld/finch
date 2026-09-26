import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Instruction,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { serializeInstruction } from "../src/codec.ts";
import { COMPUTE_BUDGET_PROGRAM } from "../src/policy.ts";
import { LIGHTHOUSE_PROGRAM, buildUnsignedTransaction, computeUnitLimitFor, matchSignedTransaction } from "../src/transaction.ts";
import { addresses, fakeRpc, solTransfer } from "./solana-fixture.ts";

const [PAYER, FRIEND, STRANGER] = await addresses(3);

const prepared = () => ({ feePayer: PAYER!, instructions: [solTransfer(PAYER!, FRIEND!, 1_000n)] });
const budget = serializeInstruction(getSetComputeUnitLimitInstruction({ units: 5_000 }));

test("the landed transaction must be the prepared one, instruction for instruction", () => {
  const ok = matchSignedTransaction(prepared(), { feePayer: PAYER!, signers: [PAYER!], instructions: [budget, ...prepared().instructions] });
  assert.deepEqual(ok, { ok: true, mismatches: [] }, "a wallet-added compute budget is tolerated");

  const lighthouse = { programAddress: LIGHTHOUSE_PROGRAM, accounts: [], data: "AA==" };
  assert.equal(matchSignedTransaction(prepared(), { feePayer: PAYER!, signers: [PAYER!], instructions: [...prepared().instructions, lighthouse] }).ok, true);
});

test("REGRESSION: a different recipient, amount, payer or extra instruction is refused", () => {
  const base = { feePayer: PAYER!, signers: [PAYER!] };
  const cases: Array<[string, Parameters<typeof matchSignedTransaction>[1]]> = [
    ["recipient", { ...base, instructions: [solTransfer(PAYER!, STRANGER!, 1_000n)] }],
    ["amount", { ...base, instructions: [solTransfer(PAYER!, FRIEND!, 1_001n)] }],
    ["fee payer", { feePayer: STRANGER!, signers: [STRANGER!], instructions: prepared().instructions }],
    ["extra transfer", { ...base, instructions: [...prepared().instructions, solTransfer(PAYER!, STRANGER!, 1n)] }],
    ["missing instruction", { ...base, instructions: [] }],
    ["second signer", { ...base, signers: [PAYER!, STRANGER!], instructions: prepared().instructions }],
  ];
  for (const [label, landed] of cases) {
    assert.equal(matchSignedTransaction(prepared(), landed).ok, false, `${label} must not match`);
  }
});

test("the unsigned transaction carries exactly the prepared instructions, for the prepared payer", async () => {
  const { rpc } = fakeRpc();
  const built = await buildUnsignedTransaction({ ...prepared(), computeUnits: "600" }, rpc as never);
  assert.equal(built.lastValidBlockHeight, "1000");

  const wire = new Uint8Array(getBase64Encoder().encode(built.transaction));
  const decoded = getTransactionDecoder().decode(wire);
  assert.ok(Object.values(decoded.signatures).every((signature) => signature === null), "nothing is signed server-side");
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as never);
  assert.equal(message.feePayer.address, PAYER);
  const instructions = (message.instructions as readonly Instruction[]).map(serializeInstruction);
  assert.equal(instructions[0]!.programAddress, COMPUTE_BUDGET_PROGRAM, "sized from the simulation");
  assert.equal(
    matchSignedTransaction(prepared(), { feePayer: PAYER!, signers: [PAYER!], instructions }).ok,
    true,
    "what the wallet is handed matches what will be verified",
  );
});

test("compute limits carry headroom over the simulated figure, within protocol bounds", () => {
  assert.equal(computeUnitLimitFor(null), null);
  assert.ok(computeUnitLimitFor(1_000n)! > 1_000);
  assert.equal(computeUnitLimitFor(10_000_000n), 1_400_000);
});
