/**
 * The exact text a wallet signs to be issued a publisher key.
 *
 * Shared by the client (which asks the wallet to sign it) and the route
 * (which verifies the signature against it), so the two can never drift. It
 * is a plain message, not a transaction: it costs nothing and cannot move
 * funds, and it says so in the text the wallet shows. Both sides use its
 * UTF-8 bytes: the wallet signs them, the route checks the ed25519 signature
 * over them, so one changed character on either side fails verification.
 */
export const KEY_MESSAGE_PREFIX = "Yinsi publisher key";

export function keyMessage(address: string, nonce: string): string {
  return `${KEY_MESSAGE_PREFIX}\nAddress: ${address}\nNonce: ${nonce}\n\nSigning this issues a key for publishing to the Yinsi registry. It is not a transaction.`;
}
