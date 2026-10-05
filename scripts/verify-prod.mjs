// Read-only checks against the deployed site. No wallet, no writes: the key
// endpoint is exercised with a signature that cannot verify, the swarm run is
// a read-only preset with a throwaway signer address, and the chain and
// registry endpoints are asked what they already know.
//
// Usage: node scripts/verify-prod.mjs   (FINCH_BASE overrides the default)
import { generateKeyPair, getAddressFromPublicKey, getBase58Decoder } from "@solana/kit";

// No swarm ships built in; this one-task swarm runs a playground agent by reference.
const HEALTH_SWARM = {
  schema: "nest.manifest/0.1",
  identity: { id: "health-check", name: "Health check", objective: "one-line chain pulse", description: "" },
  coordinator: { model: { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct" }, instructions: "Report the result in one line.", synthesize: false },
  finches: [{ handle: "chain-pulse", ref: "registry" }],
  tasks: [{ id: "t1", finch: "chain-pulse", title: "Chain pulse", instruction: "Report current Solana network status in one line.", dependsOn: [], outputChannel: "chain.pulse" }],
  executionPolicy: { mode: "preview", maxParallel: 1, maxTotalTokens: 20000, maxTaskFailures: 1, taskTimeoutMs: 90000 },
};

const BASE = (process.env.FINCH_BASE ?? "https://finch1.vercel.app").replace(/\/$/, "");
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  let body;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  return { status: r.status, body };
};

// An address nobody holds funds in: generated here, never funded, never used again.
const address = await getAddressFromPublicKey((await generateKeyPair()).publicKey);

const chain = await j("/api/chain");
const c = chain.body ?? {};
console.log(`chain -> ${chain.status} ${c.chain ?? "?"} (${c.cluster ?? "?"}) reachable=${c.reachable} genesisMatches=${c.genesisMatches} slot=${c.slot ?? "null"} tps=${c.tps ?? "null"} fee/sig=${c.feePerSignatureLamports ?? "null"} lamports latency=${c.latencyMs ?? "null"}ms`);
if (c.chain !== "solana:mainnet") console.log(`  !! expected chain "solana:mainnet", got ${JSON.stringify(c.chain)}`);
for (const endpoint of c.endpoints ?? []) console.log(`  endpoint ${endpoint.url} reachable=${endpoint.reachable} slot=${endpoint.slot ?? "-"} ${endpoint.error ?? ""}`);

const registry = await j("/api/registry");
console.log(`registry -> ${registry.status} configured=${registry.body.configured} authority=${registry.body.authority ?? "null"} anchored=${registry.body.registeredCount ?? "?"}/${(registry.body.registrations ?? []).length}`);

const gate = await j("/api/publish/status");
console.log(`publish/status -> ${gate.status} state=${gate.body.state} mechanism=${gate.body.mechanism}`);

const zeros = getBase58Decoder().decode(new Uint8Array(64));
const bogus = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, nonce: "not-a-real-nonce", signature: zeros }) });
console.log(`keys (unverifiable signature) -> ${bogus.status} ${bogus.body.error ?? ""}`);

const activity = await j("/api/activity");
console.log(`activity -> ${activity.status} ${JSON.stringify(activity.body.counts ?? activity.body).slice(0, 120)} provenance=${activity.body.runsProvenance ?? activity.body.provenance?.runs ?? "?"}`);

const run = await fetch(BASE + "/api/swarms/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: HEALTH_SWARM, objective: "one-line chain pulse", signer: address }) });
console.log(`swarms/run -> ${run.status} ${run.headers.get("content-type")}`);
if (run.ok && run.body) {
  const reader = run.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", found = null, started = Date.now();
  while (!found && Date.now() - started < 60_000) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const m = buf.match(/"type":"run\.config"[^\n]*/);
    if (m) found = m[0];
  }
  await reader.cancel().catch(() => {});
  const signing = found?.match(/"signing":(\{[^}]*\})/)?.[1];
  const types = [...buf.matchAll(/"type":"([a-z.]+)"/g)].map((m) => m[1]);
  console.log(`  run.config after ${((Date.now() - started) / 1000).toFixed(1)}s -> signing=${signing ?? "(not seen)"}; events seen: ${[...new Set(types)].join(", ") || "none"}`);
}
