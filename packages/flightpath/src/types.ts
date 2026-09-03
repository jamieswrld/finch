import type { Address, Hex } from "viem";

/**
 * Flightpath — Finch's Robinhood Chain execution layer.
 *
 * Robinhood Chain is EVM. There are no Solana/Jito-style bundling assumptions
 * here: one intent → one transaction, with a mandatory lifecycle of
 * policy check → simulation → (approval) → submission → confirmation → log.
 */

export type IntentKind =
  | "transfer.native"
  | "transfer.erc20"
  | "erc20.approve"
  | "contract.write"
  | "swap.exactIn"
  | "rwa.interact";

export interface ExecutionIntent {
  kind: IntentKind;
  /** Human-readable one-line summary, shown in approvals and logs. */
  summary: string;
  to: Address;
  /** Native value in wei. */
  value: bigint;
  /** Calldata for contract interactions; undefined for plain native transfer. */
  data?: Hex;
  /** Asset being spent, for allowance accounting. "native" or an ERC20 address. */
  spendAsset: "native" | Address;
  /** Amount spent in the asset's smallest unit, for allowance accounting. */
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
  gasEstimate?: string;
  /** Decoded return value for contract calls, JSON-serializable. */
  result?: unknown;
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
  chainId: number;
  createdAt: string;
  state: ExecutionState;
  intent: {
    kind: IntentKind;
    summary: string;
    to: Address;
    value: string;
    data?: Hex;
    spendAsset: "native" | Address;
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
   * parks at awaiting_signature. Whatever comes back as signed is compared to
   * this field by field before the record advances.
   */
  prepared?: {
    from?: Address;
    to: Address;
    value: string;
    data?: Hex;
    gas: string;
  };
  tx?: {
    hash: Hex;
    submittedAt: string;
  };
  receipt?: {
    status: "success" | "reverted";
    blockNumber: string;
    gasUsed: string;
    effectiveGasPrice?: string;
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
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
}

export interface TokenBalance {
  asset: "native" | Address;
  symbol: string;
  decimals: number;
  raw: string;
  formatted: string;
}

export interface PortfolioSnapshot {
  address: Address;
  chainId: number;
  fetchedAt: string;
  balances: TokenBalance[];
}
