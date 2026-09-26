"use client";

import { useFetch } from "./use-fetch";

/** Shape returned by GET /api/chain — mirrors NetworkStatus in @finch/flightpath. */
export interface ChainTelemetry {
  cluster: string;
  /** Wallet-standard chain id, e.g. "solana:mainnet". */
  chain: string;
  chainName: string;
  reachable: boolean;
  /** Whether the RPC's genesis hash is the configured cluster's. Null when it could not be read. */
  genesisMatches: boolean | null;
  slot: string | null;
  blockHeight: string | null;
  blockTime: string | null;
  epoch: number | null;
  epochProgressPct: number | null;
  transactionCount: string | null;
  tps: number | null;
  nonVoteTps: number | null;
  slotTimeMs: number | null;
  sampleSeconds: number | null;
  feePerSignatureLamports: string | null;
  priorityFeeMicroLamports: { median: number; p75: number; p95: number; slots: number } | null;
  latencyMs: number | null;
  version: string | null;
  explorerUrl: string | null;
  endpoints: Array<{ url: string; reachable: boolean; latencyMs: number | null; slot: string | null; error?: string }>;
  sampledAt: string;
  error?: string;
}

/** Live chain telemetry, polled. Default 12s — fast enough to feel alive, slow enough to be polite. */
export function useChain(refreshMs = 12_000) {
  return useFetch<ChainTelemetry>("/api/chain", { refreshMs });
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Slot, block height or any other big counter the API sends as a decimal string. */
export function formatSlot(value: string | null): string {
  if (!value || !/^\d+$/.test(value)) return "—";
  return BigInt(value).toLocaleString("en-US");
}

/**
 * Lamports → SOL without passing through a float, so 5000 lamports reads
 * "0.000005" exactly rather than a rounding artefact.
 */
export function formatLamportsAsSol(lamports: string | null): string {
  if (!lamports || !/^\d+$/.test(lamports)) return "—";
  const value = BigInt(lamports);
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole.toLocaleString("en-US")}.${fraction}` : whole.toLocaleString("en-US");
}

export function formatTps(tps: number | null): string {
  if (tps === null || !Number.isFinite(tps)) return "—";
  return Math.round(tps).toLocaleString("en-US");
}

export function formatSlotTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return String(Math.round(ms));
}

/** Priority fees are micro-lamports per compute unit; whole numbers read best. */
export function formatMicroLamports(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}
