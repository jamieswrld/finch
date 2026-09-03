import { createPublicClient, formatGwei, type PublicClient } from "viem";
import { ROBINHOOD_STACK, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";

/**
 * Live network telemetry for Robinhood Chain.
 *
 * Everything here is a real RPC read. When a read fails, the failure is
 * reported as a failure — no cached optimism, no invented numbers. Callers
 * render `reachable: false` with the error rather than a plausible-looking
 * block height.
 */

export interface EndpointHealth {
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  blockNumber: string | null;
  error?: string;
}

export interface NetworkStatus {
  chainId: number;
  chainName: string;
  stack: string;
  reachable: boolean;
  /** Latest block height as a decimal string. */
  blockNumber: string | null;
  blockTimestamp: string | null;
  /** Seconds between the two most recent sampled blocks. */
  blockTimeSeconds: number | null;
  transactionsInLatestBlock: number | null;
  gasUsed: string | null;
  gasLimit: string | null;
  gasPriceWei: string | null;
  gasPriceGwei: string | null;
  latencyMs: number | null;
  clientVersion: string | null;
  explorerUrl: string | null;
  endpoints: EndpointHealth[];
  sampledAt: string;
  error?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * RPC URLs routinely carry an API key in the path or query (Alchemy, Infura,
 * QuickNode). Endpoint health is public, so publish only origin + a redaction
 * marker — never the credential.
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
 * viem builds messages that embed the endpoint, e.g. "HTTP request failed /
 * Status: 429 / URL: https://host/v2/<APIKEY>", and its own redaction removes
 * only basic-auth
 * user:pass — path and query keys survive verbatim. /api/chain and /api/status
 * are unauthenticated and CDN-cached, so a routine 429 from a paid provider
 * would otherwise hand that provider's billing key to every visitor.
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

/** Raw JSON-RPC for methods viem does not expose (web3_clientVersion). */
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
        const result = await rawRpc(url, "eth_blockNumber");
        return {
          url: publicEndpointLabel(url),
          reachable: true,
          latencyMs: Date.now() - started,
          blockNumber: typeof result === "string" ? BigInt(result).toString() : null,
        } satisfies EndpointHealth;
      } catch (error) {
        return {
          url: publicEndpointLabel(url),
          reachable: false,
          latencyMs: Date.now() - started,
          blockNumber: null,
          error: error instanceof Error ? scrubEndpoints(error.message, [url]).slice(0, 140) : "unknown error",
        } satisfies EndpointHealth;
      }
    }),
  );
}

/**
 * Full network snapshot. Samples the head block plus its predecessor to derive
 * an observed block time (Nitro blocks are sub-second to a few seconds).
 */
export async function getNetworkStatus(target: FlightpathTarget = getFlightpathTarget()): Promise<NetworkStatus> {
  const base: NetworkStatus = {
    chainId: target.chain.id,
    chainName: target.chain.name,
    stack: target.robinhoodConfigured ? ROBINHOOD_STACK : "dev target",
    reachable: false,
    blockNumber: null,
    blockTimestamp: null,
    blockTimeSeconds: null,
    transactionsInLatestBlock: null,
    gasUsed: null,
    gasLimit: null,
    gasPriceWei: null,
    gasPriceGwei: null,
    latencyMs: null,
    clientVersion: null,
    explorerUrl: target.explorerUrl ?? null,
    endpoints: [],
    sampledAt: nowIso(),
  };

  const client = createPublicClient({ chain: target.chain, transport: target.transport }) as PublicClient;
  const started = Date.now();

  try {
    const [block, gasPrice, clientVersion] = await Promise.all([
      client.getBlock({ blockTag: "latest", includeTransactions: false }),
      client.getGasPrice().catch(() => null),
      rawRpc(target.rpcUrl, "web3_clientVersion").catch(() => null),
    ]);

    // Average over a window, not a single delta: Nitro blocks are sub-second,
    // so a one-block integer difference reads as a meaningless "0s".
    let blockTimeSeconds: number | null = null;
    const SAMPLE = 200n;
    if (block.number > SAMPLE) {
      try {
        const earlier = await client.getBlock({ blockNumber: block.number - SAMPLE, includeTransactions: false });
        const elapsed = Number(block.timestamp - earlier.timestamp);
        if (Number.isFinite(elapsed) && elapsed >= 0) {
          blockTimeSeconds = Math.round((elapsed / Number(SAMPLE)) * 1000) / 1000;
        }
      } catch {
        blockTimeSeconds = null;
      }
    }

    return {
      ...base,
      reachable: true,
      blockNumber: block.number.toString(),
      blockTimestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      blockTimeSeconds,
      transactionsInLatestBlock: block.transactions.length,
      gasUsed: block.gasUsed.toString(),
      gasLimit: block.gasLimit.toString(),
      gasPriceWei: gasPrice !== null ? gasPrice.toString() : null,
      gasPriceGwei: gasPrice !== null ? formatGwei(gasPrice) : null,
      latencyMs: Date.now() - started,
      clientVersion: typeof clientVersion === "string" ? clientVersion : null,
      sampledAt: nowIso(),
    };
  } catch (error) {
    return {
      ...base,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? scrubEndpoints(error.message, target.rpcUrls).slice(0, 200) : "network read failed",
      sampledAt: nowIso(),
    };
  }
}
