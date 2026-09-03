import { MongoClient, type Db } from "mongodb";

/**
 * MongoDB access — server-side only.
 *
 * Authorization model:
 *  · MONGODB_URI must be a least-privilege user scoped to the finch database
 *    (readWrite on `finch`, nothing cluster-wide).
 *  · The URI never reaches a client bundle: this module throws if imported in
 *    a browser context, and Next marks `mongodb` server-external.
 *  · Public HTTP surfaces go through API routes that whitelist projections —
 *    raw collections are never proxied to the client.
 */

export class DbNotConfiguredError extends Error {
  constructor() {
    super("MONGODB_URI is not set — the data layer is not configured in this environment");
    this.name = "DbNotConfiguredError";
  }
}

let clientPromise: Promise<MongoClient> | null = null;

export function isDbConfigured(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.MONGODB_URI);
}

export async function getMongoClient(): Promise<MongoClient> {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error("@finch/db is server-side only — never import it into browser code");
  }
  if (!isDbConfigured()) throw new DbNotConfiguredError();
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI as string, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 4000,
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB ?? "finch");
}

export async function closeDb(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
  }
}
