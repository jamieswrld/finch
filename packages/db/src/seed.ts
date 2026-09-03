import { closeDb, getDb, isDbConfigured } from "./client.ts";
import { collectionsOf } from "./collections.ts";
import { ensureIndexes } from "./indexes.ts";
import { seedAviaryListings, seedNests, seedFinches, seedTreasuryLedger } from "./seeds.ts";

/**
 * Idempotent seeding: upserts by natural key, never duplicates, never
 * overwrites rows whose source is not "seed".
 * Run with: npm run seed -w @finch/db (requires MONGODB_URI).
 */
async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("MONGODB_URI is not set — nothing to do.");
    process.exitCode = 1;
    return;
  }
  const db = await getDb();
  await ensureIndexes(db);
  const collections = collectionsOf(db);

  for (const listing of seedAviaryListings) {
    await collections.aviaryListings.updateOne(
      { slug: listing.slug, source: "seed" },
      { $setOnInsert: listing },
      { upsert: true },
    );
  }
  for (const nest of seedNests) {
    await collections.nests.updateOne({ slug: nest.slug }, { $setOnInsert: nest }, { upsert: true });
  }
  for (const finch of seedFinches) {
    await collections.finches.updateOne({ handle: finch.handle }, { $setOnInsert: finch }, { upsert: true });
  }
  const existingSeedLedger = await collections.treasuryLedger.countDocuments({ source: "seed" });
  if (existingSeedLedger === 0) {
    await collections.treasuryLedger.insertMany(seedTreasuryLedger);
  }

  console.log(
    `seeded: ${seedAviaryListings.length} aviary listings, ${seedNests.length} nests, ${seedFinches.length} finches, ${seedTreasuryLedger.length} treasury entries (skipped if present)`,
  );
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
