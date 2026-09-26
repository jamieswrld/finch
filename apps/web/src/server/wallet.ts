import "server-only";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { secretKeyBytes } from "@finch/flightpath";

/**
 * FINCH FEE WALLET — isolated signing boundary.
 *
 * Finch's fee wallet on Solana. Its secret key may exist ONLY as the
 * server-side secret FINCH_FEE_WALLET_PRIVATE_KEY (a base58 64-byte secret
 * key or a JSON array of 64 numbers). It must never appear in client JS,
 * NEXT_PUBLIC_*, browser storage, git, MongoDB, analytics, logs, error
 * output, or API responses — and this module is the only place in the
 * codebase allowed to materialize it.
 *
 * Holding the key authorizes NOTHING by itself: no code moves or trades funds
 * autonomously. Fund operations require an explicitly authorized workflow
 * that imports from here and follows the audit checklist.
 */

export function feeWalletConfigured(): boolean {
  return Boolean(process.env.FINCH_FEE_WALLET_PRIVATE_KEY);
}

let signer: Promise<KeyPairSigner> | null = null;

function load(): Promise<KeyPairSigner> {
  const key = process.env.FINCH_FEE_WALLET_PRIVATE_KEY;
  if (!key) {
    return Promise.reject(new Error("fee wallet is not configured in this environment (FINCH_FEE_WALLET_PRIVATE_KEY unset)"));
  }
  // Decode errors are rethrown without the input: the message must never
  // carry any part of the secret.
  try {
    signer ??= createKeyPairSignerFromBytes(secretKeyBytes(key));
  } catch {
    return Promise.reject(new Error("FINCH_FEE_WALLET_PRIVATE_KEY is not a valid Solana secret key"));
  }
  return signer.catch(() => {
    signer = null;
    throw new Error("FINCH_FEE_WALLET_PRIVATE_KEY is not a valid Solana secret key");
  });
}

/** Derived public address only — safe to display. Null until the secret is configured. */
export async function getFeeWalletAddress(): Promise<string | null> {
  try {
    return (await load()).address;
  } catch {
    return null;
  }
}

/**
 * The signer. Callers must be explicitly authorized server workflows; never
 * call this from a route that echoes state back to a browser. Throws (with no
 * secret material in the message) when unconfigured.
 */
export function getFeeWalletSigner(): Promise<KeyPairSigner> {
  return load();
}
