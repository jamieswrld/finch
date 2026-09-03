import { explorerTxUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import type { ExecutionRecord } from "./types.ts";

/**
 * PROOF OF FLIGHT — a verifiable receipt for one agent action.
 *
 * The problem it solves: an agent operator can claim anything about what their
 * agent did. A Proof of Flight is the minimum set of facts that lets a third
 * party check the claim themselves — which finch, under which policy, in which
 * transaction, in which block — plus a hash over those facts so the receipt
 * cannot be edited after the fact.
 *
 * Deliberately small. Model traces and tool logs stay offchain in the
 * execution record; only the hash needs anchoring. A proof is issued ONLY for
 * an execution that actually reached a receipt — there is no such thing as a
 * proof for a pending, denied or reverted action.
 */

export const PROOF_VERSION = "proof-of-flight/0.1" as const;

export interface ProofOfFlight {
  version: typeof PROOF_VERSION;
  /** Which agent acted. */
  finchId: string;
  /** Set when the action came from a nest task. */
  nestId?: string;
  taskId?: string;
  /** What it did. */
  action: string;
  summary: string;
  /** Where it happened. */
  chainId: number;
  txHash: string;
  blockNumber: string;
  gasUsed: string;
  /** Under what authority. */
  policy: { verdict: string; rule: string };
  /** Whether a human released it, and who. */
  approval?: { approvedBy: string; at: string };
  simulation: { ok: boolean; gasEstimate?: string };
  /** When the chain confirmed it. */
  confirmedAt: string;
  /** sha256 over the canonical form of every field above. */
  executionHash: string;
  /** Convenience only — never part of the hash. */
  explorerUrl?: string | null;
}

export class ProofUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`no proof of flight: ${reason}`);
    this.name = "ProofUnavailableError";
    this.reason = reason;
  }
}

/**
 * Deterministic serialization. Key order is fixed by construction rather than
 * by object insertion order, so the same execution always hashes identically —
 * across machines, languages and JSON implementations.
 */
export function canonicalizeProof(proof: Omit<ProofOfFlight, "executionHash" | "explorerUrl">): string {
  const ordered: Array<[string, unknown]> = [
    ["version", proof.version],
    ["finchId", proof.finchId],
    ["nestId", proof.nestId ?? null],
    ["taskId", proof.taskId ?? null],
    ["action", proof.action],
    ["summary", proof.summary],
    ["chainId", proof.chainId],
    ["txHash", proof.txHash.toLowerCase()],
    ["blockNumber", proof.blockNumber],
    ["gasUsed", proof.gasUsed],
    ["policyVerdict", proof.policy.verdict],
    ["policyRule", proof.policy.rule],
    ["approvedBy", proof.approval?.approvedBy ?? null],
    ["approvedAt", proof.approval?.at ?? null],
    ["simulationOk", proof.simulation.ok],
    ["simulationGas", proof.simulation.gasEstimate ?? null],
    ["confirmedAt", proof.confirmedAt],
  ];
  return JSON.stringify(ordered);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Issue a proof for a confirmed execution.
 *
 * Throws for anything that did not reach a successful receipt. That refusal is
 * the point: a proof of flight means the flight happened.
 */
export async function buildProofOfFlight(
  record: ExecutionRecord,
  context: { nestId?: string; taskId?: string; target?: FlightpathTarget } = {},
): Promise<ProofOfFlight> {
  if (record.state !== "confirmed") {
    throw new ProofUnavailableError(`execution is "${record.state}", not confirmed`);
  }
  if (!record.tx?.hash) throw new ProofUnavailableError("execution has no transaction hash");
  if (!record.receipt) throw new ProofUnavailableError("execution has no receipt");
  if (record.receipt.status !== "success") {
    throw new ProofUnavailableError(`transaction ${record.receipt.status}, not success`);
  }
  if (!record.simulation?.ok) throw new ProofUnavailableError("execution has no successful simulation");

  const body: Omit<ProofOfFlight, "executionHash" | "explorerUrl"> = {
    version: PROOF_VERSION,
    finchId: record.agentId ?? "unknown",
    nestId: context.nestId,
    taskId: context.taskId,
    action: record.intent.kind,
    summary: record.intent.summary,
    chainId: record.chainId,
    txHash: record.tx.hash,
    blockNumber: record.receipt.blockNumber,
    gasUsed: record.receipt.gasUsed,
    policy: { verdict: record.policy?.verdict ?? "unknown", rule: record.policy?.rule ?? "unknown" },
    approval: record.approval,
    simulation: { ok: record.simulation.ok, gasEstimate: record.simulation.gasEstimate },
    confirmedAt: record.receipt.confirmedAt,
  };

  const target = context.target ?? getFlightpathTarget();
  return {
    ...body,
    executionHash: await sha256Hex(canonicalizeProof(body)),
    explorerUrl: explorerTxUrl(record.tx.hash, target),
  };
}

/** Recompute the hash and compare. Any edited field fails. */
export async function verifyProofOfFlight(proof: ProofOfFlight): Promise<{ valid: boolean; expectedHash: string }> {
  const { executionHash, explorerUrl: _explorerUrl, ...body } = proof;
  const expectedHash = await sha256Hex(canonicalizeProof(body));
  return { valid: expectedHash === executionHash, expectedHash };
}
