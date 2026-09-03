import "server-only";
import { FINCH_CREATOR_TAX_BPS, ROBINHOOD_CHAIN_ID, getFlightpathTarget, getPonsConfig } from "@finch/flightpath";
import { getFeeWalletAddress } from "./wallet";

/**
 * Pons launch guard — every check that must pass BEFORE any $FINCH launch
 * transaction may be signed. If any check fails, the launch is blocked with
 * the reason displayed. Never silently fall back to a different tax rate,
 * recipient, or Pons version.
 */

export interface LaunchCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LaunchGuardResult {
  allowed: boolean;
  creatorTaxBps: number;
  checks: LaunchCheck[];
}

export async function runLaunchGuard(): Promise<LaunchGuardResult> {
  const target = getFlightpathTarget();
  const pons = getPonsConfig();
  const feeWallet = getFeeWalletAddress();

  const checks: LaunchCheck[] = [
    {
      name: "network",
      ok: target.robinhoodConfigured && target.chain.id === ROBINHOOD_CHAIN_ID,
      detail: target.robinhoodConfigured
        ? `connected to chain ${target.chain.id} (expected ${ROBINHOOD_CHAIN_ID})`
        : "Robinhood Chain RPC not configured",
    },
    {
      name: "pons-contracts",
      ok: pons.configured,
      detail: pons.configured ? `factory ${pons.factory}` : "Pons factory address not configured",
    },
    {
      name: "fee-recipient",
      ok: Boolean(feeWallet && pons.feeRecipient && feeWallet.toLowerCase() === pons.feeRecipient.toLowerCase()),
      detail:
        feeWallet && pons.feeRecipient
          ? `recipient ${pons.feeRecipient} ${feeWallet.toLowerCase() === pons.feeRecipient.toLowerCase() ? "matches" : "DOES NOT MATCH"} fee wallet ${feeWallet}`
          : "fee wallet and/or configured recipient missing",
    },
    {
      name: "creator-tax-300bps",
      // Onchain verification of the permitted tax range requires the published
      // Pons ABI; until then this check cannot pass and launches stay blocked.
      ok: false,
      detail: `must verify onchain that ${FINCH_CREATOR_TAX_BPS} bps is permitted by the deployed Pons version — ABI pending`,
    },
  ];

  return {
    allowed: checks.every((check) => check.ok),
    creatorTaxBps: Number(FINCH_CREATOR_TAX_BPS),
    checks,
  };
}
