"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useFetch } from "@/lib/use-fetch";

/**
 * Publish to the registry.
 *
 * This is the one token-gated surface on Finch. Everything about the gate is
 * rendered from /api/publish/status, so the panel can only ever show the
 * state that is true: locked until $FINCH launches, or open with the hold
 * requirement. The form is fully visible in the locked state — a visitor can
 * see exactly what publishing will ask of them — and nothing about it
 * pretends to work. The submit control says why it is disabled.
 */

interface GateStatus {
  state: "locked" | "open" | "error";
  cost: string;
  token: string | null;
  reason: string;
  mechanism: "hold" | "pay";
}

const CATEGORIES = ["agents", "tools", "data", "trading", "research", "rwa", "infrastructure"] as const;

export function PublishPanel() {
  const gate = useFetch<GateStatus>("/api/publish/status", { refreshMs: 60_000 });
  const { address } = useAccount();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("agents");
  const [description, setDescription] = useState("");
  const [key, setKey] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const status = gate.status === "ready" ? gate.data : null;
  const locked = !status || status.state !== "open";
  const cost = status ? Number(status.cost).toLocaleString() : "250,000";

  const canSubmit =
    !locked && !busy && slug.length >= 2 && name.length >= 2 && description.length > 0 && key.length >= 8 && Boolean(address);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/aviary", {
        method: "POST",
        headers: { "content-type": "application/json", "x-finch-key": key },
        body: JSON.stringify({
          slug,
          name,
          category,
          description,
          creator: { name: address, address },
          publisher: address,
          pricing: { model: "free" },
          chains: ["robinhood"],
          toolNames: [],
          version: "0.1.0",
        }),
      });
      const body = (await res.json()) as { published?: boolean; error?: string; reason?: string };
      setResult(
        res.ok
          ? { ok: true, message: `published as ${slug}` }
          : { ok: false, message: body.error ?? body.reason ?? `publish failed (${res.status})` },
      );
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "publish failed" });
    } finally {
      setBusy(false);
    }
  }

  const disabledReason = !status
    ? "checking the publishing gate"
    : status.state === "locked"
      ? `locked until $FINCH launches — ${cost} $FINCH per listing`
      : status.state === "error"
        ? "the $FINCH balance cannot be read right now"
        : !address
          ? "connect a wallet holding ≥ " + cost + " $FINCH"
          : key.length < 8
            ? "a publisher key is required"
            : "fill in every field";

  return (
    <section id="publish" className="rounded-xs border border-line bg-bone-raised" aria-label="Publish to the registry">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-ink">publish</span>
        {status?.state === "open" ? (
          <Badge tone="green">open · hold ≥ {cost} $FINCH</Badge>
        ) : status?.state === "error" ? (
          <Badge tone="gold">balance unreadable</Badge>
        ) : (
          <Badge tone="grey">locked · {cost} $FINCH</Badge>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-grey">
          the only token-gated action on finch
        </span>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3 text-[13.5px] leading-relaxed text-ink-soft">
          <p>
            Publishing puts your finch or nest in the registry, where anyone can open it, run it, and compose it into
            their own nests. Reading, running and composing stay free. Publishing costs{" "}
            <span className="font-medium text-ink">{cost} $FINCH</span>.
          </p>
          <p className="text-grey">{status?.reason ?? "Checking the publishing gate…"}</p>
          {status?.state === "open" && (
            <p className="text-grey">
              Enforced as a hold: your connected wallet is checked for the balance at publish time, every time.
            </p>
          )}
        </div>

        <fieldset disabled={locked || busy} className="space-y-3 disabled:opacity-60">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label-mono">handle</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-finch"
                className="mt-1 h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12px] text-ink focus:border-green-deep"
              />
            </label>
            <label className="block">
              <span className="label-mono">name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My Finch"
                className="mt-1 h-9 w-full rounded-xs border border-line bg-bone px-3 text-[13px] text-ink focus:border-green-deep"
              />
            </label>
          </div>
          <label className="block">
            <span className="label-mono">category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as (typeof CATEGORIES)[number])}
              className="mt-1 h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12px] text-ink focus:border-green-deep"
            >
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label-mono">description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 400))}
              rows={3}
              placeholder="What it reads, what it reports, what it will never claim."
              className="mt-1 w-full rounded-xs border border-line bg-bone px-3 py-2 text-[13px] leading-relaxed text-ink focus:border-green-deep"
            />
          </label>
          <label className="block">
            <span className="label-mono">publisher key</span>
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="finch_…"
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12px] text-ink focus:border-green-deep"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={submit} disabled={!canSubmit} title={canSubmit ? undefined : disabledReason}>
              {busy ? "publishing…" : "Publish"}
            </Button>
            {!canSubmit && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-grey">{disabledReason}</span>
            )}
          </div>
        </fieldset>
      </div>

      {result && (
        <p
          className={`border-t border-line px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] ${
            result.ok ? "text-green-deep" : "text-gold-deep"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
