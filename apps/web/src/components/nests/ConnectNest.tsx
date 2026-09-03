"use client";

import { useState } from "react";
import type { NestManifest } from "@finch/sdk";

/**
 * Take this nest with you.
 *
 * A nest that only runs inside this website is a demo. The manifest is
 * portable by design, so the endpoint accepts one directly — which means a
 * nest can run from a terminal, a script, or an agent loop, against the same
 * runtime and the same live chain reads as the page.
 *
 * Deliberately quiet and collapsed. This is a capability, not a headline; a
 * visitor who wants to press Run should never have to scroll past it.
 */

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some contexts; the code is selectable anyway,
      // so say nothing rather than throwing an error at someone.
    }
  }

  return (
    <figure className="min-w-0 overflow-hidden rounded-xs border border-line bg-bone-raised">
      <figcaption className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="label-mono">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-grey transition-colors hover:text-ink"
        >
          {copied ? "copied" : "copy"}
        </button>
      </figcaption>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export function ConnectNest({ manifest, origin }: { manifest: NestManifest; origin: string }) {
  const [open, setOpen] = useState(false);
  const id = manifest.identity.id;

  const curl = [
    `curl -N ${origin}/api/nests/run \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"nest":"${id}","objective":"your objective here"}'`,
  ].join("\n");

  const own = [
    `# your own nest — export it from the composer first`,
    `curl -N ${origin}/api/nests/run \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'x-finch-key: YOUR_KEY' \\`,
    `  -d "$(jq -c '{manifest: ., objective: "your objective"}' my-nest.json)"`,
  ].join("\n");

  const node = [
    `const res = await fetch("${origin}/api/nests/run", {`,
    `  method: "POST",`,
    `  headers: { "content-type": "application/json" },`,
    `  body: JSON.stringify({ nest: "${id}", objective }),`,
    `});`,
    ``,
    `// Server-Sent Events: one JSON object per task transition.`,
    `for await (const chunk of res.body) {`,
    `  for (const line of new TextDecoder().decode(chunk).split("\\n")) {`,
    `    if (!line.startsWith("data: ")) continue;`,
    `    const event = JSON.parse(line.slice(6));`,
    `    if (event.type === "task.status") console.log(event.task.id, event.task.status);`,
    `    if (event.type === "nest.synthesis") console.log(event.text);`,
    `  }`,
    `}`,
  ].join("\n");

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3 text-left font-mono text-[10.5px] uppercase tracking-[0.1em] text-grey transition-colors hover:text-ink"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          ›
        </span>
        run this nest from your own terminal
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-5 py-4">
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-grey">
            The same endpoint this page uses is public. Streaming is Server-Sent Events — one JSON object per task
            transition, so an agent loop can react to each step rather than waiting for the whole run.
          </p>

          <Snippet label="run this nest — no key needed" code={curl} />
          <Snippet label="stream it from node" code={node} />
          <Snippet label="run a nest you wrote yourself" code={own} />

          <p className="max-w-2xl text-[12px] leading-relaxed text-grey-faint">
            Builtin nests run without a key. Submitting your own manifest needs a publisher key, because it spends this
            deployment&rsquo;s inference budget — and it is capped at 8 finches and 12 tasks per request. Every run is
            read-only: observer wallet, no signer, writes denied by policy.
          </p>
        </div>
      )}
    </div>
  );
}
