"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { appChain } from "@/lib/chain";

/**
 * The transaction a finch prepared, waiting for the visitor's signature.
 *
 * This is the moment Finch stops being read-only. The finch proposed it, the
 * policy engine checked it against the caps, the chain simulated it — and
 * none of that moved anything. The visitor's wallet is the only signer.
 * Everything shown is the exact prepared transaction, and the state after
 * signing is whatever the chain reports, fetched, never assumed.
 */

export interface PreparedExecution {
  id: string;
  state: string;
  intent: { kind: string; summary: string };
  policy?: { verdict: string; rule: string; reason: string };
  simulation?: { ok: boolean; gasEstimate?: string; error?: string };
  prepared?: { from?: string; to: string; value: string; data?: string; gas: string };
}

type Outcome =
  | { phase: "idle" }
  | { phase: "signing" }
  | { phase: "submitting"; hash: string }
  | { phase: "settled"; state: string; hash: string; explorerUrl?: string; receipt?: { status: string; blockNumber: string; gasUsed: string }; proof?: unknown; note?: string }
  | { phase: "error"; message: string };

export function SignPanel({ execution }: { execution: PreparedExecution }) {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { sendTransactionAsync, isPending: sending } = useSendTransaction();
  const [outcome, setOutcome] = useState<Outcome>({ phase: "idle" });

  const prepared = execution.prepared;
  if (!prepared) return null;

  const onChain = chainId === appChain.id;
  const preparedFor = prepared.from?.toLowerCase();
  const wrongSigner = Boolean(preparedFor && address && address.toLowerCase() !== preparedFor);
  const canSign = isConnected && onChain && !wrongSigner && outcome.phase === "idle";

  async function sign() {
    if (!canSign) return;
    setOutcome({ phase: "signing" });
    try {
      const hash = await sendTransactionAsync({
        to: prepared!.to as `0x${string}`,
        value: BigInt(prepared!.value),
        data: (prepared!.data ?? "0x") as `0x${string}`,
        gas: BigInt(prepared!.gas),
        chainId: appChain.id,
      });
      setOutcome({ phase: "submitting", hash });
      const res = await fetch(`/api/executions/${execution.id}/submitted`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash, from: address }),
      });
      const body = (await res.json()) as { state?: string; receipt?: { status: string; blockNumber: string; gasUsed: string }; explorerUrl?: string; proof?: unknown; note?: string; error?: string };
      if (!res.ok) {
        setOutcome({ phase: "error", message: body.error ?? `submit failed (${res.status})` });
        return;
      }
      setOutcome({ phase: "settled", state: body.state ?? "submitted", hash, explorerUrl: body.explorerUrl, receipt: body.receipt, proof: body.proof, note: body.note });
    } catch (error) {
      const message = error instanceof Error ? error.message : "signing failed";
      // A rejected signature is a decision, not an error.
      setOutcome({ phase: "error", message: /reject|denied|cancel/i.test(message) ? "signature declined in wallet" : message.slice(0, 200) });
    }
  }

  const valueEth = formatEther(BigInt(prepared.value));
  const verdictTone = execution.policy?.verdict === "needs_approval" ? "gold" : "sage";

  return (
    <div className="rounded-xs border border-ink/40 bg-bone-raised p-4" aria-label="Transaction awaiting your signature">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-medium text-ink">awaiting your signature</span>
        <Badge tone={verdictTone}>policy · {execution.policy?.verdict ?? "checked"}</Badge>
        {execution.simulation?.ok && <Badge tone="sage">simulated · gas ≈ {execution.simulation.gasEstimate}</Badge>}
      </div>

      <p className="mt-2 text-[13.5px] text-ink">{execution.intent.summary}</p>
      {execution.policy?.verdict === "needs_approval" && (
        <p className="mt-1 text-[12px] text-gold-deep">
          Policy flagged this as a large spend. With your own wallet as the signer, you are the approver — signing is the approval.
        </p>
      )}

      <dl className="mt-3 grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-[auto_1fr]">
        <dt className="text-grey-faint">to</dt>
        <dd className="break-all text-ink-soft">{prepared.to}</dd>
        <dt className="text-grey-faint">value</dt>
        <dd className="text-ink-soft">{valueEth} ETH</dd>
        <dt className="text-grey-faint">data</dt>
        <dd className="break-all text-ink-soft">{prepared.data && prepared.data !== "0x" ? `${prepared.data.slice(0, 42)}… (${(prepared.data.length - 2) / 2} bytes)` : "none"}</dd>
        <dt className="text-grey-faint">gas</dt>
        <dd className="text-ink-soft">{prepared.gas}</dd>
        {prepared.from && (
          <>
            <dt className="text-grey-faint">signer</dt>
            <dd className="break-all text-ink-soft">{prepared.from}</dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isConnected ? (
          <span className="font-mono text-[10.5px] text-grey">connect the wallet this was prepared for</span>
        ) : !onChain ? (
          <Button variant="secondary" onClick={() => switchChain({ chainId: appChain.id })} disabled={switching}>
            {switching ? "switching…" : `switch to ${appChain.name}`}
          </Button>
        ) : wrongSigner ? (
          <span className="font-mono text-[10.5px] text-gold-deep">
            prepared for {prepared.from?.slice(0, 8)}… — connect that wallet
          </span>
        ) : (
          <Button onClick={sign} disabled={!canSign || sending}>
            {outcome.phase === "signing" ? "check your wallet…" : outcome.phase === "submitting" ? "confirming on chain…" : "Sign in wallet"}
          </Button>
        )}
        {outcome.phase === "error" && <span className="font-mono text-[10.5px] text-gold-deep">{outcome.message}</span>}
      </div>

      {outcome.phase === "submitting" && (
        <p className="mt-3 font-mono text-[10.5px] text-grey">
          submitted {outcome.hash.slice(0, 14)}… · waiting for the receipt
        </p>
      )}

      {outcome.phase === "settled" && (
        <div className={`mt-3 rounded-xs border p-3 ${outcome.state ==="confirmed" ? "border-green-deep/40 bg-green-wash/30" : "border-gold-deep/40"}`}>
          <p className="font-mono text-[11px] text-ink">
            {outcome.state}
            {outcome.receipt ? ` · block ${outcome.receipt.blockNumber} · gas ${outcome.receipt.gasUsed}` : ""}
          </p>
          {outcome.note && <p className="mt-1 text-[12px] text-grey">{outcome.note}</p>}
          {outcome.explorerUrl && (
            <a href={outcome.explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-mono text-[10.5px] text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-green-deep">
              view on blockscout ↗
            </a>
          )}
          {outcome.proof ? (
            <p className="mt-1 font-mono text-[10px] text-green-deep">proof of flight issued</p>
          ) : outcome.state === "confirmed" ? (
            <p className="mt-1 font-mono text-[10px] text-grey">confirmed · proof unavailable</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
