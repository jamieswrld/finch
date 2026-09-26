import { getFlightpathTarget, SOLANA_CLUSTERS, type FlightpathTarget } from "./chain.ts";

/**
 * Live network telemetry for Solana.
 *
 * Everything here is a real RPC read. When a read fails, the failure is
 * reported as a failure — no cached optimism, no invented numbers. Callers
 * render `reachable: false` with the error rather than a plausible-looking
 * slot height.
 */

export interface EndpointHealth {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  slot: string | null;
  error?: string;
}

export interface NetworkStatus {
  cluster: string;
  /** Wallet-standard chain id, e.g. "solana:mainnet". */
  chain: string;
  chainName: string;
  reachable: boolean;
  /** Whether the RPC's genesis hash is the configured cluster's. Null when it could not be read. */
  genesisMatches: boolean | null;
  /** Latest confirmed slot, decimal string. */
  slot: string | null;
  blockHeight: string | null;
  /** Wall-clock time of the latest confirmed slot's block, when the node has it. */
  blockTime: string | null;
  epoch: number | null;
  /** Share of the current epoch elapsed, 0–100. */
  epochProgressPct: number | null;
  /** Transactions processed since genesis, per the node. */
  transactionCount: string | null;
  /** Transactions per second over the recent performance samples, votes included. */
  tps: number | null;
  /** The same, excluding validator vote transactions — the user-activity figure. */
  nonVoteTps: number | null;
  /** Observed milliseconds per slot over the same samples. */
  slotTimeMs: number | null;
  /** Seconds covered by the samples behind tps and slotTimeMs. */
  sampleSeconds: number | null;
  /** Current network fee for a one-signature message, in lamports. */
  feePerSignatureLamports: string | null;
  /** Priority fees paid in recent slots, micro-lamports per compute unit. */
  priorityFeeMicroLamports: { median: number; p75: number; p95: number; slots: number } | null;
  latencyMs: number | null;
  /** solana-core version the primary endpoint reports. */
  version: string | null;
  explorerUrl: string | null;
  endpoints: EndpointHealth[];
  sampledAt: string;
  error?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * RPC URLs routinely carry an API key in the path or query (Helius, Triton,
 * QuickNode, Alchemy). Endpoint health is public, so publish only origin + a
 * redaction marker — never the credential.
 */
export function publicEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hasSecret = parsed.pathname.replace(/\/+$/, "").length > 1 || parsed.search.length > 0;
    return hasSecret ? `${parsed.origin}/…` : parsed.origin;
  } catch {
    return "invalid rpc url";
  }
}

/**
 * Strip endpoint credentials out of an error message before it can be served.
 *
 * RPC clients build messages that embed the endpoint, e.g. "HTTP error (429)
 * for https://host/?api-key=<KEY>". /api/chain and /api/status are
 * unauthenticated and CDN-cached, so a routine 429 from a paid provider would
 * otherwise hand that provider's billing key to every visitor.
 *
 * Endpoint health is public; the credential is not.
 */
