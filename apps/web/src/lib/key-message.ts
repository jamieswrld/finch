/**
 * The exact text a wallet signs to be issued a publisher key.
 *
 * Shared by the client (which asks the wallet to sign it) and the route
 * (which verifies the signature against it), so the two can never drift. It
 * is a plain message, not a transaction: it costs nothing and cannot move
 * funds, and it says so in the text the wallet shows.
 */
export const KEY_MESSAGE_PREFIX = "Finch publisher key";

export function keyMessage(address: string, nonce: string): string {
  return `${KEY_MESSAGE_PREFIX}\nAddress: ${address}\nNonce: ${nonce}\n\nSigning this issues a key for publishing to the Finch registry. It is not a transaction.`;
}
