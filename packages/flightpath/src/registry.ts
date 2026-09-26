import type { Address, Signature } from "@solana/kit";
import { explorerAddressUrl, explorerTxUrl, getFlightpathTarget, type FlightpathTarget } from "./chain.ts";
import { isSolanaAddress } from "./codec.ts";

/**
 * The Finch registry — public identity anchored on Solana with the Memo
 * program. No custom program is involved.
 *
 * A registration is a transaction SIGNED by the registry authority
 * (FINCH_REGISTRY_AUTHORITY) carrying one memo:
 *
 *   finch-registry/1 register finch:market-scout sha256:<manifest hash> [uri]
 *
 * The manifest body lives offchain; the hash in the memo is what makes it
 * verifiable. The index is the authority's own signature history, so anyone
 * can rebuild it from Solana alone: list the authority's signatures, keep the
 * memos with this prefix, and confirm the authority actually signed each one.
 * That last check matters — any wallet can send a transaction that merely
 * MENTIONS the authority with a lookalike memo; only the key holder can sign.
 *
 * Every accessor reports unconfigured until FINCH_REGISTRY_AUTHORITY is set.
 * Nothing here invents a registration that does not exist.
 */

export const REGISTRY_MEMO_PREFIX = "finch-registry/1";

export const RegistryKind = { FINCH: "finch", NEST: "nest" } as const;
export type RegistryKindName = keyof typeof RegistryKind;

export interface RegistryConfig {
  configured: boolean;
  authority?: string;
  explorerUrl?: string | null;
}

export function getRegistryConfig(target: FlightpathTarget = getFlightpathTarget()): RegistryConfig {
  const authority = typeof process !== "undefined" ? process.env.FINCH_REGISTRY_AUTHORITY : undefined;
  const valid = isSolanaAddress(authority);
  return {
    configured: valid,
    authority: valid ? authority : undefined,
    explorerUrl: valid ? explorerAddressUrl(authority, target) : null,
  };
}

/**
 * Registry ids are namespaced so a finch and a nest can share a handle without
 * colliding: "finch:market-scout" and "nest:market-scout" are different ids.
 */
export function registryId(kind: RegistryKindName, handle: string): string {
  return `${RegistryKind[kind]}:${handle}`;
}

/** The hash that anchors a manifest, sha256 hex. Callers must hash the exact bytes they publish. */
export async function manifestHash(manifestJson: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manifestJson));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface RegistryMemo {
  kind: RegistryKindName;
  handle: string;
  manifestHash: string;
  uri?: string;
}

const HANDLE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const HASH = /^[0-9a-f]{64}$/;

/** The exact memo text a registration carries. */
export function registryMemo(entry: RegistryMemo): string {
  if (!HANDLE.test(entry.handle)) throw new Error(`invalid handle "${entry.handle}"`);
  if (!HASH.test(entry.manifestHash)) throw new Error("manifestHash must be 64 lowercase hex characters");
  if (entry.uri !== undefined && (/\s/.test(entry.uri) || entry.uri.length > 200)) {
    throw new Error("uri must be a single token of at most 200 characters");
  }
  const parts = [REGISTRY_MEMO_PREFIX, "register", registryId(entry.kind, entry.handle), `sha256:${entry.manifestHash}`];
  if (entry.uri) parts.push(entry.uri);
  return parts.join(" ");
}

/** Parse one registration memo; null for anything that is not exactly one. */
export function parseRegistryMemo(text: string): RegistryMemo | null {
  const parts = text.trim().split(" ");
  if (parts.length < 4 || parts.length > 5) return null;
  const [prefix, verb, id, hash, uri] = parts as [string, string, string, string, string | undefined];
  if (prefix !== REGISTRY_MEMO_PREFIX || verb !== "register") return null;
  const [kind, handle] = id.split(":");
  const kindName = kind === "finch" ? "FINCH" : kind === "nest" ? "NEST" : null;
  if (!kindName || !handle || !HANDLE.test(handle)) return null;
  if (!hash.startsWith("sha256:") || !HASH.test(hash.slice(7))) return null;
  return { kind: kindName, handle, manifestHash: hash.slice(7), ...(uri ? { uri } : {}) };
}

/**
 * getSignaturesForAddress reports memos as "[len] text", several joined by
 * "; ". Pull out any registry memo text from that field.
 */
function memoCandidates(field: string | null | undefined): string[] {
  if (!field) return [];
  return field
    .split(/;\s*(?=\[\d+\]\s)/)
    .map((part) => part.replace(/^\[\d+\]\s*/, "").trim())
    .filter((part) => part.startsWith(REGISTRY_MEMO_PREFIX));
}

export interface RegistrationEvent extends RegistryMemo {
  id: string;
  signature: string;
  slot: string;
  blockTime: string | null;
  explorerUrl: string;
}

