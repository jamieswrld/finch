import { findAssociatedTokenPda } from "@solana-program/token";
import { base64ToBytes, readU32, readU64, WSOL_MINT, type SerializedInstruction } from "./codec.ts";
import type { ExecutionIntent, PolicyDecision, SpendAsset } from "./types.ts";

/**
 * Wallet policy — the boundary between an agent and funds.
 *
 * An agent NEVER holds unrestricted custody. It operates a restricted wallet
 * whose authority is defined here:
 *
 *   Finch treasury wallet  →  restricted operator keypair (bounded float)  →  budgets/allowances
 *
 * or, for user-signed execution, the visitor's own wallet — in which case the
 * visitor's signature is the final gate and this policy is the first one.
 */

export type WalletMode = "none" | "observer" | "operator";

export interface Allowance {
  /** "native" (SOL, and wrapped SOL) or an SPL mint address. */
  asset: SpendAsset;
  /** Max spend per rolling 24h window, in the asset's smallest unit (lamports for SOL). */
  perDay: bigint;
  /** Max spend in a single transaction. Defaults to perDay. */
  perTx?: bigint;
}

export interface WalletPolicy {
  mode: WalletMode;
  allowances: Allowance[];
  /** Programs the agent may invoke with arbitrary instructions (program_invoke, swap routers). */
  allowedPrograms: string[];
  /** If set, value may only move to these counterparties. */
  allowedRecipients?: string[];
  /** Spends above this fraction of the daily allowance require human approval (0–1). */
  approvalThreshold?: number;
  /** RWA writes must target the approved registry. Defaults to true and cannot be waived silently. */
  rwaApprovedOnly?: boolean;
}

export const OBSERVER_POLICY: WalletPolicy = {
  mode: "observer",
  allowances: [],
  allowedPrograms: [],
};

// ── Programs Flightpath understands ─────────────────────────────────────────

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** SPL Memo v2 — the memo program RPC nodes index and parse. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Every deployed memo program: v1, v2, and the newer one the memo client defaults to. */
export const MEMO_PROGRAMS = [MEMO_PROGRAM, "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo", "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"];
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

/** Programs that cannot move value or run arbitrary code: they set fees or write a log line. */
const INERT_PROGRAMS = new Set([COMPUTE_BUDGET_PROGRAM, ...MEMO_PROGRAMS]);

/**
 * The chain's own plumbing a swap route needs around the router call:
 * wrapping SOL, creating the signer's token accounts, closing the wrapper.
 * These are not allowlisted programs — each instruction is checked by
 * swapPlumbingViolation to touch only the signer's own accounts.
 */
const SWAP_PLUMBING = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, ...INERT_PROGRAMS]);

/** Authority ordering: a manifest may move down this list, never up. */
const MODE_RANK: Record<WalletMode, number> = { none: 0, observer: 1, operator: 2 };

/**
 * Intersect a requested policy with the policy the host actually granted.
 *
 * A manifest is untrusted input — it is imported, forked and published by
 * anyone through the Aviary. Binding a host's signer to the manifest's own
 * policy would let a downloaded JSON file set its own spend caps and drop the
 * host's recipient allowlist, which is the whole permission model inverted.
 *
 * Every field narrows and none widens:
 *  · mode takes the lower authority of the two
 *  · perDay / perTx take the smaller cap; an asset the host never allowed
 *    cannot be introduced by the manifest
 *  · allowlists intersect, and a host list stays in force when the manifest
 *    omits one (an absent list means "no further restriction", never "no
 *    restriction at all")
 *  · approvalThreshold takes the stricter (lower) value
 *  · rwaApprovedOnly is sticky: once the host requires it, a manifest cannot
 *    waive it
 *
 * Addresses compare exactly: base58 is case-sensitive.
 */
