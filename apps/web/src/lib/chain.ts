import { defineChain, type Chain } from "viem";

/**
 * Robinhood Chain — client-safe config with the official mainnet parameters
 * baked in (verified live: eth_chainId → 0x1237 = 4663). NEXT_PUBLIC_* env
 * vars override at build time; they are inlined by Next.js.
 *
 *   chain id  4663
 *   rpc       https://rpc.mainnet.chain.robinhood.com
 *   explorer  https://explorer.mainnet.chain.robinhood.com (Blockscout)
 */

export const ROBINHOOD_CHAIN_ID = 4663;

const chainId = process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID
  ? Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID)
  : ROBINHOOD_CHAIN_ID;
const rpcUrl = process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const explorerUrl =
  process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL ?? "https://explorer.mainnet.chain.robinhood.com";
const chainName = process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME ?? "Robinhood Chain";

export const robinhoodConfigured = true;

export const appChain: Chain = defineChain({
  id: chainId,
  name: chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Robinhood Chain Blockscout", url: explorerUrl } },
});

export const chainLabel = `${chainName} · ${chainId}`;

export const chainStatusNote = `Connected surface targets ${chainName} (chain ${chainId}) via ${rpcUrl}.`;
