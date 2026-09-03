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

// ── The hive ──────────────────────────────────────────────────────────────

export const HIVE_NAMESPACE = "hive";

export interface HiveItem {
  role: "user" | "assistant" | "observation";
  content: string;
  at: string;
  subject?: string;
  runId?: string;
  nestId?: string;
  finch?: string;
  channel?: string;
  source?: "run" | "user";
}

/**
 * Shared memory, keyed by subject.
 *
 * Every completed builtin nest writes its channel outputs here; every finch
 * working on the same subject reads them first. Recall is by subject and
 * recency — exact, cheap, and honest about what it is. Semantic recall is a
 * later upgrade that needs an embedding provider and the Atlas vector index,
 * neither of which exists in this deployment yet; nothing here pretends it
 * does.
 */
export function createHiveMemory(options: { subject: string; namespace?: string }) {
  const namespace = options.namespace ?? HIVE_NAMESPACE;
  const subject = options.subject.toLowerCase();

  return {
    async append(item: Omit<HiveItem, "at">): Promise<void> {
      // The hive holds OBSERVATIONS WITH PROVENANCE, nothing else. The finch
      // runtime appends every turn's user input to whichever adapter it was
      // given — conversational memory for that finch, not knowledge for the
      // network. Letting that through wrote instruction text into shared
      // memory, where the next finch would have recalled it as a "prior
      // finding". A row that cannot say which run produced it is not written.
      if (item.role !== "observation" || !item.runId) return;
      const { memoryItems } = await getCollections();
      const doc = memoryItemDocSchema.parse({ ...item, namespace, subject, at: new Date().toISOString() });
      await memoryItems.insertOne(doc);
    },

    async recall(_query: string, limit = 12): Promise<HiveItem[]> {
      const { memoryItems } = await getCollections();
      const rows = await memoryItems
        // Belt and braces with the append guard: only provenanced observations
        // are ever handed to a model as prior findings.
        .find({ namespace, subject, role: "observation", runId: { $exists: true } }, { projection: { _id: 0, embedding: 0 } })
        .sort({ at: -1 })
        .limit(Math.min(Math.max(limit, 1), 100))
        .toArray();
      return rows.map((row) => ({
        role: row.role,
        content: row.content,
        at: row.at,
        subject: row.subject,
        runId: row.runId,
        nestId: row.nestId,
        finch: row.finch,
        channel: row.channel,
        source: row.source,
      }));
    },
  };
}

/**
 * Write a completed run's channel outputs into the hive, one observation per
 * task that produced its channel. The synthesis is deliberately NOT written:
 * it is the coordinator's prose over the channels, one step further from the
 * tool results than the channels themselves.
 */
export async function appendHiveFindings(input: {
  runId: string;
  nestId: string;
  subject: string;
  tasks: Array<{ finch: string; outputChannel: string; status: string }>;
  channels: Record<string, string>;
}): Promise<number> {
  const hive = createHiveMemory({ subject: input.subject });
  let written = 0;
  for (const task of input.tasks) {
    if (task.status !== "completed") continue;
    const content = (input.channels[task.outputChannel] ?? "").trim();
    if (!content) continue;
    await hive.append({
      role: "observation",
      content: content.slice(0, 4_000),
      runId: input.runId,
      nestId: input.nestId,
      finch: task.finch,
      channel: task.outputChannel,
      source: "run",
    });
    written += 1;
  }
  return written;
}
