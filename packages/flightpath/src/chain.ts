import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  type Rpc,
  type RpcTransport,
  type SolanaRpcApi,
} from "@solana/kit";

/**
 * Solana — Finch's execution environment. Agents work here and nowhere else.
 *
 *   cluster   mainnet-beta (default) · devnet · testnet
 *   rpc       https://api.mainnet-beta.solana.com (public, heavily rate
 *             limited — production sets SOLANA_RPC_URLS)
 *   explorer  https://solscan.io
 *   currency  SOL (9 decimals; 1 SOL = 1,000,000,000 lamports)
 *
 * SOLANA_RPC_URLS takes a comma-separated list; requests then fail over in
 * order rather than depending on a single endpoint. FLIGHTPATH_FORCE_DEV=1
 * targets devnet.
 */

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

export interface ClusterInfo {
  /** Wallet-standard chain id — what wallets and execution records name the cluster by. */
  chain: `solana:${string}`;
  defaultRpcUrl: string;
  /** Hash of the cluster's genesis block: the one fact that proves which cluster an RPC serves. */
  genesisHash: string;
}

export const SOLANA_CLUSTERS: Record<SolanaCluster, ClusterInfo> = {
  "mainnet-beta": {
    chain: "solana:mainnet",
    defaultRpcUrl: "https://api.mainnet-beta.solana.com",
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
  devnet: {
    chain: "solana:devnet",
    defaultRpcUrl: "https://api.devnet.solana.com",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
  testnet: {
    chain: "solana:testnet",
    defaultRpcUrl: "https://api.testnet.solana.com",
    genesisHash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  },
};

export const DEFAULT_SOLANA_CLUSTER: SolanaCluster = "mainnet-beta";
export const DEFAULT_SOLANA_RPC_URL = SOLANA_CLUSTERS["mainnet-beta"].defaultRpcUrl;
export const DEFAULT_SOLANA_EXPLORER_URL = "https://solscan.io";

export const NATIVE_CURRENCY = { name: "Solana", symbol: "SOL", decimals: 9 } as const;

export interface FlightpathTarget {
  cluster: SolanaCluster;
  /** Wallet-standard chain id, e.g. "solana:mainnet". Stamped on every execution record. */
  chain: `solana:${string}`;
  name: string;
  /** Primary RPC (first in the list) — shown in UIs, credentials redacted. */
  rpcUrl: string;
  /** Every configured endpoint, in failover order. */
  rpcUrls: string[];
  /** RPC client over a failover transport. */
  rpc: Rpc<SolanaRpcApi>;
  explorerUrl: string;
  nativeCurrency: typeof NATIVE_CURRENCY;
  /** True when FLIGHTPATH_FORCE_DEV pointed this at devnet. */
  devTarget: boolean;
  label: string;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name] || undefined;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseCluster(value: string | undefined): SolanaCluster {
  if (value === "devnet" || value === "testnet" || value === "mainnet-beta") return value;
  if (value === "mainnet") return "mainnet-beta";
  return DEFAULT_SOLANA_CLUSTER;
}

export function getSolanaConfig(): {
  cluster: SolanaCluster;
  rpcUrls: string[];
  explorerUrl: string;
  name: string;
} {
  const cluster = parseCluster(readEnv("SOLANA_CLUSTER") ?? readEnv("NEXT_PUBLIC_SOLANA_CLUSTER"));
  const rpcList = splitList(readEnv("SOLANA_RPC_URLS"));
  const single = readEnv("SOLANA_RPC_URL") ?? readEnv("NEXT_PUBLIC_SOLANA_RPC_URL");
  const rpcUrls = rpcList.length > 0 ? rpcList : single ? [single] : [SOLANA_CLUSTERS[cluster].defaultRpcUrl];
  return {
    cluster,
    rpcUrls,
    explorerUrl: readEnv("SOLANA_EXPLORER_URL") ?? readEnv("NEXT_PUBLIC_SOLANA_EXPLORER_URL") ?? DEFAULT_SOLANA_EXPLORER_URL,
    name: "Solana",
  };
}

/**
 * Failover transport: each endpoint in order, each attempt with its own
 * timeout. A caller's abort stops the walk instead of trying the next one.
 */
function failoverTransport(rpcUrls: string[], timeoutMs = 15_000): RpcTransport {
  const transports = rpcUrls.map((url) => createDefaultRpcTransport({ url: url as `https://${string}` }));
  const transport = async (config: Parameters<RpcTransport>[0]) => {
    let lastError: unknown = new Error("no rpc endpoints configured");
    for (const next of transports) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
      try {
        return await next({ ...config, signal });
      } catch (error) {
        if (config.signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError;
  };
  return transport as RpcTransport;
}

const rpcCache = new Map<string, Rpc<SolanaRpcApi>>();

export function createRpc(rpcUrls: string[]): Rpc<SolanaRpcApi> {
  const key = rpcUrls.join(",");
  let rpc = rpcCache.get(key);
  if (!rpc) {
    rpc = createSolanaRpcFromTransport(failoverTransport(rpcUrls)) as unknown as Rpc<SolanaRpcApi>;
    rpcCache.set(key, rpc);
  }
  return rpc;
}

export function getFlightpathTarget(): FlightpathTarget {
  if (readEnv("FLIGHTPATH_FORCE_DEV")) {
    const devRpc = readEnv("FLIGHTPATH_DEV_RPC_URL") ?? SOLANA_CLUSTERS.devnet.defaultRpcUrl;
    return {
      cluster: "devnet",
      chain: SOLANA_CLUSTERS.devnet.chain,
      name: "Solana",
      rpcUrl: devRpc,
      rpcUrls: [devRpc],
      rpc: createRpc([devRpc]),
      explorerUrl: readEnv("SOLANA_EXPLORER_URL") ?? DEFAULT_SOLANA_EXPLORER_URL,
      nativeCurrency: NATIVE_CURRENCY,
      devTarget: true,
      label: "dev target · solana devnet (FLIGHTPATH_FORCE_DEV)",
    };
  }

  const config = getSolanaConfig();
  return {
    cluster: config.cluster,
    chain: SOLANA_CLUSTERS[config.cluster].chain,
    name: config.name,
    rpcUrl: config.rpcUrls[0]!,
    rpcUrls: config.rpcUrls,
    rpc: createRpc(config.rpcUrls),
    explorerUrl: config.explorerUrl,
    nativeCurrency: NATIVE_CURRENCY,
    devTarget: false,
    label: `${config.name} · ${config.cluster}`,
  };
}

// ── Explorer links ────────────────────────────────────────────────────────
// One helper per entity so no component hand-builds an explorer URL. Paths
// follow Solscan; explorer.solana.com accepts the same shapes except tokens,
// which it serves under /address.

export function explorerBase(target: FlightpathTarget = getFlightpathTarget()): string {
  return target.explorerUrl.replace(/\/$/, "");
}

function withCluster(url: string, target: FlightpathTarget): string {
  return target.cluster === "mainnet-beta" ? url : `${url}?cluster=${target.cluster}`;
}

export function explorerTxUrl(signature: string, target: FlightpathTarget = getFlightpathTarget()): string {
  return withCluster(`${explorerBase(target)}/tx/${signature}`, target);
}

export function explorerAddressUrl(address: string, target: FlightpathTarget = getFlightpathTarget()): string {
  return withCluster(`${explorerBase(target)}/account/${address}`, target);
}

export function explorerBlockUrl(slot: string | number | bigint, target: FlightpathTarget = getFlightpathTarget()): string {
  return withCluster(`${explorerBase(target)}/block/${slot.toString()}`, target);
}

export function explorerTokenUrl(mint: string, target: FlightpathTarget = getFlightpathTarget()): string {
  return withCluster(`${explorerBase(target)}/token/${mint}`, target);
}
