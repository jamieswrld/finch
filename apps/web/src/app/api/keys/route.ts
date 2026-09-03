import { createHash, randomBytes } from "node:crypto";
import { getCollections, isDbConfigured } from "@finch/db";
import { isAddress, verifyMessage } from "viem";
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
 */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, 6);
  if (limited) return limited;
  if (!isDbConfigured()) return errorJson(503, "no registry database — keys have nowhere to live in this environment");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const { address, nonce, signature } = body.body as { address?: string; nonce?: string; signature?: string };
  if (!address || !isAddress(address)) return errorJson(400, "address must be an EVM address");
  if (!nonce || !/^[a-zA-Z0-9_-]{8,64}$/.test(nonce)) return errorJson(400, "nonce must be 8-64 url-safe characters");
  if (!signature || !/^0x[a-fA-F0-9]{130}$/.test(signature)) return errorJson(400, "signature must be a 65-byte hex signature");

  const valid = await verifyMessage({ address, message: keyMessage(address, nonce), signature: signature as `0x${string}` }).catch(() => false);
  if (!valid) return errorJson(401, "signature does not verify for that address and nonce");

  const owner = address.toLowerCase();
  const key = `finch_${randomBytes(24).toString("base64url")}`;
  const keyHash = createHash("sha256").update(key).digest("hex");
  const now = new Date().toISOString();

  const { apiKeys } = await getCollections();
  // One active key per wallet: issuing a new one retires the old.
  await apiKeys.updateMany({ owner, revoked: { $ne: true } }, { $set: { revoked: true } });
  await apiKeys.insertOne({ keyHash, owner, label: "wallet", scopes: ["aviary:publish", "nests:write"], createdAt: now, revoked: false });

  return json({ key, owner, scopes: ["aviary:publish", "nests:write"], note: "shown once — only its hash is stored" }, { status: 201 });
}
