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

/**
 * A connection failure that is safe to show anyone.
 *
 * MongoParseError and several driver errors quote the connection string back
 * in `.message` — including `user:password@host`. API routes surface database
 * errors to unauthenticated callers, so the raw driver message must never be
 * the thing that escapes. The original is kept on `cause` for server logs and
 * is never serialized into a response.
 */
export class DbConnectionError extends Error {
  constructor(cause: unknown) {
    super("database connection failed");
    this.name = "DbConnectionError";
    this.cause = cause;
  }
}

/** Replace any credentialed Mongo URI inside arbitrary text with a safe label. */
export function scrubMongoUri(message: string): string {
  return message.replace(
    /mongodb(\+srv)?:\/\/[^\s"']*/g,
    (match) => {
      try {
        const parsed = new URL(match);
        return `${parsed.protocol}//${parsed.hostname}/…`;
      } catch {
        return "mongodb://…";
      }
    },
  );
}

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
    // Both the constructor (URI parsing) and connect() can throw with the
    // connection string embedded in the message, so both are wrapped.
    try {
      const client = new MongoClient(process.env.MONGODB_URI as string, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 4000,
        // A field set to undefined in memory was being written as null, and
        // z.string().optional() rejects null on the way back in. The first
        // save of a record passed; the save that recorded a real transaction
        // hash threw. Undefined means "absent" and must be stored as absent.
        ignoreUndefined: true,
      });
      clientPromise = client.connect().catch((error) => {
        clientPromise = null;
        throw new DbConnectionError(error);
      });
    } catch (error) {
      clientPromise = null;
      throw new DbConnectionError(error);
    }
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
