"use client";

import { getBase64Encoder } from "@solana/kit";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NATIVE_SYMBOL, explorerTxUrl } from "@/lib/chain";
import { formatNumber, formatSol, formatUnits, truncateAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet";

/**
 * The transaction a finch prepared, waiting for the visitor's signature.
 *
 * This is the moment Finch stops being read-only. The finch proposed it, the
 * policy engine checked it against the caps, the cluster simulated it with the
 * visitor as fee payer — and none of that moved anything. The visitor's wallet
 * is the only signer. Everything shown is the prepared transaction, and the
 * state after signing is whatever the server read back from Solana, never
 * assumed from a wallet returning a signature or a request returning 200.
 */

export interface PreparedInstruction {
  programAddress: string;
  accounts: Array<{ address: string; role: string }>;
  /** Instruction data, base64. */
  data: string;
}

export interface PreparedExecution {
  id: string;
  state: string;
  intent: {
    kind: string;
    summary: string;
    to?: string;
    spendAsset?: string;
    spendAmount?: string;
    meta?: { recipient?: string; amount?: string; symbol?: string; decimals?: number; mint?: string };
  };
  policy?: { verdict: string; rule: string; reason: string };
  simulation?: { ok: boolean; computeUnits?: number | string; feeLamports?: number | string; logs?: string[]; error?: string; simulatedAt?: string };
  prepared?: {
    feePayer: string;
    instructions: PreparedInstruction[];
    addressLookupTables?: string[];
    computeUnits?: number | string;
  };
  error?: string;
}

interface SettledBody {
  id?: string;
  state?: string;
  tx?: { signature: string; submittedAt: string } | null;
  receipt?: { status: string; slot: number | string; feeLamports: number | string; computeUnits?: number | string; confirmedAt: string } | null;
  explorerUrl?: string;
  proof?: unknown;
  note?: string;
  error?: string;
}

type Outcome =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "signing" }
  | { phase: "submitting"; signature: string }
  | { phase: "settled"; signature: string; body: SettledBody }
  // Sent from the wallet, but Finch could not read it back yet. The signature
  // is real, so it is kept and shown — never dropped behind a generic error.
  | { phase: "unrecorded"; signature: string; from: string; message: string }
  | { phase: "expired"; message: string }
  | { phase: "error"; message: string };

// Names for programs whose addresses are fixed and public. Anything else is
// shown by address only — a guessed name would be worse than none.
const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo",
  Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH: "Memo",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
};

function programLabel(address: string): string {
  const name = KNOWN_PROGRAMS[address];
  return name ? `${name} (${truncateAddress(address)})` : truncateAddress(address);
}

function amountLabel(intent: PreparedExecution["intent"]): string | null {
  const meta = intent.meta;
  if (meta?.amount) return `${meta.amount}${meta.symbol ? ` ${meta.symbol}` : ""}`;
  if (!intent.spendAmount) return null;
  try {
    const raw = BigInt(intent.spendAmount);
    if (intent.spendAsset === "native") return `${formatUnits(raw, 9)} ${NATIVE_SYMBOL}`;
    if (typeof meta?.decimals === "number") return `${formatUnits(raw, meta.decimals)}${meta.symbol ? ` ${meta.symbol}` : ""}`;
    // Without the mint's decimals the honest display is the raw integer.
    return `${raw.toString()} base units${intent.spendAsset ? ` of ${truncateAddress(intent.spendAsset)}` : ""}`;
  } catch {
    return intent.spendAmount;
  }
}

function units(value: number | string | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? formatNumber(n) : String(value);
}

// How wallets word a transaction whose blockhash is too old to be accepted.
const EXPIRED = /blockhash|block ?height (was )?exceeded|has expired/i;

