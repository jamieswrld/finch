import assert from "node:assert/strict";
import { test } from "node:test";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { createNoopSigner, type Address } from "@solana/kit";
import { serializeInstruction, WSOL_MINT, type SerializedInstruction } from "../src/codec.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  JUPITER_PROGRAM,
  MemorySpendTracker,
  POLICY_RULES,
  PolicyEngine,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  narrowPolicy,
  type WalletPolicy,
} from "../src/policy.ts";
import type { ExecutionIntent } from "../src/types.ts";
import { addresses, ata, solTransfer, tokenApprove, tokenTransfer, uncheckedTokenTransfer, USDC, JUP } from "./solana-fixture.ts";

const [OPERATOR, FRIEND, STRANGER, RWA_MINT, SOME_PROGRAM] = await addresses(5);

function operatorPolicy(overrides: Partial<WalletPolicy> = {}): WalletPolicy {
  return {
    mode: "operator",
    allowances: [
      { asset: "native", perDay: 1_000n },
      { asset: USDC, perDay: 1_000n },
      { asset: RWA_MINT!, perDay: 1_000n },
    ],
    allowedPrograms: [],
    ...overrides,
  };
}

function nativeIntent(to: string, lamports: bigint, meta: Record<string, string> = { recipient: to }): ExecutionIntent {
  return {
    kind: "transfer.native",
    summary: `send ${lamports}`,
    to,
    instructions: [solTransfer(OPERATOR!, to, lamports)],
    spendAsset: "native",
    spendAmount: lamports,
    meta,
  };
}

async function approveIntent(delegate: string, mint = USDC): Promise<ExecutionIntent> {
  return {
    kind: "spl.approve",
    summary: "approve",
    to: mint,
    instructions: [await tokenApprove(OPERATOR!, delegate, mint, 10n)],
    spendAsset: mint,
    spendAmount: 10n,
    meta: { delegate, mint },
  };
}

async function rwaIntent(counterparty: string, mint = RWA_MINT!): Promise<ExecutionIntent> {
  return {
    kind: "rwa.interact",
    summary: "rwa transfer",
    to: mint,
    instructions: [await tokenTransfer(OPERATOR!, counterparty, mint, 5n)],
    spendAsset: mint,
    spendAmount: 5n,
    meta: { recipient: counterparty, counterparty },
  };
}

function invokeIntent(instructions: SerializedInstruction[]): ExecutionIntent {
  return { kind: "program.invoke", summary: "invoke", to: instructions[0]!.programAddress, instructions, spendAsset: "native", spendAmount: 0n };
}

test("observer mode denies every write", async () => {
  const engine = new PolicyEngine({ mode: "observer", allowances: [], allowedPrograms: [] });
  const decision = await engine.evaluate(nativeIntent(FRIEND!, 1n));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "wallet.mode");
});

test("spl.approve is bound by the recipient allowlist via its DELEGATE", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND!] }));
  assert.equal((await engine.evaluate(await approveIntent(FRIEND!))).verdict, "allow");
  const denied = await engine.evaluate(await approveIntent(STRANGER!));
  assert.equal(denied.verdict, "deny");
  assert.equal(denied.rule, "recipients.allowlist");
});

test("rwa.interact checks its counterparty against the allowlist", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND!] }), new MemorySpendTracker(), {
    rwaApprovedAssets: [RWA_MINT!],
  });
  assert.equal((await engine.evaluate(await rwaIntent(FRIEND!))).verdict, "allow");
  const denied = await engine.evaluate(await rwaIntent(STRANGER!));
  assert.equal(denied.rule, "recipients.allowlist");
});

test("rwa.interact stays gated on the approved registry", async () => {
  const engine = new PolicyEngine(operatorPolicy(), new MemorySpendTracker(), { rwaApprovedAssets: [] });
  const decision = await engine.evaluate(await rwaIntent(FRIEND!));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "rwa.approved");
});

test("daily allowance exhausts across separate spends", async () => {
  const engine = new PolicyEngine(operatorPolicy());
  const spend = nativeIntent(FRIEND!, 600n);
  assert.equal((await engine.evaluate(spend)).verdict, "allow");
  await engine.recordSpend(spend);
  const second = await engine.evaluate(spend);
  assert.equal(second.verdict, "deny");
  assert.equal(second.rule, "allowance.daily");
});

test("per-transaction cap is enforced independently of the daily cap", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowances: [{ asset: "native", perDay: 1_000n, perTx: 10n }] }));
  const decision = await engine.evaluate(nativeIntent(FRIEND!, 11n));
  assert.equal(decision.rule, "allowance.perTx");
});