export interface RegistryRecord {
  id: string;
  kind: RegistryKindName;
  handle: string;
  authority: string;
  manifestHash: string;
  uri?: string;
  /** How many times this id has been anchored; the latest anchor wins. */
  version: number;
  signature: string;
  slot: string;
  updatedAt: string | null;
}

export interface RegistryIndexResult {
  configured: boolean;
  authority?: string;
  events: RegistrationEvent[];
  /** Signatures scanned from the authority's history. */
  scanned: number;
  error?: string;
}

interface ParsedMemoTx {
  meta?: { err?: unknown } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<{ pubkey: string; signer: boolean }>;
      instructions?: Array<{ program?: string; parsed?: unknown }>;
    };
  };
}

/** Did the authority sign this transaction, and does it carry exactly this memo? */
async function signedByAuthority(signature: string, memo: string, authority: string, target: FlightpathTarget): Promise<boolean> {
  const tx = (await target.rpc
    .getTransaction(signature as Signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" })
    .send()) as unknown as ParsedMemoTx | null;
  if (!tx || tx.meta?.err) return false;
  const message = tx.transaction?.message;
  const signer = message?.accountKeys?.some((key) => key.pubkey === authority && key.signer) ?? false;
  const carries = message?.instructions?.some((ix) => ix.program === "spl-memo" && ix.parsed === memo) ?? false;
  return signer && carries;
}

const INDEX_TTL_MS = 60_000;
let indexCache: { key: string; at: number; result: RegistryIndexResult } | null = null;

/**
 * Read registrations from the authority's signature history (newest page,
 * up to `limit`). Results are cached briefly per process; a failed read is
 * reported with `error` and never cached.
 */
export async function indexRegistrations(
  target: FlightpathTarget = getFlightpathTarget(),
  options: { limit?: number } = {},
): Promise<RegistryIndexResult> {
  const config = getRegistryConfig(target);
  if (!config.configured || !config.authority) return { configured: false, events: [], scanned: 0 };
  const authority = config.authority;
  const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
  const key = `${target.chain}:${authority}:${limit}`;
  if (indexCache && indexCache.key === key && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.result;

  try {
    const signatures = await target.rpc.getSignaturesForAddress(authority as Address, { limit, commitment: "confirmed" }).send();
    const events: RegistrationEvent[] = [];
    for (const entry of signatures) {
      if (entry.err) continue;
      for (const text of memoCandidates(entry.memo)) {
        const parsed = parseRegistryMemo(text);
        if (!parsed) continue;
        if (!(await signedByAuthority(entry.signature, text, authority, target))) continue;
        events.push({
          ...parsed,
          id: registryId(parsed.kind, parsed.handle),
          signature: entry.signature,
          slot: entry.slot.toString(),
          blockTime: entry.blockTime !== null ? new Date(Number(entry.blockTime) * 1000).toISOString() : null,
          explorerUrl: explorerTxUrl(entry.signature, target),
        });
      }
    }
    const result: RegistryIndexResult = { configured: true, authority, events, scanned: signatures.length };
    indexCache = { key, at: Date.now(), result };
    return result;
  } catch (error) {
    return {
      configured: true,
      authority,
      events: [],
      scanned: 0,
      error: error instanceof Error ? error.message.slice(0, 200) : "registry read failed",
    };
  }
}

/** The latest anchor for an id. Null when unconfigured, unreadable, or never anchored. */
export async function readRegistryRecord(
  kind: RegistryKindName,
  handle: string,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<RegistryRecord | null> {
  const index = await indexRegistrations(target);
  if (!index.configured || !index.authority) return null;
  const id = registryId(kind, handle);
  // Signature history is newest first.
  const anchors = index.events.filter((event) => event.id === id);
  const latest = anchors[0];
  if (!latest) return null;
  return {
    id,
    kind,
    handle,
    authority: index.authority,
    manifestHash: latest.manifestHash,
    uri: latest.uri,
    version: anchors.length,
    signature: latest.signature,
    slot: latest.slot,
    updatedAt: latest.blockTime,
  };
}

export async function isRegistered(
  kind: RegistryKindName,
  handle: string,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<boolean> {
  return (await readRegistryRecord(kind, handle, target)) !== null;
}

/**
 * Does the manifest at hand match what was anchored on Solana?
 * This is the check that makes an Aviary listing independently verifiable —
 * anyone can run it without trusting our index.
 */
export async function verifyManifestAgainstRegistry(
  kind: RegistryKindName,
  handle: string,
  manifestJson: string,
  target: FlightpathTarget = getFlightpathTarget(),
): Promise<{ registered: boolean; matches: boolean; expected?: string; actual: string; record?: RegistryRecord }> {
  const actual = await manifestHash(manifestJson);
  const record = await readRegistryRecord(kind, handle, target);
  if (!record) return { registered: false, matches: false, actual };
  return { registered: true, matches: record.manifestHash === actual, expected: record.manifestHash, actual, record };
}