export function SignPanel({ execution }: { execution: PreparedExecution }) {
  const wallet = useWallet();
  const [outcome, setOutcome] = useState<Outcome>({ phase: "idle" });

  const prepared = execution.prepared;
  if (!prepared) return null;

  const connected = wallet.status === "connected" && Boolean(wallet.address);
  // Base58 is case-sensitive: compared exactly, never lowercased.
  const wrongSigner = Boolean(prepared.feePayer && wallet.address && wallet.address !== prepared.feePayer);
  const ready = outcome.phase === "idle" || outcome.phase === "expired" || outcome.phase === "error";
  const canSign = connected && !wrongSigner && ready;

  // `from` is the address that signed, fixed at signing time — switching
  // accounts in the wallet afterwards must not change what is reported.
  async function record(signature: string, from: string) {
    setOutcome({ phase: "submitting", signature });
    try {
      const res = await fetch(`/api/executions/${execution.id}/submitted`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature, from }),
      });
      const body = (await res.json().catch(() => ({}))) as SettledBody;
      if (!res.ok) {
        setOutcome({ phase: "unrecorded", signature, from, message: body.error ?? `could not record it (${res.status})` });
        return;
      }
      setOutcome({ phase: "settled", signature, body });
    } catch (error) {
      setOutcome({ phase: "unrecorded", signature, from, message: error instanceof Error ? error.message : "network failure" });
    }
  }

  async function sign() {
    const from = wallet.address;
    if (!canSign || !from) return;
    // A fresh transaction every time: it carries a recent blockhash, which is
    // only valid for about a minute, so one fetched earlier may already be dead.
    setOutcome({ phase: "preparing" });
    let transaction: Uint8Array;
    try {
      const res = await fetch(`/api/executions/${execution.id}/transaction`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { transaction?: string; feePayer?: string; error?: string };
      if (!res.ok || typeof body.transaction !== "string") {
        setOutcome({ phase: "error", message: body.error ?? `could not fetch the transaction (${res.status})` });
        return;
      }
      if (body.feePayer && body.feePayer !== prepared!.feePayer) {
        setOutcome({ phase: "error", message: "the transaction the server returned is not the one shown here — not signing it" });
        return;
      }
      transaction = new Uint8Array(getBase64Encoder().encode(body.transaction));
    } catch (error) {
      setOutcome({ phase: "error", message: error instanceof Error ? error.message : "could not fetch the transaction" });
      return;
    }

    setOutcome({ phase: "signing" });
    let signature: string;
    try {
      signature = await wallet.signAndSendTransaction(transaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : "signing failed";
      setOutcome(EXPIRED.test(message) ? { phase: "expired", message } : { phase: "error", message: message.slice(0, 200) });
      return;
    }
    await record(signature, from);
  }

  const simulation = execution.simulation;
  const simFee = formatSol(simulation?.feeLamports);
  const simUnits = units(simulation?.computeUnits);
  const verdictTone = execution.policy?.verdict === "needs_approval" ? "gold" : "sage";
  const recipient = execution.intent.meta?.recipient ?? execution.intent.to ?? null;
  const amount = amountLabel(execution.intent);
  const instructions = prepared.instructions ?? [];
  const programs = [...new Set(instructions.map((instruction) => instruction.programAddress))];
  const signed = outcome.phase === "submitting" || outcome.phase === "settled" || outcome.phase === "unrecorded";

  return (
    <div className="rounded-xs border border-ink/40 bg-bone-raised p-4" aria-label="Transaction awaiting your signature">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-medium text-ink">{signed ? "signed in your wallet" : "awaiting your signature"}</span>
        <Badge tone={verdictTone}>policy · {execution.policy?.verdict ?? "checked"}</Badge>
        {simulation?.ok ? (
          <Badge tone="sage">
            simulated{simUnits ? ` · ${simUnits} CU` : ""}
            {simFee ? ` · fee ${simFee} ${NATIVE_SYMBOL}` : ""}
          </Badge>
        ) : simulation ? (
          <Badge tone="red">simulation failed</Badge>
        ) : null}
      </div>

      <p className="mt-2 text-[13.5px] text-ink">{execution.intent.summary}</p>
      {execution.policy?.verdict === "needs_approval" && (
        <p className="mt-1 text-[12px] text-gold-deep">
          Policy flagged this as a large spend. With your own wallet as the signer, you are the approver — signing is the approval.
        </p>
      )}
      {simulation && !simulation.ok && simulation.error && (
        <p className="mt-1 font-mono text-[10.5px] text-red-deep">{simulation.error}</p>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-[auto_1fr]">
        {recipient && (
          <>
            <dt className="text-grey-faint">recipient</dt>
            <dd className="break-all text-ink-soft">{recipient}</dd>
          </>
        )}
        <dt className="text-grey-faint">amount</dt>
        <dd className="text-ink-soft">{amount ?? "none"}</dd>
        <dt className="text-grey-faint">fee payer</dt>
        <dd className="break-all text-ink-soft">{prepared.feePayer}</dd>
        <dt className="text-grey-faint">programs</dt>
        <dd className="text-ink-soft" title={programs.join("\n")}>
          {programs.length > 0 ? programs.map(programLabel).join(", ") : "none"}
        </dd>
        <dt className="text-grey-faint">instructions</dt>
        <dd className="text-ink-soft tnum">{instructions.length}</dd>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!connected ? (
          <span className="font-mono text-[10.5px] text-grey">connect the wallet this was prepared for</span>
        ) : wrongSigner ? (
          <span className="font-mono text-[10.5px] text-gold-deep">
            prepared for {truncateAddress(prepared.feePayer)} — connect that wallet
          </span>
        ) : outcome.phase === "settled" || outcome.phase === "unrecorded" ? null : (
          <Button onClick={sign} disabled={!canSign}>
            {outcome.phase === "preparing"
              ? "preparing…"
              : outcome.phase === "signing"
                ? "check your wallet…"
                : outcome.phase === "submitting"
                  ? "confirming on Solana…"
                  : outcome.phase === "expired"
                    ? "Sign a fresh transaction"
                    : "Sign in wallet"}
          </Button>
        )}
        {outcome.phase === "error" && <span className="font-mono text-[10.5px] text-gold-deep">{outcome.message}</span>}
        {outcome.phase === "expired" && (
          <span className="font-mono text-[10.5px] text-gold-deep" title={outcome.message}>
            the wallet could not send it: its blockhash expired (one is valid for about a minute) — sign again to fetch a
            fresh transaction
          </span>
        )}
      </div>

      {outcome.phase === "submitting" && (
        <p className="mt-3 font-mono text-[10.5px] text-grey">
          sent {outcome.signature.slice(0, 12)}… · waiting for Solana to confirm it
        </p>
      )}

      {outcome.phase === "unrecorded" && (
        <div className="mt-3 rounded-xs border border-gold-deep/40 p-3">
          <p className="font-mono text-[11px] text-ink">sent from your wallet · not yet recorded</p>
          <p className="mt-1 text-[12px] text-grey">
            Your wallet returned signature {outcome.signature.slice(0, 12)}…, but Finch could not read it back: {outcome.message}.
            Its outcome is unknown here until it is.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="secondary" className="h-8 px-3" onClick={() => void record(outcome.signature, outcome.from)}>
              check again
            </Button>
            <a
              href={explorerTxUrl(outcome.signature)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10.5px] text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
            >
              view on solscan ↗
            </a>
          </div>
        </div>
      )}

      {outcome.phase === "settled" && <Settled signature={outcome.signature} body={outcome.body} />}
    </div>
  );
}

/** Renders exactly the state the server reported — nothing is upgraded on the way to the screen. */
function Settled({ signature, body }: { signature: string; body: SettledBody }) {
  const state = body.state ?? "unknown";
  const receipt = body.receipt ?? null;
  const fee = formatSol(receipt?.feeLamports);
  const cu = units(receipt?.computeUnits);
  const link = body.explorerUrl ?? explorerTxUrl(body.tx?.signature ?? signature);

  const tone =
    state === "confirmed" ? "border-green-deep/40 bg-green-wash/30" : state === "reverted" ? "border-red-deep/40 bg-red-wash/40" : "border-gold-deep/40";

  return (
    <div className={`mt-3 rounded-xs border p-3 ${tone}`}>
      <p className="font-mono text-[11px] text-ink">
        {state}
        {receipt ? ` · slot ${receipt.slot}` : ""}
        {fee ? ` · fee ${fee} ${NATIVE_SYMBOL}` : ""}
        {cu ? ` · ${cu} CU` : ""}
      </p>
      {state === "reverted" && (
        <p className="mt-1 text-[12px] text-red-deep">
          It landed with an instruction error: the fee was paid, nothing else changed.
        </p>
      )}
      {body.note && <p className="mt-1 text-[12px] text-grey">{body.note}</p>}
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block font-mono text-[10.5px] text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep"
      >
        view on solscan ↗
      </a>
      {body.proof ? (
        <p className="mt-1 font-mono text-[10px] text-green-deep">proof of flight issued</p>
      ) : state === "confirmed" ? (
        <p className="mt-1 font-mono text-[10px] text-grey">confirmed · proof unavailable</p>
      ) : null}
    </div>
  );
}