test("spends above the approval threshold need a human", async () => {
  const engine = new PolicyEngine(operatorPolicy({ approvalThreshold: 0.5 }));
  assert.equal((await engine.evaluate(nativeIntent(FRIEND!, 400n))).verdict, "allow");
  const big = await engine.evaluate(nativeIntent(FRIEND!, 600n));
  assert.equal(big.verdict, "needs_approval");
  assert.equal(big.rule, "allowance.approvalThreshold");
});

test("POLICY_RULES documents every rule the engine can actually emit", async () => {
  const emitted = new Set<string>();

  emitted.add((await new PolicyEngine({ mode: "observer", allowances: [], allowedPrograms: [] }).evaluate(nativeIntent(FRIEND!, 1n))).rule);
  emitted.add(
    (await new PolicyEngine(operatorPolicy()).evaluate({
      ...nativeIntent(FRIEND!, 1n),
      instructions: [await uncheckedTokenTransfer(OPERATOR!, FRIEND!, USDC, 1n)],
    })).rule,
  );
  emitted.add((await new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND!] })).evaluate(nativeIntent(STRANGER!, 1n))).rule);
  emitted.add(
    (await new PolicyEngine(operatorPolicy()).evaluate(
      invokeIntent([{ programAddress: SOME_PROGRAM!, accounts: [], data: "" }]),
    )).rule,
  );
  emitted.add(
    (await new PolicyEngine(operatorPolicy(), new MemorySpendTracker(), { rwaApprovedAssets: [] }).evaluate(await rwaIntent(FRIEND!))).rule,
  );
  emitted.add((await new PolicyEngine({ mode: "operator", allowances: [], allowedPrograms: [] }).evaluate(nativeIntent(FRIEND!, 5n))).rule);
  emitted.add(
    (await new PolicyEngine(operatorPolicy({ allowances: [{ asset: "native", perDay: 1_000n, perTx: 10n }] })).evaluate(nativeIntent(FRIEND!, 500n))).rule,
  );
  const daily = new PolicyEngine(operatorPolicy());
  await daily.recordSpend(nativeIntent(FRIEND!, 900n));
  emitted.add((await daily.evaluate(nativeIntent(FRIEND!, 900n))).rule);
  emitted.add((await new PolicyEngine(operatorPolicy({ approvalThreshold: 0.5 })).evaluate(nativeIntent(FRIEND!, 900n))).rule);
  emitted.add((await new PolicyEngine(operatorPolicy()).evaluate(nativeIntent(FRIEND!, 1n))).rule);

  const documented = new Set(POLICY_RULES.map((rule) => rule.id));
  for (const rule of emitted) {
    assert.ok(documented.has(rule as never), `rule "${rule}" is emitted but not documented in POLICY_RULES`);
  }
  // Sanity: we exercised a meaningful spread, not one branch.
  assert.ok(emitted.size >= 10, `expected to exercise at least 10 distinct rules, saw ${emitted.size}`);
});

test("REGRESSION: a manifest cannot widen the authority the host granted", () => {
  const host: WalletPolicy = {
    mode: "observer",
    allowances: [{ asset: "native", perDay: 100n, perTx: 10n }],
    allowedPrograms: [JUPITER_PROGRAM],
    allowedRecipients: [FRIEND!],
    approvalThreshold: 0.2,
    rwaApprovedOnly: true,
  };
  const requested: WalletPolicy = {
    mode: "operator",
    allowances: [
      { asset: "native", perDay: 1_000_000n, perTx: 1_000_000n },
      { asset: USDC, perDay: 1_000_000n },
    ],
    allowedPrograms: [JUPITER_PROGRAM, SOME_PROGRAM!],
    allowedRecipients: undefined,
    approvalThreshold: 0.9,
    rwaApprovedOnly: false,
  };
  const narrowed = narrowPolicy(host, requested);
  assert.equal(narrowed.mode, "observer");
  assert.deepEqual(narrowed.allowances, [{ asset: "native", perDay: 100n, perTx: 10n }]);
  assert.deepEqual(narrowed.allowedPrograms, [JUPITER_PROGRAM]);
  assert.deepEqual(narrowed.allowedRecipients, [FRIEND]);
  assert.equal(narrowed.approvalThreshold, 0.2);
  assert.equal(narrowed.rwaApprovedOnly, true);
});

