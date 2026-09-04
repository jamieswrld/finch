import "server-only";
import { createHash } from "node:crypto";
import { getCollections, isDbConfigured } from "@finch/db";

/**
 * Write identity.
 *
 * Finch has no user accounts yet. Rather than pretend otherwise, writes carry
 * an OPTIONAL publisher key: a caller may present `x-finch-key`, which is
 * matched against the SHA-256 hashes in `api_keys`. Two consequences, both
 * deliberate:
 *
 *   · With a valid key you own what you create and may update it.
 *   · Without one you are anonymous — you can create, but you can never
 *     overwrite a record that already exists.
 *
 * That is what makes the registry safe to expose before accounts land: nobody
 * can silently take over another publisher's handle.
 */

export interface Identity {
  /** Stable owner id, or null for an anonymous caller. */
  owner: string | null;
  scopes: string[];
}

export const ANONYMOUS: Identity = { owner: null, scopes: [] };

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/** Resolve the caller. An unknown or revoked key is treated as anonymous, never as its claimed owner. */
export async function resolveIdentity(request: Request): Promise<Identity> {
  const raw = request.headers.get("x-finch-key");
  if (!raw || raw.length < 8 || !isDbConfigured()) return ANONYMOUS;

  try {
    const { apiKeys } = await getCollections();
    const record = await apiKeys.findOne({ keyHash: hashKey(raw), revoked: { $ne: true } });
    if (!record) return ANONYMOUS;
    // Best-effort usage stamp; never fail the request over it.
    void apiKeys.updateOne({ keyHash: record.keyHash }, { $set: { lastUsedAt: new Date().toISOString() } }).catch(() => {});
    return { owner: record.owner, scopes: record.scopes ?? [] };
  } catch {
    return ANONYMOUS;
  }
}

export type OwnershipVerdict =
  | { ok: true; mode: "create" | "update" }
  | { ok: false; status: number; reason: string };

/**
 * May this identity write this record?
 *
 * - No existing record → create.
 * - Existing record owned by this identity → update.
 * - Existing record owned by someone else, or by nobody while the caller is
 *   anonymous → refused. Silently overwriting is never an option.
 */
export function canWrite(identity: Identity, existingOwner: string | null | undefined): OwnershipVerdict {
  // Publishing requires a key. Reading and RUNNING stay open to everyone —
  // that is the product — but an anonymous create is an unauthenticated write
  // into a shared database, which on a public deployment means anyone on the
  // internet can fill the registry with rows nobody can remove.
  if (!identity.owner) {
    // Anyone may create. A record created without a key has no owner, and an
    // unowned record can never be overwritten — by anyone — so an anonymous
    // creation is permanent as published rather than a name someone else can
    // take over. Sign for a free key to own what you publish and edit it later.
    if (existingOwner === undefined) return { ok: true, mode: "create" };
    return {
      ok: false,
      status: existingOwner === null ? 409 : 401,
      reason:
        existingOwner === null
          ? "this name is taken by a record published without a key; it cannot be overwritten — choose another name"
          : "this name belongs to a publisher — present the key that owns it (x-finch-key) to update it",
    };
  }
  if (existingOwner === undefined || existingOwner === null) {
    // Nothing stored yet, or a legacy record with no owner recorded.
    return existingOwner === undefined
      ? { ok: true, mode: "create" }
      : {
          ok: false,
          status: 409,
          reason: "this name is taken by a record with no recorded owner and cannot be overwritten",
        };
  }
  if (identity.owner && identity.owner === existingOwner) return { ok: true, mode: "update" };
  return {
    ok: false,
    status: identity.owner ? 403 : 401,
    reason: identity.owner
      ? "this name belongs to another publisher"
      : "this name is already taken — present a publisher key (x-finch-key) that owns it to update it",
  };
}
