import { Decimal128 } from "mongodb";
import { getDb } from "./client.ts";
import { COLLECTIONS } from "./schemas.ts";

/**
 * A durable daily-allowance ledger, one counter per (owner, asset, window).
 *
 * The in-memory spend tracker is exact for one process and meaningless on a
 * serverless deploy, where the instance that prepared an intent and the one
 * that hears it was signed are different processes with different memories.
 * "0.05 ETH per day" enforced per process is not enforced. This keeps the
 * counter in MongoDB, keyed by the signer, so the next intent any instance
 * prepares for that wallet sees everything the wallet already spent today.
 *
 * Amounts are wei-scale bigints; Decimal128 holds them exactly and supports
 * atomic $inc. The reservation is a conditional update — it debits only if
 * the counter still fits under the cap — so two concurrent intents cannot
 * both pass a check against the same stale total.
 */

export interface SpendBucketDoc {
  key: string;
  owner: string;
  asset: string;
  bucket: number;
  windowMs: number;
  spent: Decimal128;
  updatedAt: string;
}

export interface MongoSpendTrackerOptions {
  /** The wallet whose allowance this is — the signer for user-signed intents. */
  owner: string;
  now?: () => Date;
}

type Asset = "native" | `0x${string}`;

export function createMongoSpendTracker(options: MongoSpendTrackerOptions) {
  const owner = options.owner.toLowerCase();
  const now = options.now ?? (() => new Date());

  const collection = async () => (await getDb()).collection<SpendBucketDoc>(COLLECTIONS.spendBuckets);
  const keyFor = (asset: Asset, windowMs: number, at: Date) => {
    const bucket = Math.floor(at.getTime() / windowMs);
    return { key: `${owner}:${asset.toLowerCase()}:${windowMs}:${bucket}`, bucket };
  };
  const dec = (value: bigint) => Decimal128.fromString(value.toString());
  const big = (value: Decimal128 | undefined) => (value ? BigInt(value.toString().split(".")[0] ?? "0") : 0n);

  async function spentInWindow(asset: Asset, windowMs: number): Promise<bigint> {
    const { key } = keyFor(asset, windowMs, now());
    const doc = await (await collection()).findOne({ key });
    return big(doc?.spent);
  }

  async function recordSpend(asset: Asset, amount: bigint, at?: Date): Promise<void> {
    if (amount <= 0n) return;
    const when = at ?? now();
    // A record without a window context lands in the day bucket; evaluate()
    // reads the same window for the daily allowance.
    const windowMs = 24 * 60 * 60 * 1000;
    const { key, bucket } = keyFor(asset, windowMs, when);
    await (await collection()).updateOne(
      { key },
      { $inc: { spent: dec(amount) }, $set: { updatedAt: when.toISOString() }, $setOnInsert: { key, owner, asset: asset.toLowerCase(), bucket, windowMs } },
      { upsert: true },
    );
  }

  async function reserveSpend(asset: Asset, amount: bigint, windowMs: number, cap: bigint): Promise<boolean> {
    if (amount <= 0n) return true;
    if (amount > cap) return false;
    const when = now();
    const { key, bucket } = keyFor(asset, windowMs, when);
    const col = await collection();
    const update = {
      $inc: { spent: dec(amount) },
      $set: { updatedAt: when.toISOString() },
      $setOnInsert: { key, owner, asset: asset.toLowerCase(), bucket, windowMs },
    };
    // Debit only while it still fits. The filter cannot be evaluated against a
    // bucket that does not exist yet, so the first debit of a window upserts;
    // a concurrent first debit loses the unique-key race and retries as a
    // plain conditional update against the row the winner created.
    try {
      const result = await col.updateOne({ key, spent: { $lte: dec(cap - amount) } }, update, { upsert: true });
      return result.matchedCount > 0 || Boolean(result.upsertedId);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const retry = await col.updateOne({ key, spent: { $lte: dec(cap - amount) } }, update);
      return retry.matchedCount > 0;
    }
  }

  return { spentInWindow, recordSpend, reserveSpend };
}
