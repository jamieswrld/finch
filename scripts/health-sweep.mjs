// What a visitor actually experiences on the deployed site, checked from the
// outside: every page, every read API, one real read-only finch run, one real
// nest run to completion. Reports status, timing and the first error text.
// Usage: FINCH_BASE=https://finch1.vercel.app node scripts/health-sweep.mjs
const BASE = (process.env.FINCH_BASE ?? "https://finch1.vercel.app").replace(/\/$/, "");
const t0 = Date.now();
const ms = (from) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

async function page(path) {
  const started = Date.now();
  try {
    const r = await fetch(BASE + path, { redirect: "manual", headers: { Accept: "text/html" } });
    const html = await r.text();
    const bad = /Application error|Internal Server Error|__NEXT_ERROR|Unhandled Runtime Error/i.test(html);
    const loc = r.headers.get("location");
    console.log(`page ${path.padEnd(18)} ${r.status}${loc ? ` → ${loc}` : ""} ${ms(started)} ${bad ? "!! ERROR TEXT IN HTML" : ""} ${html.length < 2000 && r.status === 200 ? "!! tiny body" : ""}`);
  } catch (e) { console.log(`page ${path.padEnd(18)} FAILED ${e.message}`); }
}
async function api(path, pick) {
  const started = Date.now();
  try {
    const r = await fetch(BASE + path, { headers: { Accept: "application/json" } });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = null; }
    const summary = body ? (pick ? pick(body) : JSON.stringify(body).slice(0, 110)) : `non-JSON: ${text.slice(0, 80)}`;
    console.log(`api  ${path.padEnd(22)} ${r.status} ${ms(started)} ${summary}`);
    return body;
  } catch (e) { console.log(`api  ${path.padEnd(22)} FAILED ${e.message}`); return null; }
}

console.log(`base ${BASE}`);
for (const p of ["/", "/app", "/app/school", "/app/nests", "/app/aviary", "/app/network", "/docs", "/how-it-works", "/research"]) await page(p);

const status = await api("/api/status", (b) => `providers=${(b.compute?.available ?? []).map((p) => `${p.id}:${p.probe?.status ?? "?"}`).join(",")} invalidKeys=${JSON.stringify(b.compute?.invalidKeys ?? null)} chain=${b.chain?.chain ?? "?"} reachable=${b.chain?.reachable ?? "?"} slot=${b.chain?.slot ?? "null"} token=${b.token?.configured ?? "?"} registry=${b.registry?.configured ?? "?"} db=${b.db?.configured ?? "?"}`);
if (status) console.log(`     status keys: ${Object.keys(status).join(", ")}`);
await api("/api/chain", (b) => `${b.chain ?? "?"} reachable=${b.reachable} genesisMatches=${b.genesisMatches} slot=${b.slot ?? "null"} tps=${b.tps ?? "null"} endpoints=${(b.endpoints ?? []).map((e) => `${e.url}:${e.reachable ? "up" : "down"}`).join(",")}`);
await api("/api/token", (b) => `mint=${b.mint ?? "null"} launched=${b.launched} phase=${b.launchpad?.phase ?? "-"} price=${b.price?.data?.usdPrice ?? "unread"} holders=${b.holders?.count ?? "unread"}${b.note ? ` note=${String(b.note).slice(0, 60)}` : ""}`);
await api("/api/activity", (b) => `counts=${JSON.stringify(b.counts)} runs=${b.runsProvenance ?? "?"}`);
await api("/api/publish/status", (b) => `${b.state}/${b.mechanism}`);
await api("/api/tokens", (b) => `${(b.tokens ?? []).length} tokens on ${b.chain ?? "?"}; reachable=${(b.tokens ?? []).map((t) => t.reachable).join(",")}`);
await api("/api/finches", (b) => `${(b.finches ?? b.items ?? []).length} finches`);
await api("/api/nests", (b) => `${(b.nests ?? b.items ?? []).length} nests`);
await api("/api/aviary", (b) => `${(b.listings ?? b.items ?? []).length} listings`);
await api("/api/hive", (b) => `${b.count ?? (b.findings ?? b.items ?? []).length} findings`);
await api("/api/registry", (b) => `configured=${b.configured} authority=${b.authority ?? "null"} anchored=${b.registeredCount ?? "?"}/${(b.registrations ?? []).length}${b.note ? ` note=${String(b.note).slice(0, 60)}` : ""}`);

// One real read-only finch run, as a visitor would do it.
{
  const started = Date.now();
  try {
    const r = await fetch(BASE + "/api/school/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preset: "chain-pulse", input: "Give me a one-line chain pulse." }) });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = null; }
    const out = body?.output ?? body?.result?.output ?? null;
    console.log(`run  school chain-pulse   ${r.status} ${ms(started)} ok=${body?.ok ?? "?"} haltedBy=${body?.haltedBy ?? body?.result?.haltedBy ?? "?"} error=${body?.error ?? "-"} output=${out ? JSON.stringify(out).slice(0, 100) : "(none)"}`);
    if (!r.ok) console.log(`     body: ${text.slice(0, 300)}`);
  } catch (e) { console.log(`run  school chain-pulse   FAILED ${e.message}`); }
}

// One real nest run, streamed to completion.
{
  const started = Date.now();
  try {
    const r = await fetch(BASE + "/api/nests/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nest: "chain-intelligence", objective: "one-line chain pulse" }) });
    console.log(`run  nest chain-intel     ${r.status} ${r.headers.get("content-type")}`);
    if (r.ok && r.body) {
      const reader = r.body.getReader(); const dec = new TextDecoder();
      let buf = "", done = false; const statuses = {}; let errors = []; let finished = null;
      while (!done && Date.now() - started < 170_000) {
        const chunk = await reader.read(); if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:")); if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5));
            if (ev.type === "task.status") { statuses[ev.task.id] = `${ev.task.finch}:${ev.task.status}`; if (ev.task.error) errors.push(`${ev.task.finch}: ${ev.task.error.slice(0, 140)}`); }
            if (ev.type === "run.config") console.log(`     config: providers=${JSON.stringify(ev.providers ?? ev.chain ?? ev.config?.providers ?? null).slice(0, 120)} parallelism=${JSON.stringify(ev.parallelism)}`);
            if (ev.type === "nest.finished" || ev.type === "run.finished" || ev.type === "nest.completed") { finished = ev; done = true; }
            if (ev.type === "error" || ev.type === "run.error") { errors.push(JSON.stringify(ev).slice(0, 200)); done = true; }
          } catch {}
        }
      }
      await reader.cancel().catch(() => {});
      console.log(`     ${ms(started)} tasks=${JSON.stringify(statuses)} finished=${finished ? (finished.status ?? finished.run?.status ?? "yes") : "NO (timeout or stream ended)"}`);
      for (const e of errors.slice(0, 6)) console.log(`     !! ${e}`);
    }
  } catch (e) { console.log(`run  nest chain-intel     FAILED ${e.message}`); }
}
console.log(`total ${ms(t0)}`);
