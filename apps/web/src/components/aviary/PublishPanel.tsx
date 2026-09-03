"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { keyMessage } from "@/lib/key-message";
import { useFetch } from "@/lib/use-fetch";

/**
 * Publish to the registry.
 *
 * Everything about the gate is rendered from /api/publish/status, so the
 * panel can only ever show the state that is true. Right now that state is
 * open and free: a wallet signs a plain message, gets a publisher key, and
 * lists a finch or nest. If a $FINCH gate is ever switched on, this same
 * panel says so and shows the hold requirement — nothing here pretends to
 * cost something it does not, or to work when it does not. The submit
 * control says why it is disabled.
 */

interface GateStatus {
  state: "locked" | "open" | "error";
  mechanism: "free" | "hold" | "pay";
  cost: string;
  token: string | null;
  reason: string;
}

const CATEGORIES = ["agents", "tools", "data", "trading", "research", "rwa", "infrastructure"] as const;

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function PublishPanel() {
  const gate = useFetch<GateStatus>("/api/publish/status", { refreshMs: 60_000 });
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("agents");
  const [description, setDescription] = useState("");
  const [key, setKey] = useState("");
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const status = gate.status === "ready" ? gate.data : null;
  const open = Boolean(status && status.state === "open");
  const free = Boolean(status && status.mechanism === "free");
  const cost = status ? Number(status.cost).toLocaleString() : "250,000";

  const canSubmit =
    open && !busy && slug.length >= 2 && name.length >= 2 && description.length > 0 && key.length >= 8 && Boolean(address);

  async function issueKey() {
    if (!address || issuing) return;
    setIssuing(true);
    setKeyNote(null);
    try {
      const n = nonce();
      const signature = await signMessageAsync({ message: keyMessage(address, n) });
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, nonce: n, signature }),
      });
      const body = (await res.json()) as { key?: string; error?: string };
      if (!res.ok || !body.key) {
        setKeyNote(body.error ?? `key request failed (${res.status})`);
        return;
      }
      setKey(body.key);
      setKeyNote("key issued and filled in below — it is shown once, so copy it somewhere safe");
    } catch (error) {
      setKeyNote(error instanceof Error ? (error.message.split("\n")[0] ?? "signing failed") : "signing was cancelled");
    } finally {
      setIssuing(false);
    }
  }

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
      ? status.reason
      : status.state === "error"
        ? "the $FINCH balance cannot be read right now"
        : !address
          ? free
            ? "connect a wallet to sign for a publisher key"
            : `connect a wallet holding ≥ ${cost} $FINCH`
          : key.length < 8
            ? "sign for a publisher key first"
            : "fill in every field";

  return (
    <section id="publish" className="rounded-xs border border-line bg-bone-raised" aria-label="Publish to the registry">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="font-mono text-[12.5px] font-medium text-ink">publish</span>
        {open && free ? (
          <Badge tone="green">open · free</Badge>
        ) : open ? (
          <Badge tone="green">open · hold ≥ {cost} $FINCH</Badge>
        ) : status?.state === "error" ? (
          <Badge tone="gold">balance unreadable</Badge>
        ) : status ? (
          <Badge tone="grey">closed</Badge>
        ) : (
          <Badge tone="grey">checking</Badge>
        )}
        <span className="ml-auto font-mono text-[10px] text-grey">
          {free ? "anyone with a wallet can publish" : "the only token-gated action on finch"}
        </span>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3 text-[13.5px] leading-relaxed text-ink-soft">
          <p>
            Publishing puts your finch or nest in the registry, where anyone can open it, run it, and compose it into
            their own nests. Every nest that runs teaches the hive, so what you publish makes every other finch a
            little sharper.
          </p>
          <p className="text-grey">{status?.reason ?? "Checking the publishing gate…"}</p>
          {open && !free && (
            <p className="text-grey">
              Enforced as a hold: your connected wallet is checked for the balance at publish time, every time.
            </p>
          )}
          <div className="space-y-2 pt-1">
            <p className="text-ink">
              A publisher key ties listings to your wallet. Signing for one is a plain message — not a transaction; it
              costs nothing and cannot move funds.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={issueKey} disabled={!address || issuing || !open} title={address ? undefined : "connect a wallet first"}>
                {issuing ? "waiting for signature…" : key ? "issue a new key" : "sign for a publisher key"}
              </Button>
              {keyNote && <span className="font-mono text-[10.5px] text-grey">{keyNote}</span>}
            </div>
          </div>
        </div>

        <fieldset disabled={!open || busy} className="space-y-3 disabled:opacity-60">
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
              placeholder="finch_… (sign for one on the left, or paste one you already have)"
              autoComplete="off"
              className="mt-1 h-9 w-full rounded-xs border border-line bg-bone px-3 font-mono text-[12px] text-ink focus:border-green-deep"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={submit} disabled={!canSubmit} title={canSubmit ? undefined : disabledReason}>
              {busy ? "publishing…" : "Publish"}
            </Button>
            {!canSubmit && (
              <span className="font-mono text-[10.5px] text-grey">{disabledReason}</span>
            )}
          </div>
        </fieldset>
      </div>

      {result && (
        <p
          className={`border-t border-line px-5 py-3 font-mono text-[11px] ${
            result.ok ?"text-green-deep" : "text-gold-deep"
          }`}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