export function narrowPolicy(host: WalletPolicy, requested: WalletPolicy): WalletPolicy {
  const lower = (a: string[], b: string[]) => {
    const set = new Set(b);
    return a.filter((entry) => set.has(entry));
  };

  const allowances: Allowance[] = [];
  for (const grant of host.allowances) {
    const asked = requested.allowances.find((entry) => entry.asset === grant.asset);
    if (!asked) continue; // the manifest did not ask for this asset
    const perDay = asked.perDay < grant.perDay ? asked.perDay : grant.perDay;
    const hostTx = grant.perTx ?? grant.perDay;
    const askedTx = asked.perTx ?? asked.perDay;
    const perTx = askedTx < hostTx ? askedTx : hostTx;
    allowances.push({ asset: grant.asset, perDay, perTx });
  }

  const recipients =
    host.allowedRecipients === undefined
      ? requested.allowedRecipients
      : requested.allowedRecipients === undefined
        ? host.allowedRecipients
        : lower(host.allowedRecipients, requested.allowedRecipients);

  const thresholds = [host.approvalThreshold, requested.approvalThreshold].filter(
    (value): value is number => typeof value === "number",
  );

  return {
    mode: MODE_RANK[requested.mode] < MODE_RANK[host.mode] ? requested.mode : host.mode,
    allowances,
    allowedPrograms: lower(host.allowedPrograms, requested.allowedPrograms),
    allowedRecipients: recipients,
    approvalThreshold: thresholds.length > 0 ? Math.min(...thresholds) : undefined,
    rwaApprovedOnly: host.rwaApprovedOnly === false ? requested.rwaApprovedOnly : true,
  };
}

/** Tracks realized spend so daily allowances mean something across restarts. */
export interface SpendTracker {
  spentInWindow(asset: SpendAsset, windowMs: number): Promise<bigint>;
  recordSpend(asset: SpendAsset, amount: bigint, at?: Date): Promise<void>;
  /**
   * Atomically debit `amount` only if it still fits under `cap` for the
   * window. Returns false when it does not.
   *
   * evaluate() reads the spend and later code writes it, and between those two
   * points any number of concurrent executions can read the same figure and
   * all conclude they fit — check-then-act, so N executions each just under
   * the cap spend N times the cap. This collapses the read and the write into
   * one step, and executeIntent calls it immediately before broadcasting.
   */
  reserveSpend?(asset: SpendAsset, amount: bigint, windowMs: number, cap: bigint): Promise<boolean>;
}

export class MemorySpendTracker implements SpendTracker {
  private entries: Array<{ asset: string; amount: bigint; at: number }> = [];

  async spentInWindow(asset: SpendAsset, windowMs: number): Promise<bigint> {
    const cutoff = Date.now() - windowMs;
    return this.entries
      .filter((entry) => entry.asset === asset && entry.at >= cutoff)
      .reduce((sum, entry) => sum + entry.amount, 0n);
  }

  async recordSpend(asset: SpendAsset, amount: bigint, at?: Date): Promise<void> {
    this.entries.push({ asset, amount, at: (at ?? new Date()).getTime() });
  }