test("narrowing works in the direction it is supposed to: a manifest may restrict itself", () => {
  const host: WalletPolicy = { mode: "operator", allowances: [{ asset: "native", perDay: 100n }], allowedPrograms: [JUPITER_PROGRAM] };
  const narrowed = narrowPolicy(host, {
    mode: "observer",
    allowances: [{ asset: "native", perDay: 5n }],
    allowedPrograms: [],
    allowedRecipients: [FRIEND!],
  });
  assert.equal(narrowed.mode, "observer");
  assert.deepEqual(narrowed.allowances, [{ asset: "native", perDay: 5n, perTx: 5n }]);
  assert.deepEqual(narrowed.allowedPrograms, []);
  assert.deepEqual(narrowed.allowedRecipients, [FRIEND]);
});

test("addresses compare exactly: base58 is case-sensitive", () => {
  const upper = FRIEND!.toUpperCase();
  const narrowed = narrowPolicy(
    { mode: "operator", allowances: [], allowedPrograms: [], allowedRecipients: [FRIEND!] },
    { mode: "operator", allowances: [], allowedPrograms: [], allowedRecipients: [upper] },
  );
  assert.deepEqual(narrowed.allowedRecipients, [], "a case-folded address is a different account, not a match");
});

test("REGRESSION: meta cannot name a friendly recipient while the instructions pay a stranger", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedRecipients: [FRIEND!] }));
  const sol = await engine.evaluate(nativeIntent(STRANGER!, 1n, { recipient: FRIEND! }));
  assert.equal(sol.rule, "recipients.allowlist", "a SOL transfer's destination is its instruction, not its meta");

  // A token transfer claims FRIEND in meta but pays STRANGER's token account.
  const token = await engine.evaluate({
    kind: "transfer.spl",
    summary: "send",
    to: USDC,
    instructions: [await tokenTransfer(OPERATOR!, STRANGER!, USDC, 1n)],
    spendAsset: USDC,
    spendAmount: 1n,
    meta: { recipient: FRIEND! },
  });
  assert.equal(token.verdict, "deny");
  assert.equal(token.rule, "recipients.allowlist");
  assert.match(token.reason, new RegExp(await ata(STRANGER!, USDC)), "the raw token account is the counterparty, not the claimed owner");
});

test("REGRESSION: SOL and tokens moved by one intent are each capped", async () => {
  const engine = new PolicyEngine(
    operatorPolicy({ allowances: [{ asset: "native", perDay: 1_000n }, { asset: USDC, perDay: 10n }], allowedPrograms: [SYSTEM_PROGRAM, TOKEN_PROGRAM] }),
  );
  const both = invokeIntent([solTransfer(OPERATOR!, FRIEND!, 5n), await tokenTransfer(OPERATOR!, FRIEND!, USDC, 50n)]);
  const decision = await engine.evaluate(both);
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "allowance.perTx", "the token leg must be checked even though a SOL leg is present");
});

test("an unchecked token transfer names no mint and is refused", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [TOKEN_PROGRAM] }));
  const decision = await engine.evaluate(invokeIntent([await uncheckedTokenTransfer(OPERATOR!, FRIEND!, USDC, 1n)]));
  assert.equal(decision.rule, "instructions.recognized");
});

test("value-moving token instructions the policy cannot price are refused", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [TOKEN_PROGRAM] }));
  const source = await ata(OPERATOR!, USDC);
  // CloseAccount (9) sends the account's lamports to a destination; SetAuthority (6) hands the account away.
  for (const data of ["CQ==", "BgIB"]) {
    const decision = await engine.evaluate(
      invokeIntent([{ programAddress: TOKEN_PROGRAM, accounts: [{ address: source, role: "writable" }, { address: STRANGER!, role: "writable" }, { address: OPERATOR!, role: "readonly_signer" }], data }]),
    );
    assert.equal(decision.rule, "instructions.recognized", `token instruction ${data} must not ride along unpriced`);
  }
});

test("a transfer intent cannot smuggle an instruction to another program", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [SOME_PROGRAM!] }));
  const decision = await engine.evaluate({
    ...nativeIntent(FRIEND!, 1n),
    instructions: [solTransfer(OPERATOR!, FRIEND!, 1n), { programAddress: SOME_PROGRAM!, accounts: [], data: "" }],
  });
  assert.equal(decision.rule, "instructions.recognized", "only program_invoke and swaps may call other programs, even allowlisted ones");
});

