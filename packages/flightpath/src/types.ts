import type { SerializedInstruction } from "./codec.ts";

/**
 * Flightpath — Finch's Solana execution layer.
 *
 * One intent → one transaction, with a mandatory lifecycle of
 * policy check → simulation → (approval) → submission → confirmation → log.
 *
 * An intent carries the exact instructions it will execute. The policy engine
 * decodes those instructions rather than trusting the summary or metadata a
 * builder attached, and a user-signed transaction is compared against them
 * instruction by instruction before anything is recorded as submitted.
 */

export type IntentKind =
  | "transfer.native"
  | "transfer.spl"
  | "spl.approve"
  | "program.invoke"
  | "swap.exactIn"
  | "rwa.interact";

/** "native" is SOL; anything else is an SPL mint address. */
export type SpendAsset = "native" | string;

export interface ExecutionIntent {
  kind: IntentKind;
  /** Human-readable one-line summary, shown in approvals and logs. */
  summary: string;
  /**
   * The account the intent is about: the recipient wallet for a SOL
   * transfer, the mint for SPL and RWA actions, the program for an invoke or
   * a swap. Allowlists key on it; the instructions are still authoritative.
   */
  to: string;
  /** The exact instructions, in order. The fee payer is the signer. */
  instructions: SerializedInstruction[];
  /** Address lookup tables the instructions were compiled against (swaps). */
  addressLookupTables?: string[];
  /** Asset being spent, for allowance accounting. */
  spendAsset: SpendAsset;
  /** Amount spent in the asset's smallest unit (lamports for SOL). */
  spendAmount: bigint;
  meta?: Record<string, string>;
}

export type ExecutionState =
  | "created"
  | "denied"
  | "simulated"
  | "simulation_failed"
  | "awaiting_approval"
  | "approved"
  | "awaiting_signature"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "failed";

export type PolicyVerdict = "allow" | "deny" | "needs_approval";

export interface PolicyDecision {
  verdict: PolicyVerdict;
  /** Which rule produced the decision, e.g. "allowance.daily". */
  rule: string;
  reason: string;
}

export interface SimulationResult {
  ok: boolean;
  /** Compute units the simulation consumed. */
  computeUnits?: string;
  /** Network fee for the compiled message, in lamports. */
  feeLamports?: string;
  /** Last program log lines — where Solana puts the reason a simulation failed. */
  logs?: string[];
  error?: string;
  simulatedAt: string;
}

export interface ExecutionLogEntry {
  at: string;
  event: string;
  detail?: string;
}

/**
 * The full, serializable record of one agent action. Everything an auditor
 * needs to reconstruct what an agent did and why — stored via ExecutionSink.
 */
export interface ExecutionRecord {
  /** Caller-supplied idempotency key. Re-executing the same id is a no-op. */
  id: string;
  agentId?: string;
  /** Wallet-standard chain id, e.g. "solana:mainnet". */
  chain: string;
  createdAt: string;
  state: ExecutionState;
  intent: {
    kind: IntentKind;
    summary: string;
    to: string;
    instructions: SerializedInstruction[];
    addressLookupTables?: string[];
    spendAsset: SpendAsset;
    spendAmount: string;
    meta?: Record<string, string>;
  };
  policy?: PolicyDecision;
  /**
   * Set only by resumeApprovedIntent after a human signs off. Its presence is
   * the ONLY thing that releases an intent parked at the approval gate.
   */
  approval?: { approvedBy: string; at: string };
  simulation?: SimulationResult;
  /**
   * The exact transaction handed to an external signer, set when the record
   * parks at awaiting_signature. Whatever lands on chain is compared to this
   * instruction by instruction before the record advances.
   */
  prepared?: {
    feePayer: string;
    instructions: SerializedInstruction[];
    addressLookupTables?: string[];
    computeUnits: string;
  };
  tx?: {
    signature: string;
    submittedAt: string;
  };
  receipt?: {
    /** "failed" means the transaction landed with an instruction error: the fee was paid, nothing else changed. */
    status: "success" | "failed";
    slot: string;
    feeLamports: string;
    computeUnits?: string;
    confirmedAt: string;
  };
  error?: {
    stage: "policy" | "simulation" | "submission" | "confirmation";
    message: string;
  };
  log: ExecutionLogEntry[];
}

/**
 * Where execution records are persisted (memory in dev, MongoDB in prod).
 *
 * `reserve` and `claimApproval` are the concurrency primitives. Without them,
 * idempotency-on-id is only true for sequential callers: two requests racing
 * on one id can both read "nothing stored", both simulate, and both submit.
 * A sink that cannot implement them atomically should say so by leaving them
 * undefined — executeIntent then warns rather than pretending.
 */
export interface ExecutionSink {
  save(record: ExecutionRecord): Promise<void>;
  get(id: string): Promise<ExecutionRecord | null>;
  /**
   * Create the record only if the id is unused. Returns false when another
   * caller already owns it. Must be atomic (Mongo: insertOne against the
   * unique index on `id`).
   */
  reserve?(record: ExecutionRecord): Promise<boolean>;
  /**
   * Stamp an approval only if none is present. Returns false when the record
   * was already approved, so a double-clicked approve button cannot broadcast
   * twice. Must be a compare-and-set.
   */
  claimApproval?(id: string, approval: { approvedBy: string; at: string }): Promise<boolean>;
  /**
   * Move a record from one state to another only if it is currently in
   * `from`. Returns false when someone else already moved it. This is what
   * stops two callers from both acting on a single approval: the winner
   * transitions the record out of the releasable state before any await.
   */
  claimState?(id: string, from: ExecutionState, to: ExecutionState): Promise<boolean>;
}

export class MemoryExecutionSink implements ExecutionSink {
  private records = new Map<string, ExecutionRecord>();

  async save(record: ExecutionRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<ExecutionRecord | null> {
    const found = this.records.get(id);
    return found ? structuredClone(found) : null;
  }

  /** Atomic here by construction: JS runs this to completion without yielding. */
  async reserve(record: ExecutionRecord): Promise<boolean> {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, structuredClone(record));
    return true;
  }

  async claimApproval(id: string, approval: { approvedBy: string; at: string }): Promise<boolean> {
    const found = this.records.get(id);
    if (!found || found.state !== "awaiting_approval" || found.approval) return false;
    found.approval = approval;
    // Leaving this parked would let a concurrent replay through the gate.
    found.state = "approved";
    return true;
  }

  async claimState(id: string, from: ExecutionState, to: ExecutionState): Promise<boolean> {
    const found = this.records.get(id);
    if (!found || found.state !== from) return false;
    found.state = to;
    return true;
  }

  list(): ExecutionRecord[] {
    return [...this.records.values()];
  }
}

export interface TokenData {
  mint: string;
  /** The token program that owns the mint: SPL Token or Token-2022. */
  tokenProgram: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface TokenBalance {
  asset: "native" | string;
  symbol: string | null;
  decimals: number;
  raw: string;
  formatted: string;
}

export interface PortfolioSnapshot {
  address: string;
  chain: string;
  fetchedAt: string;
  balances: TokenBalance[];
}
