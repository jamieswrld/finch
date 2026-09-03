import { defineChain, fallback, http, type Chain, type Transport } from "viem";
import { arbitrumSepolia } from "viem/chains";

/**
 * Robinhood Chain — Finch's native execution environment.
 *
 * Verified mainnet parameters (probed live: eth_chainId → 0x1237,
 * web3_clientVersion → nitro/v3.11.3):
 *   chain id  4663
 *   stack     Arbitrum Nitro L2
 *   rpc       https://rpc.mainnet.chain.robinhood.com
 *   explorer  https://explorer.mainnet.chain.robinhood.com (Blockscout)
 *   currency  ETH
 *
 * Production deployments should set ROBINHOOD_RPC_URLS to a comma-separated
 * list; the transport then fails over in order rather than depending on a
 * single public endpoint. FLIGHTPATH_FORCE_DEV=1 targets the dev chain.
 */

export const ROBINHOOD_CHAIN_ID = 4663;
export const DEFAULT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const DEFAULT_ROBINHOOD_EXPLORER_URL = "https://explorer.mainnet.chain.robinhood.com";
/**
 * The explorer's JSON API lives on a different host from its UI. The UI host
 * 301-redirects every /api path to the bare root of this one, dropping the
 * path, so pointing API reads at the UI host silently returns HTML.
 */
export const DEFAULT_ROBINHOOD_EXPLORER_API_URL = "https://robinhoodchain.blockscout.com";

/** Arbitrum Nitro: sequencer-confirmed blocks land fast, L1 finality lags. */
export const ROBINHOOD_STACK = "Arbitrum Nitro";

export interface FlightpathTarget {
  chain: Chain;
  /** Primary RPC (first in the list) — shown in UIs. */
  rpcUrl: string;
  /** Every configured endpoint, in failover order. */
  rpcUrls: string[];
  /** viem transport with automatic failover + request batching. */
  transport: Transport;
  robinhoodConfigured: boolean;
  explorerUrl?: string;
  /** Blockscout JSON API base (no trailing slash). Distinct from explorerUrl. */
  explorerApiUrl?: string;
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

export function getRobinhoodChainConfig(): {
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  explorerApiUrl: string;
  name: string;
} {
  const chainId = readEnv("ROBINHOOD_CHAIN_ID") ?? readEnv("NEXT_PUBLIC_ROBINHOOD_CHAIN_ID");
  const rpcList = splitList(readEnv("ROBINHOOD_RPC_URLS"));
  const single = readEnv("ROBINHOOD_RPC_URL") ?? readEnv("NEXT_PUBLIC_ROBINHOOD_RPC_URL");
  const rpcUrls = rpcList.length > 0 ? rpcList : single ? [single] : [DEFAULT_ROBINHOOD_RPC_URL];
  return {
    chainId: chainId ? Number(chainId) : ROBINHOOD_CHAIN_ID,
    rpcUrls,
    explorerUrl:
      readEnv("ROBINHOOD_EXPLORER_URL") ??
      readEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL") ??
      DEFAULT_ROBINHOOD_EXPLORER_URL,
    explorerApiUrl: readEnv("ROBINHOOD_EXPLORER_API_URL") ?? DEFAULT_ROBINHOOD_EXPLORER_API_URL,
    name: readEnv("NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME") ?? "Robinhood Chain",
  };
}

export function buildRobinhoodChain(config = getRobinhoodChainConfig()): Chain {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: config.rpcUrls } },
    blockExplorers: { default: { name: "Robinhood Chain Blockscout", url: config.explorerUrl } },
  });
}

/**
 * Failover transport. Nitro chains produce blocks quickly, so polling is tight
 * (1s) and calls are batched to keep a single round trip per render.
 */
function buildTransport(rpcUrls: string[]): Transport {
  const transports = rpcUrls.map((url) =>
    http(url, { batch: { wait: 16 }, timeout: 15_000, retryCount: 2, retryDelay: 250 }),
  );
  return transports.length > 1 ? fallback(transports, { rank: false }) : transports[0]!;
}

export function getFlightpathTarget(): FlightpathTarget {
  if (readEnv("FLIGHTPATH_FORCE_DEV")) {
    const devRpc = readEnv("FLIGHTPATH_DEV_RPC_URL") ?? arbitrumSepolia.rpcUrls.default.http[0]!;
    return {
      chain: arbitrumSepolia,
      rpcUrl: devRpc,
      rpcUrls: [devRpc],
      transport: buildTransport([devRpc]),
      robinhoodConfigured: false,
      explorerUrl: arbitrumSepolia.blockExplorers?.default.url,
      explorerApiUrl: undefined,
      label: "dev target · arbitrum sepolia (FLIGHTPATH_FORCE_DEV)",
    };
  }

  const config = getRobinhoodChainConfig();
  return {
    chain: buildRobinhoodChain(config),
    rpcUrl: config.rpcUrls[0]!,
    rpcUrls: config.rpcUrls,
    transport: buildTransport(config.rpcUrls),
    robinhoodConfigured: true,
    explorerUrl: config.explorerUrl,
    explorerApiUrl: config.explorerApiUrl,
    label: `${config.name} · ${config.chainId}`,
  };
}

// ── Explorer links ────────────────────────────────────────────────────────
// One helper per entity so no component hand-builds an explorer URL.

export function explorerBase(target: FlightpathTarget = getFlightpathTarget()): string | null {
  const url = target.explorerUrl ?? target.chain.blockExplorers?.default.url;
  return url ? url.replace(/\/$/, "") : null;
}

export function explorerTxUrl(hash: string, target?: FlightpathTarget): string | null {
  const base = explorerBase(target);
  return base ? `${base}/tx/${hash}` : null;
}

export function explorerAddressUrl(address: string, target?: FlightpathTarget): string | null {
  const base = explorerBase(target);
  return base ? `${base}/address/${address}` : null;
}

export function explorerBlockUrl(block: string | number | bigint, target?: FlightpathTarget): string | null {
  const base = explorerBase(target);
  return base ? `${base}/block/${block.toString()}` : null;
}

export function explorerTokenUrl(address: string, target?: FlightpathTarget): string | null {
  const base = explorerBase(target);
  return base ? `${base}/token/${address}` : null;
}
