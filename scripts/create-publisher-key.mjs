#!/usr/bin/env node
/**
 * Mint a publisher key.
 *
 * Runs locally against MONGODB_URI and prints the key exactly once — only its
 * SHA-256 is stored, so a lost key cannot be recovered, only replaced. This is
 * deliberately not an HTTP endpoint: an endpoint that mints credentials is a
 * credential-minting endpoint no matter what you guard it with.
 *
 *   node scripts/create-publisher-key.mjs "owner-name"
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match?.[1] && match[2] && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const owner = process.argv[2];
if (!owner) {
  console.error('usage: node scripts/create-publisher-key.mjs "owner-name"');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set — nothing to write to.");
  process.exit(1);
}

const { MongoClient } = await import("mongodb");
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? "finch");

const key = `finch_${randomBytes(24).toString("base64url")}`;
await db.collection("api_keys").insertOne({
  keyHash: createHash("sha256").update(key).digest("hex"),
  owner,
  scopes: ["publish"],
  createdAt: new Date().toISOString(),
  revoked: false,
});
await client.close();

console.log(`\n  publisher key for "${owner}" — shown once, store it now:\n`);
console.log(`     ${key}\n`);
console.log("  use it as the x-finch-key header when publishing.\n");
