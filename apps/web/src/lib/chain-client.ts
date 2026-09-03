"use client";

import { useFetch } from "./use-fetch";

/** Shape returned by GET /api/chain — mirrors NetworkStatus in @finch/flightpath. */
export interface ChainTelemetry {
  chainId: number;
  chainName: string;
  stack: string;
  reachable: boolean;
  blockNumber: string | null;
  blockTimestamp: string | null;
  blockTimeSeconds: number | null;
  transactionsInLatestBlock: number | null;
  gasUsed: string | null;
  gasLimit: string | null;
  gasPriceWei: string | null;
  gasPriceGwei: string | null;
  latencyMs: number | null;
  clientVersion: string | null;
  explorerUrl: string | null;
  endpoints: Array<{ url: string; reachable: boolean; latencyMs: number | null; blockNumber: string | null; error?: string }>;
  sampledAt: string;
  error?: string;
}

/** Live chain telemetry, polled. Default 12s — fast enough to feel alive, slow enough to be polite. */
export function useChain(refreshMs = 12_000) {
  return useFetch<ChainTelemetry>("/api/chain", { refreshMs });
}

export function formatBlock(blockNumber: string | null): string {
  if (!blockNumber) return "—";
  return Number(blockNumber).toLocaleString("en-US");
}

export function formatGas(gwei: string | null): string {
  if (!gwei) return "—";
  const value = Number(gwei);
  if (!Number.isFinite(value)) return "—";
  return value < 0.01 ? value.toExponential(2) : value.toFixed(3);
}
