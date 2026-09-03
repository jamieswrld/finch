// Exercise the open-and-free publishing path and the signer plumbing against
// a locally running production build. Signs a plain message with the deploy
// wallet's key from .env.local — a message, not a transaction; nothing moves.
// The key never leaves this process and is never printed.
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.FINCH_BASE ?? "http://127.0.0.1:3100";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, body };
};

const status = await j("/api/publish/status");
console.log("publish/status ->", status.status, JSON.stringify({ state: status.body.state, mechanism: status.body.mechanism, reason: status.body.reason?.slice(0, 60) }));

const nonce = "n" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
const message = `Finch publisher key\nAddress: ${account.address}\nNonce: ${nonce}\n\nSigning this issues a key for publishing to the Finch registry. It is not a transaction.`;
const signature = await account.signMessage({ message });

const bad = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, nonce: nonce + "x", signature }) });
console.log("keys (wrong nonce) ->", bad.status, bad.body.error ?? "");
const issued = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, nonce, signature }) });
console.log("keys (signed) ->", issued.status, issued.body.key ? `key issued for ${issued.body.owner} scopes=${issued.body.scopes.join(",")}` : JSON.stringify(issued.body));
const key = issued.body.key;
if (!key) process.exit(1);

const slug = "gate-check-" + Date.now().toString(36);
const pub = await j("/api/aviary", {
  method: "POST",
  headers: { "content-type": "application/json", "x-finch-key": key },
  body: JSON.stringify({
    slug, name: "Gate check", category: "tools",
    description: "Temporary listing created by scripts/verify-local.mjs to prove the free publish path; removed right after.",
    creator: { name: account.address, address: account.address }, publisher: account.address,
    pricing: { model: "free" }, chains: ["robinhood"], toolNames: [], version: "0.1.0",
  }),
});
console.log("aviary publish (free gate) ->", pub.status, JSON.stringify(pub.body).slice(0, 140));
const anon = await j("/api/aviary", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: slug + "-anon", name: "x", category: "tools", description: "x", creator: { name: "x", address: account.address }, publisher: account.address, pricing: { model: "free" }, chains: ["robinhood"], toolNames: [], version: "0.1.0" }) });
console.log("aviary publish (no key) ->", anon.status, anon.body.error ?? "");

// nest run with a signer on a read-only nest: signing must report "none"
const run = await fetch(BASE + "/api/nests/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nest: "chain-intelligence", objective: "one-line chain pulse", signer: account.address }) });
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
console.log("nests/run (preview nest + signer) -> signing", sig);
console.log("TEST_SLUG=" + slug);
