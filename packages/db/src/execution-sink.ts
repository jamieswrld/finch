import { getCollections } from "./collections.ts";
import { executionDocSchema, type ExecutionDoc } from "./schemas.ts";

/**
 * MongoDB ExecutionSink — structurally implements the ExecutionSink interface
 * from @finch/flightpath. Every agent action lands here as an auditable,
 * idempotent record (unique index on `id`).
 */
export function createMongoExecutionSink() {
  return {
    async save(record: Record<string, unknown>): Promise<void> {
      const doc = executionDocSchema.parse(record) as ExecutionDoc;
      const { executions } = await getCollections();
      await executions.replaceOne({ id: doc.id }, doc, { upsert: true });
    },

    async get(id: string): Promise<ExecutionDoc | null> {
      const { executions } = await getCollections();
      return executions.findOne({ id }, { projection: { _id: 0 } });
    },

    /**
     * Atomic claim on the id. The unique index on `executions.id` is what makes
     * this a real compare-and-set: a duplicate key error means someone else
     * won the race.
     */
    async reserve(record: Record<string, unknown>): Promise<boolean> {
      const doc = executionDocSchema.parse(record) as ExecutionDoc;
      const { executions } = await getCollections();
      try {
        await executions.insertOne(doc);
        return true;
      } catch (error) {
        if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
          return false;
        }
        throw error;
      }
    },

    /** Compare-and-set on the approval stamp: only an unapproved parked record transitions. */
    async claimApproval(id: string, approval: { approvedBy: string; at: string }): Promise<boolean> {
      const { executions } = await getCollections();
      const result = await executions.updateOne(
        { id, state: "awaiting_approval", approval: { $exists: false } },
        { $set: { approval } },
      );
      return result.modifiedCount === 1;
    },
  };
}

export async function listExecutions(params: { agentId?: string; limit?: number }): Promise<ExecutionDoc[]> {
  const { executions } = await getCollections();
  const filter = params.agentId ? { agentId: params.agentId } : {};
  return executions
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(params.limit ?? 50, 200))
    .toArray();
}