  /**
   * Atomic by construction: no await separates the read from the write, so
   * JS runs it to completion without yielding to a racing caller.
   */
  async reserveSpend(asset: SpendAsset, amount: bigint, windowMs: number, cap: bigint): Promise<boolean> {
    const cutoff = Date.now() - windowMs;
    const spent = this.entries
      .filter((entry) => entry.asset === asset && entry.at >= cutoff)
      .reduce((sum, entry) => sum + entry.amount, 0n);
    if (spent + amount > cap) return false;
    this.entries.push({ asset, amount, at: Date.now() });
    return true;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every rule evaluate() can return, in the order it checks them. Exported so
 * the docs render the real rule set rather than a hand-written copy that
 * drifts. A test asserts that every rule id evaluate() emits appears here.
 */
export const POLICY_RULES = [
  {
    id: "wallet.mode",
    verdict: "deny",
    when: "The wallet is not in operator mode.",
    why: "Observer and none-mode finches have no write authority at all. This is the default, so a finch is read-only until you deliberately grant otherwise.",
  },
  {
    id: "instructions.recognized",
    verdict: "deny",
    when: "An instruction cannot be priced: an unchecked token transfer or approval (it names no mint), any other System or Token instruction that can move value (close account, set authority, burn…), or — outside program_invoke and swaps — an instruction to any other program.",
    why: "The policy reads the instructions the transaction will actually execute. Anything it cannot put a price on does not get to ride along.",
  },
  {
    id: "recipients.allowlist",
    verdict: "deny",
    when: "A counterparty is not on allowedRecipients (when that list is set).",
    why: "Counterparty means whoever ends up able to move value: a transfer's recipient, an approval's delegate, a swap's output owner — not just transfer destinations.",
  },
  {
    id: "programs.allowlist",
    verdict: "deny",
    when: "A program_invoke or swap calls a program outside allowedPrograms.",
    why: "Anything that hands instructions to a program must name that program up front. Allowlisting a program is the act of trusting its code.",
  },
  {
    id: "rwa.approved",
    verdict: "deny",
    when: "An RWA interaction targets a mint outside the approved registry.",
    why: "Permissioned real-world assets are gated to an explicit registry, and a manifest cannot waive the gate.",
  },
  {
    id: "allowance.missing",
    verdict: "deny",
    when: "The intent spends an asset with no configured allowance.",
    why: "Spending authority is opt-in per asset. No allowance means no spend.",
  },
  {
    id: "allowance.perTx",
    verdict: "deny",
    when: "A single spend exceeds the per-transaction cap.",
    why: "Caps the blast radius of any one mistake, independently of the daily budget.",
  },
  {
    id: "allowance.daily",
    verdict: "deny",
    when: "The rolling 24h spend would exceed perDay.",
    why: "Spend is debited at submission, so a transaction that broadcasts always counts even if its confirmation is lost.",
  },
  {
    id: "allowance.approvalThreshold",
    verdict: "needs_approval",
    when: "A spend exceeds approvalThreshold as a fraction of the daily allowance.",
    why: "Parks the intent at awaiting_approval. Only a recorded human approval releases it — replaying the execution id will not.",
  },
  {
    id: "human.approval",
    verdict: "allow",
    when: "A human approved a parked intent.",
    why: "Recorded on the execution as who approved and when, and covered by the Proof of Flight hash.",
  },
  {
    id: "default",
    verdict: "allow",
    when: "Every check above passed.",
    why: "The intent proceeds to mandatory simulation before anything is signed.",
  },
] as const;

export type PolicyRuleId = (typeof POLICY_RULES)[number]["id"];

// ── Instruction decoding ─────────────────────────────────────────────────────

/** SPL Token and Token-2022 share these instruction discriminators. */
const TOKEN_IX = { transfer: 3, approve: 4, transferChecked: 12, approveChecked: 13, syncNative: 17 } as const;
const SYSTEM_TRANSFER = 2;

export type SpendLeg = { asset: SpendAsset; amount: bigint };

/** A value movement read straight out of one instruction. */
export type DecodedMove =
  | { kind: "sol.transfer"; from: string; to: string; lamports: bigint }
  | { kind: "token.transfer"; program: string; source: string; mint: string; destination: string; authority: string; amount: bigint; decimals: number }
  | { kind: "token.approve"; program: string; source: string; mint: string; delegate: string; owner: string; amount: bigint; decimals: number };

export type DecodedInstruction =
  | { kind: "inert"; program: string }
  | { kind: "sync-native"; program: string }
  | { kind: "move"; move: DecodedMove }
  | { kind: "unpriced"; program: string; reason: string }
  | { kind: "opaque"; program: string };

function account(ix: SerializedInstruction, index: number): string | null {
  return ix.accounts[index]?.address ?? null;
}

/**
 * Read one instruction far enough to know what value it moves. Opaque means
 * "some other program" — its effect is whatever that program's code does,
 * which only an allowlist can vouch for.
 */
export function decodeInstruction(ix: SerializedInstruction): DecodedInstruction {
  const program = ix.programAddress;
  if (program === COMPUTE_BUDGET_PROGRAM && ix.data.length > 0) {
    // SetComputeUnitPrice (3) buys priority with the signer's SOL — a spend
    // no allowance covers. Flightpath sets priority itself when configured;
    // an intent may not.
    const discriminator = base64ToBytes(ix.data)[0];
    if (discriminator === 3) return { kind: "unpriced", program, reason: "an intent may not set its own priority fee" };
  }
  if (INERT_PROGRAMS.has(program)) return { kind: "inert", program };

  let data: Uint8Array;
  try {
    data = base64ToBytes(ix.data);
  } catch {
    return { kind: "unpriced", program, reason: "instruction data is not valid base64" };
  }

  if (program === SYSTEM_PROGRAM) {
    const discriminator = readU32(data, 0);
    const lamports = readU64(data, 4);
    const from = account(ix, 0);
    const to = account(ix, 1);
    if (discriminator === SYSTEM_TRANSFER && data.length === 12 && lamports !== null && from && to) {
      return { kind: "move", move: { kind: "sol.transfer", from, to, lamports } };
    }
    return { kind: "unpriced", program, reason: `System instruction ${discriminator ?? "?"} is not a plain SOL transfer` };
  }

  if (TOKEN_PROGRAMS.has(program)) {
    const discriminator = data[0];
    if (discriminator === TOKEN_IX.syncNative && data.length === 1) return { kind: "sync-native", program };
    if ((discriminator === TOKEN_IX.transferChecked || discriminator === TOKEN_IX.approveChecked) && data.length === 10) {
      const amount = readU64(data, 1);
      const decimals = data[9]!;
      const [a0, a1, a2, a3] = [account(ix, 0), account(ix, 1), account(ix, 2), account(ix, 3)];
      if (amount === null || !a0 || !a1 || !a2 || !a3) {
        return { kind: "unpriced", program, reason: "token instruction is missing accounts" };
      }
      return discriminator === TOKEN_IX.transferChecked
        ? { kind: "move", move: { kind: "token.transfer", program, source: a0, mint: a1, destination: a2, authority: a3, amount, decimals } }
        : { kind: "move", move: { kind: "token.approve", program, source: a0, mint: a1, delegate: a2, owner: a3, amount, decimals } };
    }
    if (discriminator === TOKEN_IX.transfer || discriminator === TOKEN_IX.approve) {
      return { kind: "unpriced", program, reason: "unchecked token transfer/approve names no mint, so it cannot be priced — use the checked form" };
    }
    return { kind: "unpriced", program, reason: `token instruction ${discriminator ?? "?"} can move value outside an allowance` };
  }

  if (program === ASSOCIATED_TOKEN_PROGRAM) {
    return { kind: "unpriced", program, reason: "creating a token account spends rent outside any allowance" };
  }

  return { kind: "opaque", program };
}

/** Wrapped SOL is SOL: one allowance, one cap. */
function assetOf(mint: string): SpendAsset {
  return mint === WSOL_MINT ? "native" : mint;
}

export interface InstructionAnalysis {
  moves: DecodedMove[];
  programs: string[];
  /** Programs whose instructions Flightpath cannot see into. */
  opaque: string[];
  unpriced: Array<{ program: string; reason: string }>;
}

export function analyzeInstructions(instructions: SerializedInstruction[]): InstructionAnalysis {
  const moves: DecodedMove[] = [];
  const programs = new Set<string>();
  const opaque = new Set<string>();
  const unpriced: Array<{ program: string; reason: string }> = [];
  for (const ix of instructions) {
    programs.add(ix.programAddress);
    const decoded = decodeInstruction(ix);
    if (decoded.kind === "move") moves.push(decoded.move);
    else if (decoded.kind === "opaque") opaque.add(decoded.program);
    else if (decoded.kind === "unpriced") unpriced.push({ program: decoded.program, reason: decoded.reason });
  }
  return { moves, programs: [...programs], opaque: [...opaque], unpriced };
}

/**
 * The value legs an intent moves, summed per asset. A swap's route is opaque
 * by design, so its spend is the quoted input the builder declared — the
 * router cannot take more than that amount in. Every other kind is priced
 * from its instructions alone, so a builder cannot understate what it sends.
 */
export function spendLegs(intent: ExecutionIntent): SpendLeg[] {
  if (intent.kind === "swap.exactIn") {
    return intent.spendAmount > 0n ? [{ asset: intent.spendAsset, amount: intent.spendAmount }] : [];
  }
  const totals = new Map<SpendAsset, bigint>();
  for (const move of analyzeInstructions(intent.instructions).moves) {
    const asset = move.kind === "sol.transfer" ? "native" : assetOf(move.mint);
    const amount = move.kind === "sol.transfer" ? move.lamports : move.amount;
    if (amount > 0n) totals.set(asset, (totals.get(asset) ?? 0n) + amount);
  }
  return [...totals.entries()].map(([asset, amount]) => ({ asset, amount }));
}

/**
 * Whoever ends up able to move value because of this intent.
 *
 * Precedence rule: what the chain will act on wins. `meta` is supplied by
 * whoever built the intent, so trusting it over the instructions would let a
 * caller name an allowlisted recipient in meta while the bytes pay somebody
 * else. A token transfer's destination is a token ACCOUNT; it resolves to
 * meta.recipient only when it is exactly that wallet's associated token
 * account for the mint — otherwise the raw account is the counterparty, and
 * a raw token account is never on a wallet allowlist.
 */
export async function counterpartiesOf(intent: ExecutionIntent): Promise<string[]> {
  if (intent.kind === "swap.exactIn") {
    return intent.meta?.recipient ? [intent.meta.recipient] : [];
  }
  const parties: string[] = [];
  for (const move of analyzeInstructions(intent.instructions).moves) {
    if (move.kind === "sol.transfer") parties.push(move.to);
    else if (move.kind === "token.approve") parties.push(move.delegate);
    else parties.push(await resolveTokenDestination(move, intent.meta?.recipient));
  }
  return parties;
}

const TOKEN_CLOSE_ACCOUNT = 9;

async function ataOf(owner: string, mint: string, tokenProgram: string): Promise<string | null> {
  try {
    const [ata] = await findAssociatedTokenPda({ owner: owner as never, mint: mint as never, tokenProgram: tokenProgram as never });
    return ata;
  } catch {
    return null;
  }
}

/**
 * A swap's route is opaque, but the plumbing around it is not: every System,
 * Token and associated-token instruction a route carries must act on the
 * signer's own accounts. Wrapping SOL pays the signer's wrapped-SOL account,
 * account creation creates the signer's accounts at the signer's expense, and
 * closing the wrapper refunds the signer. Anything else — a SOL transfer to a
 * third party slipped into a quote response, a close that refunds someone
 * else — is refused. Returns the violation, or null.
 */
export async function swapPlumbingViolation(intent: ExecutionIntent): Promise<string | null> {
  const owner = intent.meta?.recipient;
  if (!owner) return "a swap intent must name its recipient (the signer)";
  for (const ix of intent.instructions) {
    const program = ix.programAddress;
    if (!SWAP_PLUMBING.has(program) || INERT_PROGRAMS.has(program)) continue;
    const decoded = decodeInstruction(ix);
    if (program === SYSTEM_PROGRAM) {
      if (decoded.kind !== "move" || decoded.move.kind !== "sol.transfer") return "a swap carries a System instruction other than wrapping SOL";
      const wrapped = await ataOf(owner, WSOL_MINT, TOKEN_PROGRAM);
      if (decoded.move.from !== owner || decoded.move.to !== wrapped) {
        return `a swap moves SOL to ${decoded.move.to}, which is not the signer's wrapped-SOL account`;
      }
      continue;
    }
    if (TOKEN_PROGRAMS.has(program)) {
      if (decoded.kind === "sync-native") continue;
      const data = base64ToBytes(ix.data);
      if (data[0] === TOKEN_CLOSE_ACCOUNT && data.length === 1 && account(ix, 1) === owner && account(ix, 2) === owner) continue;
      return "a swap carries a token instruction other than syncing or closing the signer's own wrapped-SOL account";
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM) {
      // [payer, associated account, wallet, mint, system, token program]
      const [payer, created, wallet, mint, , tokenProgram] = ix.accounts.map((meta) => meta.address);
      const expected = wallet && mint && tokenProgram ? await ataOf(wallet, mint, tokenProgram) : null;
      if (payer !== owner || wallet !== owner || !created || created !== expected) {
        return "a swap creates a token account that is not the signer's own";
      }
      continue;
    }
  }
  return null;
}

async function resolveTokenDestination(
  move: Extract<DecodedMove, { kind: "token.transfer" }>,
  claimedOwner: string | undefined,
): Promise<string> {
  if (!claimedOwner) return move.destination;
  try {
    const [ata] = await findAssociatedTokenPda({
      owner: claimedOwner as never,
      mint: move.mint as never,
      tokenProgram: move.program as never,
    });
    return ata === move.destination ? claimedOwner : move.destination;
  } catch {
    return move.destination;
  }
}

export class PolicyEngine {
  // Plain fields rather than TypeScript parameter properties: the SDK is meant
  // to run under type-stripping runtimes (node --experimental-strip-types,
  // Deno, Bun) with no build step, and those reject parameter properties.
  readonly policy: WalletPolicy;
  readonly spendTracker: SpendTracker;
  private readonly options: { rwaApprovedAssets?: string[] };

  constructor(
    policy: WalletPolicy,
    spendTracker: SpendTracker = new MemorySpendTracker(),
    options: { rwaApprovedAssets?: string[] } = {},
  ) {
    // Refuse a nonsensical threshold rather than silently behaving as if no
    // human gate were configured. Failing loudly at construction is the only
    // safe reading of "approvalThreshold: 1.5".
    const threshold = policy.approvalThreshold;
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
      throw new Error(
        `invalid approvalThreshold ${threshold}: must be a fraction between 0 and 1 (it gates spends above that share of the daily allowance)`,
      );
    }
    this.policy = policy;
    this.spendTracker = spendTracker;
    this.options = options;
  }

  async evaluate(intent: ExecutionIntent): Promise<PolicyDecision> {
    const { policy } = this;

    if (policy.mode !== "operator") {
      return {
        verdict: "deny",
        rule: "wallet.mode",
        reason: `wallet mode is "${policy.mode}" — onchain writes require an operator wallet`,
      };
    }

    // Read what the transaction will execute. Instructions nobody can price
    // are refused outright; opaque programs are tolerated only where the
    // intent kind exists to call them, and only if allowlisted below.
    const analysis = analyzeInstructions(intent.instructions);
    const invokes = intent.kind === "program.invoke";
    const swaps = intent.kind === "swap.exactIn";
    if (swaps) {
      const violation = await swapPlumbingViolation(intent);
      if (violation) return { verdict: "deny", rule: "instructions.recognized", reason: violation };
    } else {
      const unpriced = analysis.unpriced[0];
      if (unpriced) {
        return { verdict: "deny", rule: "instructions.recognized", reason: `${unpriced.program}: ${unpriced.reason}` };
      }
      if (!invokes && analysis.opaque.length > 0) {
        return {
          verdict: "deny",
          rule: "instructions.recognized",
          reason: `a ${intent.kind} intent carries instructions to ${analysis.opaque.join(", ")}, which it has no reason to call`,
        };
      }
    }

    // Counterparty allowlist. "Counterparty" is whoever ends up able to move
    // value: a transfer's recipient, an approval's DELEGATE, a swap's output
    // owner. A PRESENT list is authoritative — an empty one means "no
    // counterparty is allowed", not "no restriction". Reading [] as
    // unrestricted would turn the most restrictive-looking config into the
    // most permissive.
    if (policy.allowedRecipients !== undefined) {
      const allowed = new Set(policy.allowedRecipients);
      for (const counterparty of await counterpartiesOf(intent)) {
        if (!allowed.has(counterparty)) {
          return {
            verdict: "deny",
            rule: "recipients.allowlist",
            reason: `counterparty ${counterparty} is not on the allowlist`,
          };
        }
      }
    }

    // Program allowlist for anything that hands instructions to a program the
    // policy cannot read. For a swap, the chain's own plumbing around the
    // router (wrap, account creation, close) is expected; the router is not.
    if (invokes || swaps) {
      const allowed = new Set(policy.allowedPrograms);
      const mustBeListed = swaps
        ? analysis.programs.filter((program) => !SWAP_PLUMBING.has(program))
        : analysis.programs.filter((program) => !INERT_PROGRAMS.has(program));
      if (mustBeListed.length === 0) {
        if (swaps) return { verdict: "deny", rule: "programs.allowlist", reason: "a swap with no router instruction is not a swap" };
      }
      for (const program of mustBeListed) {
        if (!allowed.has(program)) {
          return { verdict: "deny", rule: "programs.allowlist", reason: `program ${program} is not on the allowlist` };
        }
      }
    }

    // RWA gating keys on the MINTS the instructions touch as well as the
    // intent kind, so a transfer_spl of a registry asset is still an RWA
    // action. Boundary, stated plainly: the registry lists APPROVED assets, so
    // an asset nobody has told us about cannot be recognised as an RWA at all.
    if (intent.kind === "rwa.interact" && policy.rwaApprovedOnly !== false) {
      const registry = new Set(this.options.rwaApprovedAssets ?? []);
      const mints = analysis.moves.filter((move) => move.kind !== "sol.transfer").map((move) => (move as { mint: string }).mint);
      const targets = mints.length > 0 ? mints : [intent.to];
      const outside = targets.find((mint) => !registry.has(mint));
      if (outside) {
        return { verdict: "deny", rule: "rwa.approved", reason: `mint ${outside} is not on the approved RWA registry` };
      }
    }

    // Allowance accounting, per asset, over everything the instructions move.
    for (const leg of spendLegs(intent)) {
      const allowance = policy.allowances.find((entry) => entry.asset === leg.asset);
      if (!allowance) {
        return {
          verdict: "deny",
          rule: "allowance.missing",
          reason: `no allowance configured for asset ${leg.asset}`,
        };
      }
      const perTx = allowance.perTx ?? allowance.perDay;
      if (leg.amount > perTx) {
        return {
          verdict: "deny",
          rule: "allowance.perTx",
          reason: `spend ${leg.amount} exceeds per-transaction cap ${perTx}`,
        };
      }
      const spent = await this.spendTracker.spentInWindow(leg.asset, DAY_MS);
      if (spent + leg.amount > allowance.perDay) {
        return {
          verdict: "deny",
          rule: "allowance.daily",
          reason: `daily allowance exhausted (${spent} of ${allowance.perDay} spent)`,
        };
      }
      // Range is guaranteed by the constructor, so a configured threshold
      // always applies — it can no longer vanish through bad config.
      const threshold = policy.approvalThreshold;
      if (threshold !== undefined) {
        const thresholdAmount = (allowance.perDay * BigInt(Math.round(threshold * 10_000))) / 10_000n;
        if (leg.amount > thresholdAmount) {
          return {
            verdict: "needs_approval",
            rule: "allowance.approvalThreshold",
            reason: `spend exceeds ${Math.round(threshold * 100)}% of daily allowance — human approval required`,
          };
        }
      }
    }

    return { verdict: "allow", rule: "default", reason: "within policy" };
  }

  /**
   * Reserve every leg of this intent against the daily caps, atomically.
   *
   * Returns null on success, or the rule/reason that refused. Callers MUST
   * treat a refusal as a hard stop before broadcasting: the reservation is the
   * real enforcement point, and evaluate()'s earlier check is only a fast fail.
   */
  async reserveSpend(intent: ExecutionIntent): Promise<{ rule: string; reason: string } | null> {
    if (!this.spendTracker.reserveSpend) {
      // A tracker without atomic reservation cannot protect concurrent spends;
      // recordSpend still debits, so the cap holds serially but not in a race.
      await this.recordSpend(intent);
      return null;
    }
    for (const leg of spendLegs(intent)) {
      const allowance = this.policy.allowances.find((entry) => entry.asset === leg.asset);
      if (!allowance) {
        return { rule: "allowance.missing", reason: `no allowance configured for asset ${leg.asset}` };
      }
      const ok = await this.spendTracker.reserveSpend(leg.asset, leg.amount, DAY_MS, allowance.perDay);
      if (!ok) {
        return {
          rule: "allowance.daily",
          reason: `daily allowance for ${leg.asset} would be exceeded by this spend`,
        };
      }
    }
    return null;
  }

  async recordSpend(intent: ExecutionIntent): Promise<void> {
    // Debit exactly the legs evaluate() checked, or the caps drift apart.
    for (const leg of spendLegs(intent)) {
      await this.spendTracker.recordSpend(leg.asset, leg.amount);
    }
  }
}
