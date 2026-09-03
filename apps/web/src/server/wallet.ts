import "server-only";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * FINCH FEE WALLET — isolated signing boundary.
 *
 * The creator-fee recipient for the $FINCH Pons launch. Its private key may
 * exist ONLY as the server-side secret FINCH_FEE_WALLET_PRIVATE_KEY. It must
 * never appear in client JS, NEXT_PUBLIC_*, browser storage, git, MongoDB,
 * analytics, logs, error output, or API responses — and this module is the
 * only place in the codebase allowed to materialize it.
 *
 * Holding the key authorizes NOTHING by itself: no code moves or trades funds
 * autonomously. Fund operations require an explicitly authorized workflow
 * that imports from here, passes the Pons launch guard (server/pons.ts), and
 * follows the audit checklist.
 */

export function feeWalletConfigured(): boolean {
  return Boolean(process.env.FINCH_FEE_WALLET_PRIVATE_KEY);
}

/** Derived address only — safe to display. Null until the secret is configured. */
export function getFeeWalletAddress(): `0x${string}` | null {
  try {
    const key = process.env.FINCH_FEE_WALLET_PRIVATE_KEY;
    if (!key) return null;
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

/**
 * The signing account. Callers must be explicitly authorized server workflows;
 * never call this from a route that echoes state back to a browser. Throws
 * (with no secret material in the message) when unconfigured.
 */
export function getFeeWalletAccount(): PrivateKeyAccount {
  const key = process.env.FINCH_FEE_WALLET_PRIVATE_KEY;
  if (!key) {
    throw new Error("fee wallet is not configured in this environment (FINCH_FEE_WALLET_PRIVATE_KEY unset)");
  }
  return privateKeyToAccount(key as `0x${string}`);
}
