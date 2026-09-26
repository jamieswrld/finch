// What real visitors got: the recorded runs and executions, most recent first,
// with outcome, halt reason, error text and duration. Reads the database the
// site writes to; prints no secrets. Usage: node scripts/runs-report.mjs [hours]
import { readFileSync } from "node:fs";
import { MongoClient } from "mongodb";

const hours = Number(process.argv[2] ?? 24);
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const client = new MongoClient(env.MONGODB_URI, { ignoreUndefined: true });
await client.connect();
const db = client.db(env.MONGODB_DB);
const since = new Date(Date.now() - hours * 3600_000).toISOString();

const runs = await db.collection("runs").find({}).sort({ startedAt: -1 }).limit(120).toArray();
const recent = runs.filter((r) => (r.startedAt ?? r.createdAt ?? "") >= since);
console.log(`runs: ${runs.length} most recent read; ${recent.length} in the last ${hours}h`);
const by = {};
for (const r of recent) {
  const key = `${r.source ?? "?"}/${r.kind ?? r.type ?? "?"}:${r.status ?? r.state ?? "?"}${r.haltedBy ? "/" + r.haltedBy : ""}`;
  by[key] = (by[key] ?? 0) + 1;
}
console.log("outcomes:", JSON.stringify(by));
const dur = (r) => (r.startedAt && r.finishedAt ? ((new Date(r.finishedAt) - new Date(r.startedAt)) / 1000).toFixed(0) + "s" : r.durationMs ? (r.durationMs / 1000).toFixed(0) + "s" : "?");
console.log("\nlast 30 runs:");
for (const r of recent.slice(0, 30)) {
  const tasks = Array.isArray(r.tasks) ? r.tasks.map((t) => `${t.finch ?? t.id}:${t.status}${t.error ? "!" : ""}`).join(",") : "";
  const err = r.error ?? (Array.isArray(r.tasks) ? r.tasks.find((t) => t.error)?.error : null);
  console.log(`  ${(r.startedAt ?? "").slice(5, 19)} ${String(r.source ?? "?").padEnd(7)} ${String(r.nest ?? r.preset ?? r.finch ?? r.id ?? "").slice(0, 22).padEnd(22)} ${String(r.status ?? r.state ?? "?").padEnd(10)} ${dur(r).padStart(5)} ${r.haltedBy ?? ""} ${tasks.slice(0, 70)}${err ? "\n      !! " + String(err).slice(0, 200) : ""}`);
}
const sample = recent[0];
if (sample) console.log("\nrun doc keys:", Object.keys(sample).join(", "));

const execs = await db.collection("executions").find({}).sort({ createdAt: -1 }).limit(10).toArray();
console.log(`\nlast executions (${execs.length}):`);
for (const e of execs) console.log(`  ${(e.createdAt ?? "").slice(5, 19)} ${String(e.state).padEnd(18)} ${e.agentId ?? ""} ${e.intent?.summary?.slice(0, 60) ?? ""} ${e.tx?.signature ? "tx " + e.tx.signature.slice(0, 12) + "…" : ""}${e.receipt?.slot ? ` ${e.receipt.status} slot ${e.receipt.slot}` : ""} ${e.chain ?? "(no chain recorded)"} ${e.error ? "!! " + (e.error.stage ? `${e.error.stage}: ${e.error.message}` : String(e.error)).slice(0, 100) : ""}`);
await client.close();
