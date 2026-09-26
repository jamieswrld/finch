/**
 * Solana — client-safe config. Nothing here talks to an RPC: the server
 * builds every transaction and the visitor's wallet sends it, so the browser
 * only needs to know which cluster it is on and where the explorer lives.
 * NEXT_PUBLIC_* env vars are inlined by Next.js at build time.
 *
 *   cluster   mainnet-beta (or devnet / testnet)
 *   explorer  https://solscan.io
 */

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

function parseCluster(value: string | undefined): SolanaCluster {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "devnet" || normalized === "testnet") return normalized;
  // "mainnet" is how people say it; "mainnet-beta" is what the cluster is called.
  return "mainnet-beta";
}

export const solanaCluster: SolanaCluster = parseCluster(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);

/**
 * The Wallet Standard chain id a wallet is asked to sign for. It rides on
 * every signing call, so a wallet on another cluster cannot quietly send the
 * transaction somewhere else.
 */
export const walletChain = (
  solanaCluster === "mainnet-beta" ? "solana:mainnet" : `solana:${solanaCluster}`
) as "solana:mainnet" | "solana:devnet" | "solana:testnet";

export const chainName = "Solana";

export const chainLabel = `${chainName} · ${solanaCluster}`;

export const NATIVE_SYMBOL = "SOL";

export const explorerBaseUrl = (process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL ?? "https://solscan.io").replace(/\/+$/, "");

// Solscan reads mainnet unless told otherwise; a devnet link without the
// cluster query would show "not found" for a transaction that exists.
const clusterQuery = solanaCluster === "mainnet-beta" ? "" : `?cluster=${solanaCluster}`;

export function explorerTxUrl(signature: string): string {
  return `${explorerBaseUrl}/tx/${signature}${clusterQuery}`;
}

export function explorerAddressUrl(address: string): string {
  return `${explorerBaseUrl}/account/${address}${clusterQuery}`;
}

export function explorerTokenUrl(mint: string): string {
  return `${explorerBaseUrl}/token/${mint}${clusterQuery}`;
}
