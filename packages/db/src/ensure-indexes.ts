import { closeDb, getDb, isDbConfigured } from "./client.ts";
import { ensureIndexes } from "./indexes.ts";

/** Run with: npm run indexes -w @finch/db (requires MONGODB_URI). */
async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("MONGODB_URI is not set — nothing to do.");
    process.exitCode = 1;
    return;
  }
  const db = await getDb();
  const created = await ensureIndexes(db);
  console.log(`ensured ${created.length} indexes:`);
  for (const name of created) console.log(`  ${name}`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
