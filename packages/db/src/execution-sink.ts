import { getCollections } from "./collections.ts";
import { executionDocSchema, type ExecutionDoc } from "./schemas.ts";

type ExecutionState = ExecutionDoc["state"];

/**
 * MongoDB ExecutionSink — structurally implements the ExecutionSink interface
 * from @finch/flightpath. Every agent action lands here as an auditable,
 * idempotent record (unique index on `id`).
 */
export function createMongoExecutionSink() {
  return {
    /**
     * Upsert by field set, not by replacement.
     *
     * replaceOne would delete any field absent from `doc` — so a caller that
     * read the record before it was approved, then saved it, would erase the
     * approval stamp and permanently re-park the execution. $set only touches
     * what the caller actually has.
     */
    async save(record: Record<string, unknown>): Promise<void> {
      const doc = executionDocSchema.parse(record) as ExecutionDoc;
      const { executions } = await getCollections();
      await executions.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
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

    /**
     * Compare-and-set on the approval stamp. The state transition happens in
     * the same update: leaving the record in "awaiting_approval" while the
     * caller goes off to simulate would let a concurrent replay satisfy the
     * gate and broadcast a second transaction.
     */
    async claimApproval(id: string, approval: { approvedBy: string; at: string }): Promise<boolean> {
      const { executions } = await getCollections();
      const result = await executions.updateOne(
        { id, state: "awaiting_approval", approval: { $exists: false } },
        { $set: { approval, state: "approved" } },
      );
      return result.modifiedCount === 1;
    },

    /**
     * Record a broadcast hash with a targeted update — no whole-document
     * parse. This runs the instant a signed transaction is on chain; if any
     * unrelated field on the stored document fails validation here, the hash
     * is lost while the money has moved. A $set of exactly the fields that
     * changed cannot be blocked by a field that did not.
     */
    async setTx(id: string, tx: { hash: string; submittedAt: string }, entry: { at: string; event: string; detail?: string }): Promise<void> {
      const { executions } = await getCollections();
      await executions.updateOne({ id }, { $set: { tx }, $push: { log: entry } });
    },

    /** Settle a submitted record from its receipt, targeted for the same reason. */
    async settle(
      id: string,
      state: "confirmed" | "reverted",
      receipt: Record<string, unknown>,
      entry: { at: string; event: string; detail?: string },
    ): Promise<boolean> {
      const { executions } = await getCollections();
      const result = await executions.updateOne({ id, state: "submitted" }, { $set: { state, receipt }, $push: { log: entry } });
      return result.modifiedCount === 1;
    },

    /**
     * Compare-and-set on state. One conditional update is the whole guarantee:
     * whichever caller matches `from` wins, everyone else sees modifiedCount 0.
     */
    async claimState(id: string, from: ExecutionState, to: ExecutionState): Promise<boolean> {
      const { executions } = await getCollections();
      const result = await executions.updateOne({ id, state: from }, { $set: { state: to } });
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
