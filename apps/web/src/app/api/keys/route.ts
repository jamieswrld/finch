import { createHash, randomBytes } from "node:crypto";
import { getCollections, isDbConfigured } from "@finch/db";
import { getBase58Encoder, getPublicKeyFromAddress, isAddress, verifySignature, type SignatureBytes } from "@solana/kit";
import { errorJson, json, rateLimit, readJsonBody } from "@/lib/server/http";
import { keyMessage } from "@/lib/key-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/keys — a publisher key for a wallet, self-serve.
 *
 * Publishing needs a key so the shared registry cannot be filled anonymously.
 * Until now only the operator could mint one, which meant nobody else could
 * publish at all. This issues one to anyone who can sign a message with a
 * wallet: the signature proves control of the address, the address becomes
 * the key's owner, and ownership of every listing published with it follows
 * from that. One active key per address; a new request replaces the old one.
 *
 * The message the wallet signs is fixed text plus the address and a nonce
 * the client generated. It is not a transaction, costs nothing, and cannot
 * move funds. The raw key is returned exactly once; only its hash is stored.
 *
 * A Solana address is its ed25519 public key, so verifying needs nothing but
 * the address, the message bytes and the 64-byte signature — no chain read.
 * The owner is the address exactly as given: base58 is case-sensitive, and
 * lowercasing it would name a different account.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 6);
  if (limited) return limited;
  if (!isDbConfigured()) return errorJson(503, "no registry database — keys have nowhere to live in this environment");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { address, nonce, signature } = (body.body ?? {}) as { address?: unknown; nonce?: unknown; signature?: unknown };
  if (typeof address !== "string" || !isAddress(address)) return errorJson(400, "address must be a Solana address");
  if (typeof nonce !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(nonce)) return errorJson(400, "nonce must be 8-64 url-safe characters");
  const signatureBytes = typeof signature === "string" ? decodeSignature(signature) : null;
  if (!signatureBytes) return errorJson(400, "signature must be a base58 ed25519 signature (64 bytes)");

  const message = new TextEncoder().encode(keyMessage(address, nonce));
  const valid = await getPublicKeyFromAddress(address)
    .then((publicKey) => verifySignature(publicKey, signatureBytes, message))
    .catch(() => false);
  if (!valid) return errorJson(401, "signature does not verify for that address and nonce");

  const owner = address;
  const key = `finch_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const now = new Date().toISOString();

  const { apiKeys } = await getCollections();
  // One active key per wallet: issuing a new one retires the old.
  await apiKeys.updateMany({ owner, revoked: { $ne: true } }, { $set: { revoked: true } });
  await apiKeys.insertOne({ keyHash, owner, label: "wallet", scopes: ["aviary:publish", "nests:write"], createdAt: now, revoked: false });

  return json({ key, owner, scopes: ["aviary:publish", "nests:write"], note: "shown once — only its hash is stored" }, { status: 201 });
}

/** Base58 → exactly 64 bytes, or null. Anything else is not an ed25519 signature. */
function decodeSignature(value: string): SignatureBytes | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)) return null;
  try {
    const bytes = new Uint8Array(getBase58Encoder().encode(value));
    return bytes.length === 64 ? (bytes as SignatureBytes) : null;
  } catch {
    return null;
  }
}
