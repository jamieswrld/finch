import type { Db } from "mongodb";
import { COLLECTIONS } from "./schemas.ts";

/**
 * Index definitions. Uniqueness indexes double as idempotency guarantees:
 * executions on `id`, credit entries on `idempotencyKey`, fee events on
 * `(txHash, logIndex)` — replays become no-op duplicate-key errors.
 */
export async function ensureIndexes(db: Db): Promise<string[]> {
  const created: string[] = [];
  const add = async (collection: string, spec: Record<string, 1 | -1>, options?: { unique?: boolean; name?: string }) => {
    const name = await db.collection(collection).createIndex(spec, options ?? {});
    created.push(`${collection}.${name}`);
  };

  await add(COLLECTIONS.finches, { handle: 1 }, { unique: true });
  await add(COLLECTIONS.finches, { owner: 1, updatedAt: -1 });

  await add(COLLECTIONS.nests, { slug: 1 }, { unique: true });
  await add(COLLECTIONS.nests, { owner: 1, updatedAt: -1 });

  await add(COLLECTIONS.aviaryListings, { slug: 1 }, { unique: true });
  await add(COLLECTIONS.aviaryListings, { category: 1, "stats.calls30d": -1 });
  await add(COLLECTIONS.aviaryListings, { verified: 1 });

  await add(COLLECTIONS.executions, { id: 1 }, { unique: true });
  await add(COLLECTIONS.executions, { agentId: 1, createdAt: -1 });
  await add(COLLECTIONS.executions, { state: 1, createdAt: -1 });

  await add(COLLECTIONS.memoryItems, { namespace: 1, at: -1 });
  await add(COLLECTIONS.memoryItems, { namespace: 1, subject: 1, at: -1 });

  await add(COLLECTIONS.feeEvents, { txHash: 1, logIndex: 1 }, { unique: true });
  await add(COLLECTIONS.feeEvents, { blockNumber: -1 });

  await add(COLLECTIONS.treasuryLedger, { at: -1 });
  await add(COLLECTIONS.treasuryLedger, { category: 1, at: -1 });

  await add(COLLECTIONS.creditEntries, { idempotencyKey: 1 }, { unique: true });
  await add(COLLECTIONS.creditEntries, { debit: 1, at: -1 });

  await add(COLLECTIONS.spendBuckets, { key: 1 }, { unique: true });
  await add(COLLECTIONS.spendBuckets, { owner: 1, updatedAt: -1 });
  await add(COLLECTIONS.creditEntries, { credit: 1, at: -1 });

  await add(COLLECTIONS.serviceCalls, { idempotencyKey: 1 }, { unique: true });
  await add(COLLECTIONS.serviceCalls, { listingSlug: 1, at: -1 });

  await add(COLLECTIONS.runs, { runId: 1 }, { unique: true });
  await add(COLLECTIONS.runs, { finishedAt: -1 });
  await add(COLLECTIONS.runs, { kind: 1, subject: 1, finishedAt: -1 });

  await add(COLLECTIONS.apiKeys, { keyHash: 1 }, { unique: true });
  await add(COLLECTIONS.apiKeys, { owner: 1 });

  return created;
}

/**
 * Atlas Vector Search index for memory_items.embedding — created via the
 * Atlas UI/CLI (not createIndex). Definition, for `memory_items`:
 *
 * {
 *   "name": "memory_vector",
 *   "type": "vectorSearch",
 *   "fields": [
 *     { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
 *     { "type": "filter", "path": "namespace" }
 *   ]
 * }
 *
 * numDimensions must match the embedding model configured for the nest.
 */
export const MEMORY_VECTOR_INDEX_NAME = "memory_vector";