export function scrubEndpoints(message: string, urls: readonly string[]): string {
  let safe = message;
  for (const url of urls) {
    if (!url) continue;
    safe = safe.split(url).join(publicEndpointLabel(url));
    // Also catch the URL with a trailing slash or query appended by the client.
    try {
      const parsed = new URL(url);
      if (parsed.pathname.replace(/\/+$/, "").length > 1 || parsed.search.length > 0) {
        safe = safe.split(parsed.href).join(publicEndpointLabel(url));
      }
    } catch {
      // a malformed configured URL cannot be matched structurally; the plain
      // string replace above is the best available
    }
  }
  // Belt and braces: any residual absolute URL with a non-trivial path is
  // reduced to its origin, so an endpoint we did not know about cannot leak.
  return safe.replace(/https?:\/\/[^\s"']+/g, (match) => publicEndpointLabel(match));
}

/**
 * A readable, credential-free reason for an RPC failure.
 *
 * Kit's production builds reduce messages to "Solana error #8100002; decode…",
 * so the useful part is taken from the error context (the server's own
 * message, or the HTTP status) before falling back to the message.
 */
export function describeRpcError(error: unknown, urls: readonly string[] = []): string {
  let message = "rpc request failed";
  if (error instanceof Error) {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (context && typeof context.__serverMessage === "string") message = context.__serverMessage;
    else if (context && typeof context.statusCode === "number") {
      message = `HTTP ${context.statusCode}${typeof context.message === "string" && context.message ? ` ${context.message}` : ""}`;
    } else if (error.name === "TimeoutError" || error.name === "AbortError") message = "request timed out";
    else message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }
  return scrubEndpoints(message, urls);
}

/** Raw JSON-RPC against one endpoint, for per-endpoint health. */
async function rawRpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`rpc ${method} → HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? `rpc ${method} error`);
  return payload.result;
}

/** Probe each configured endpoint independently so failover state is visible. */
export async function probeEndpoints(target: FlightpathTarget = getFlightpathTarget()): Promise<EndpointHealth[]> {
  return Promise.all(
    target.rpcUrls.map(async (url) => {
      const started = Date.now();
      try {
        const result = await rawRpc(url, "getSlot", [{ commitment: "confirmed" }]);
        return {
          url: publicEndpointLabel(url),
          reachable: true,
          latencyMs: Date.now() - started,
          slot: typeof result === "number" ? String(result) : null,
        } satisfies EndpointHealth;
      } catch (error) {
        return {
          url: publicEndpointLabel(url),
          reachable: false,
          latencyMs: Date.now() - started,
          slot: null,
          error: error instanceof Error ? scrubEndpoints(error.message, [url]).slice(0, 140) : "unknown error",
        } satisfies EndpointHealth;
      }
    }),
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

/** Settle a read to its value or null — one failing figure never hides the others. */
async function maybe<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/**
 * One-signature fee, measured by asking the node to price a real (unsent)
 * message rather than repeating the protocol constant from memory.
 */
async function feePerSignature(target: FlightpathTarget): Promise<bigint | null> {
  const { rpc } = target;
  const {
    appendTransactionMessageInstruction,
    compileTransactionMessage,
    createTransactionMessage,
    getCompiledTransactionMessageEncoder,
    getBase64Decoder,
    pipe,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
  } = await import("@solana/kit");
  const { getAddMemoInstruction } = await import("@solana-program/memo");
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  // A system-owned address as fee payer; the message is priced, never sent.
  const payer = "11111111111111111111111111111112" as never;
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: "fee probe" }), m),
  );
  const bytes = getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message));
  const encoded = getBase64Decoder().decode(bytes);
  const { value } = await rpc.getFeeForMessage(encoded as never, { commitment: "confirmed" }).send();
  return value === null ? null : BigInt(value);
}

/** Full network snapshot. */
export async function getNetworkStatus(target: FlightpathTarget = getFlightpathTarget()): Promise<NetworkStatus> {
  const base: NetworkStatus = {
    cluster: target.cluster,
    chain: target.chain,
    chainName: target.name,
    reachable: false,
    genesisMatches: null,
    slot: null,
    blockHeight: null,
    blockTime: null,
    epoch: null,
    epochProgressPct: null,
    transactionCount: null,
    tps: null,
    nonVoteTps: null,
    slotTimeMs: null,
    sampleSeconds: null,
    feePerSignatureLamports: null,
    priorityFeeMicroLamports: null,
    latencyMs: null,
    version: null,
    explorerUrl: target.explorerUrl ?? null,
    endpoints: [],
    sampledAt: nowIso(),
  };

  const { rpc } = target;
  const started = Date.now();

  try {
    // The epoch read is the reachability probe: if it fails, nothing is claimed.
    const epochInfo = await rpc.getEpochInfo({ commitment: "confirmed" }).send();
    const latencyMs = Date.now() - started;
    const slot = BigInt(epochInfo.absoluteSlot);

    const [samples, fees, txCount, version, genesis, blockTime, fee] = await Promise.all([
      maybe(() => rpc.getRecentPerformanceSamples(30).send()),
      maybe(() => rpc.getRecentPrioritizationFees().send()),
      maybe(() => rpc.getTransactionCount({ commitment: "confirmed" }).send()),
      maybe(() => rpc.getVersion().send()),
      maybe(() => rpc.getGenesisHash().send()),
      maybe(() => rpc.getBlockTime(slot).send()),
      maybe(() => feePerSignature(target)),
    ]);

    let tps: number | null = null;
    let nonVoteTps: number | null = null;
    let slotTimeMs: number | null = null;
    let sampleSeconds: number | null = null;
    if (samples && samples.length > 0) {
      const seconds = samples.reduce((sum, sample) => sum + Number(sample.samplePeriodSecs), 0);
      const transactions = samples.reduce((sum, sample) => sum + Number(sample.numTransactions), 0);
      const nonVote = samples.reduce((sum, sample) => sum + Number(sample.numNonVoteTransactions ?? 0), 0);
      const slots = samples.reduce((sum, sample) => sum + Number(sample.numSlots), 0);
      if (seconds > 0) {
        sampleSeconds = seconds;
        tps = Math.round(transactions / seconds);
        nonVoteTps = samples.every((sample) => sample.numNonVoteTransactions !== undefined) ? Math.round(nonVote / seconds) : null;
        slotTimeMs = slots > 0 ? Math.round((seconds * 1000) / slots) : null;
      }
    }

    let priorityFeeMicroLamports: NetworkStatus["priorityFeeMicroLamports"] = null;
    if (fees && fees.length > 0) {
      const sorted = fees.map((entry) => Number(entry.prioritizationFee)).sort((a, b) => a - b);
      priorityFeeMicroLamports = {
        median: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p95: percentile(sorted, 95),
        slots: sorted.length,
      };
    }

    return {
      ...base,
      reachable: true,
      genesisMatches: genesis === null ? null : genesis === SOLANA_CLUSTERS[target.cluster].genesisHash,
      slot: slot.toString(),
      blockHeight: epochInfo.blockHeight.toString(),
      blockTime: blockTime !== null ? new Date(Number(blockTime) * 1000).toISOString() : null,
      epoch: Number(epochInfo.epoch),
      epochProgressPct:
        Number(epochInfo.slotsInEpoch) > 0
          ? Math.round((Number(epochInfo.slotIndex) / Number(epochInfo.slotsInEpoch)) * 10_000) / 100
          : null,
      transactionCount: txCount !== null ? txCount.toString() : null,
      tps,
      nonVoteTps,
      slotTimeMs,
      sampleSeconds,
      feePerSignatureLamports: fee !== null ? fee.toString() : null,
      priorityFeeMicroLamports,
      latencyMs,
      version: version ? String(version["solana-core"]) : null,
      sampledAt: nowIso(),
    };
  } catch (error) {
    return {
      ...base,
      latencyMs: Date.now() - started,
      error: describeRpcError(error, target.rpcUrls).slice(0, 200),
      sampledAt: nowIso(),
    };
  }
}