test("program_invoke needs the program on the allowlist; memo and compute budget do not", async () => {
  const opaque = { programAddress: SOME_PROGRAM!, accounts: [], data: "" };
  const memo = serializeInstruction(getAddMemoInstruction({ memo: "hello", signers: [createNoopSigner(OPERATOR as Address)] }));
  const budget = serializeInstruction(getSetComputeUnitLimitInstruction({ units: 10_000 }));

  const unlisted = await new PolicyEngine(operatorPolicy()).evaluate(invokeIntent([opaque]));
  assert.equal(unlisted.rule, "programs.allowlist");

  const listed = await new PolicyEngine(operatorPolicy({ allowedPrograms: [SOME_PROGRAM!] })).evaluate(invokeIntent([budget, opaque, memo]));
  assert.equal(listed.verdict, "allow");
});

test("an intent may not buy its own priority fee: that is spend outside every allowance", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [SOME_PROGRAM!] }));
  const price = serializeInstruction(getSetComputeUnitPriceInstruction({ microLamports: 5_000_000_000n }));
  const decision = await engine.evaluate(invokeIntent([price, { programAddress: SOME_PROGRAM!, accounts: [], data: "" }]));
  assert.equal(decision.rule, "instructions.recognized");
});

test("wrapped SOL is SOL: a wSOL transfer draws on the native allowance", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowances: [{ asset: "native", perDay: 100n }] }));
  const decision = await engine.evaluate({
    kind: "transfer.spl",
    summary: "send wsol",
    to: WSOL_MINT,
    instructions: [await tokenTransfer(OPERATOR!, FRIEND!, WSOL_MINT, 500n, { decimals: 9 })],
    spendAsset: "native",
    spendAmount: 500n,
    meta: { recipient: FRIEND! },
  });
  assert.equal(decision.rule, "allowance.perTx", "500 lamports of wSOL exceeds a 100-lamport SOL cap");
});

// ── Swaps ────────────────────────────────────────────────────────────────────

async function swapIntent(extra: SerializedInstruction[] = []): Promise<ExecutionIntent> {
  const wrapped = await ata(OPERATOR!, WSOL_MINT);
  const createOut = {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: OPERATOR!, role: "writable_signer" as const },
      { address: await ata(OPERATOR!, JUP), role: "writable" as const },
      { address: OPERATOR!, role: "readonly" as const },
      { address: JUP, role: "readonly" as const },
      { address: SYSTEM_PROGRAM, role: "readonly" as const },
      { address: TOKEN_PROGRAM, role: "readonly" as const },
    ],
    data: "AQ==",
  };
  const route = { programAddress: JUPITER_PROGRAM, accounts: [{ address: OPERATOR!, role: "writable_signer" as const }], data: "AA==" };
  const close = {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      { address: wrapped, role: "writable" as const },
      { address: OPERATOR!, role: "writable" as const },
      { address: OPERATOR!, role: "readonly_signer" as const },
    ],
    data: "CQ==",
  };
  return {
    kind: "swap.exactIn",
    summary: "swap",
    to: JUPITER_PROGRAM,
    instructions: [createOut, solTransfer(OPERATOR!, wrapped, 100n), { programAddress: TOKEN_PROGRAM, accounts: [{ address: wrapped, role: "writable" }], data: "EQ==" }, route, close, ...extra],
    spendAsset: "native",
    spendAmount: 100n,
    meta: { recipient: OPERATOR! },
  };
}

test("a clean swap through an allowlisted router is allowed, and priced at its quoted input", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [JUPITER_PROGRAM] }));
  assert.equal((await engine.evaluate(await swapIntent())).verdict, "allow");
});

test("a swap needs its router on the allowlist", async () => {
  const decision = await new PolicyEngine(operatorPolicy()).evaluate(await swapIntent());
  assert.equal(decision.rule, "programs.allowlist");
});

test("REGRESSION: a swap route cannot slip a SOL transfer to a third party into its plumbing", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [JUPITER_PROGRAM] }));
  const decision = await engine.evaluate(await swapIntent([solTransfer(OPERATOR!, STRANGER!, 1n)]));
  assert.equal(decision.verdict, "deny");
  assert.equal(decision.rule, "instructions.recognized");
});

test("a swap route cannot create a token account for someone else", async () => {
  const engine = new PolicyEngine(operatorPolicy({ allowedPrograms: [JUPITER_PROGRAM] }));
  const intent = await swapIntent();
  intent.instructions[0] = {
    ...intent.instructions[0]!,
    accounts: intent.instructions[0]!.accounts.map((meta, index) => (index === 2 ? { ...meta, address: STRANGER! } : meta)),
  };
  const decision = await engine.evaluate(intent);
  assert.equal(decision.rule, "instructions.recognized");
});
