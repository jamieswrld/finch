// Read-only checks against the deployed site. No wallet, no writes: the key
// endpoint is exercised with a signature that cannot verify, the nest run is
// a read-only preset, and the explorer is asked what it already knows.
const BASE = process.env.FINCH_BASE ?? "https://finch1.vercel.app";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const j = async (path, init) => {
  const r = await fetch(BASE + path, init);
  let body;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  return { status: r.status, body };
};

const gate = await j("/api/publish/status");
console.log(`publish/status -> ${gate.status} state=${gate.body.state} mechanism=${gate.body.mechanism}`);

const bogus = await j("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "0x55bb1a9F0252d37121F1344e3693B59dD1Ce0389", nonce: "not-a-real-nonce", signature: "0x" + "ab".repeat(65) }) });
console.log(`keys (unverifiable signature) -> ${bogus.status} ${bogus.body.error ?? ""}`);

const activity = await j("/api/activity");
console.log(`activity -> ${activity.status} ${JSON.stringify(activity.body.counts ?? activity.body).slice(0, 120)} provenance=${activity.body.runsProvenance ?? activity.body.provenance?.runs ?? "?"}`);

const run = await fetch(BASE + "/api/nests/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nest: "chain-intelligence", objective: "one-line chain pulse", signer: "0x55bb1a9F0252d37121F1344e3693B59dD1Ce0389" }) });
console.log(`nests/run -> ${run.status} ${run.headers.get("content-type")}`);
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

for (const [name, address] of [["FinchRegistry", "0x4211e21c416D8f66F038Add24B02d1eB03D5Fb6C"], ["OperatorBudget", "0xF61A7b0A2FC716b46f1b076DF88c7c6e8A1301F3"], ["FeeVault", "0x20f51A3eC950F7488dd88941971CA8F7EfA3D165"], ["FeeSplitter", "0x5819ee3e11bC7c8A0ddef3d961dCd05dbFc9dB34"]]) {
  const r = await fetch(`https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${address}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const d = r.ok ? await r.json() : {};
  console.log(`blockscout ${name.padEnd(15)} verified=${Boolean(d.is_verified)} name=${d.name ?? "-"} compiler=${d.compiler_version ?? "-"}`);
}
