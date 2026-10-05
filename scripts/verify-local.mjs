// Exercise the open-and-free publishing path and the signer plumbing against
// a locally running production build. Signs the publisher-key message with a
// throwaway Solana keypair generated in this process — a message, not a
// transaction; nothing is funded and nothing moves. The private key is
// non-extractable and dies with the process. Each run issues a key to a new
// address, so a local database collects one test key per run.
//
// Usage: node --experimental-strip-types scripts/verify-local.mjs
//        (FINCH_BASE overrides http://127.0.0.1:3100)
import { generateKeyPair, getAddressFromPublicKey, getBase58Decoder, signBytes } from "@solana/kit";
import { keyMessage } from "../apps/web/src/lib/key-message.ts";

// No swarm ships built in; this one-task swarm runs a playground agent by reference.
const HEALTH_SWARM = {
  schema: "nest.manifest/0.1",
  identity: { id: "health-check", name: "Health check", objective: "one-line chain pulse", description: "" },
  coordinator: { model: { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct" }, instructions: "Report the result in one line.", synthesize: false },
  finches: [{ handle: "chain-pulse", ref: "registry" }],
  tasks: [{ id: "t1", finch: "chain-pulse", title: "Chain pulse", instruction: "Report current Solana network status in one line.", dependsOn: [], outputChannel: "chain.pulse" }],
  executionPolicy: { mode: "preview", maxParallel: 1, maxTotalTokens: 20000, maxTaskFailures: 1, taskTimeoutMs: 90000 },
};

const BASE = process.env.FINCH_BASE ?? "http://127.0.0.1:3100";
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, body };
};

const keys = await generateKeyPair();
const address = await getAddressFromPublicKey(keys.publicKey);
console.log("throwaway signer", address);

const status = await j("/api/publish/status");
console.log("publish/status ->", status.status, JSON.stringify({ state: status.body.state, mechanism: status.body.mechanism, reason: status.body.reason?.slice(0, 60) }));

const nonce = "n" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
const signed = await signBytes(keys.privateKey, new TextEncoder().encode(keyMessage(address, nonce)));
const signature = getBase58Decoder().decode(signed);

const bad = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, nonce: nonce + "x", signature }) });
console.log("keys (wrong nonce) ->", bad.status, bad.body.error ?? "");
const issued = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, nonce, signature }) });
console.log("keys (signed) ->", issued.status, issued.body.key ? `key issued for ${issued.body.owner} scopes=${issued.body.scopes.join(",")}` : JSON.stringify(issued.body));
const key = issued.body.key;
if (!key) process.exit(1);
if (issued.body.owner !== address) console.log(`!! owner ${issued.body.owner} is not the exact signing address — base58 is case-sensitive`);

const slug = "gate-check-" + Date.now().toString(36);
const listing = (overrides) => ({
  slug, name: "Gate check", category: "tools",
  description: "Temporary listing created by scripts/verify-local.mjs to prove the free publish path; remove it after the run.",
  creator: { name: address, address }, publisher: address,
  pricing: { model: "free" }, chains: ["solana"], toolNames: [], version: "0.1.0",
  ...overrides,
});
const pub = await j("/api/directory", { method: "POST", headers: { "content-type": "application/json", "x-finch-key": key }, body: JSON.stringify(listing({})) });
console.log("directory publish (free gate) ->", pub.status, JSON.stringify(pub.body).slice(0, 140));
const anon = await j("/api/directory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(listing({ slug: slug + "-anon", name: "x", description: "x" })) });
console.log("directory publish (no key) ->", anon.status, anon.body.error ?? "");

// swarm run with a signer on a read-only swarm: signing must report "none"
const run = await fetch(BASE + "/api/swarms/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest: HEALTH_SWARM, objective: "one-line chain pulse", signer: address }) });
const reader = run.body.getReader();
const decoder = new TextDecoder();
let buf = "", config = null, started = Date.now();
while (!config && Date.now() - started < 20_000) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const m = buf.match(/"type":"run\.config".*?\n/);
  if (m) config = m[0];
}
await reader.cancel().catch(() => {});
const sig = config?.match(/"signing":(\{[^}]*\})/)?.[1] ?? "(no run.config seen)";
console.log("swarms/run (preview swarm + signer) -> signing", sig);
console.log("TEST_SLUG=" + slug);
