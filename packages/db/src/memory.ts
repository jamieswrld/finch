import { getCollections } from "./collections.ts";
import { MEMORY_VECTOR_INDEX_NAME } from "./indexes.ts";
import { memoryItemDocSchema } from "./schemas.ts";

/**
 * MongoDB-backed agent memory. Structurally implements the MemoryAdapter
 * interface from @finch/sdk (append/recall) without a package dependency.
 *
 * Recall strategy:
 *  · with an embed function + Atlas Vector Search index → semantic recall
 *  · otherwise → recency recall (still correct, just less relevant)
 */

export interface MongoMemoryOptions {
  namespace: string;
  /** Provider embed hook, e.g. (texts) => provider.embed({ input: texts }). */
  embed?: (texts: string[]) => Promise<number[][]>;
  retentionDays?: number;
}

export function createMongoMemory(options: MongoMemoryOptions) {
  const { namespace, embed } = options;

  return {
    async append(item: { role: "user" | "assistant" | "observation"; content: string }): Promise<void> {
      const { memoryItems } = await getCollections();
      let embedding: number[] | undefined;
      if (embed) {
        try {
          const vectors = await embed([item.content]);
          embedding = vectors[0];
        } catch {
          // Embedding failure must not lose the memory — store without vector.
          embedding = undefined;
        }
      }
      const doc = memoryItemDocSchema.parse({
        namespace,
        role: item.role,
        content: item.content,
        embedding,
        at: new Date().toISOString(),
      });
      await memoryItems.insertOne(doc);
    },

    async recall(query: string, limit = 12): Promise<Array<{ role: "user" | "assistant" | "observation"; content: string; at: string; score?: number }>> {
      const { memoryItems } = await getCollections();
      if (embed) {
        try {
          const [vector] = await embed([query]);
          if (vector) {
            const results = await memoryItems
              .aggregate([
                {
                  $vectorSearch: {
                    index: MEMORY_VECTOR_INDEX_NAME,
                    path: "embedding",
                    queryVector: vector,
                    numCandidates: Math.max(limit * 10, 100),
                    limit,
                    filter: { namespace },
                  },
                },
                { $project: { _id: 0, role: 1, content: 1, at: 1, score: { $meta: "vectorSearchScore" } } },
              ])
              .toArray();
            if (results.length > 0) {
              return results as Array<{ role: "user" | "assistant" | "observation"; content: string; at: string; score?: number }>;
            }
          }
        } catch {
          // Vector index missing or search unavailable — fall through to recency.
        }
      }
      const recent = await memoryItems
        .find({ namespace }, { projection: { _id: 0, role: 1, content: 1, at: 1 } })
        .sort({ at: -1 })
        .limit(limit)
        .toArray();
      return recent.reverse() as Array<{ role: "user" | "assistant" | "observation"; content: string; at: string }>;
    },
  };
}
