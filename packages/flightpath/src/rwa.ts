import type { Address } from "viem";

/**
 * Approved RWA interactions.
 *
 * Real-world-asset tokens on Robinhood Chain sit behind issuer permissioning.
 * Agents may only touch assets on this explicit approved registry, and the
 * PolicyEngine enforces it as a hard deny — an agent cannot opt itself out.
 */

export type RwaKind = "tokenized-equity" | "treasury-bill" | "money-market" | "private-credit" | "other";

export interface ApprovedRwaAsset {
  address: Address;
  symbol: string;
  name: string;
  kind: RwaKind;
  issuer: string;
  /** Notes on transfer restrictions / eligibility, surfaced to agents and UIs. */
  restrictions?: string;
}

/**
 * Registry source order:
 *  1. RWA_APPROVED_ASSETS env (JSON array) — operational override
 *  2. empty — no RWA interactions possible until the registry is populated
 */
export function loadApprovedRwaAssets(): ApprovedRwaAsset[] {
  const raw = typeof process !== "undefined" ? process.env.RWA_APPROVED_ASSETS : undefined;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ApprovedRwaAsset =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ApprovedRwaAsset).address === "string" &&
        typeof (item as ApprovedRwaAsset).symbol === "string",
    );
  } catch {
    return [];
  }
}

export function approvedRwaAddresses(): Address[] {
  return loadApprovedRwaAssets().map((asset) => asset.address);
}
