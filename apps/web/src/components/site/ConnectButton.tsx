"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { appChain } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";
import { StatusDot } from "@/components/ui/Badge";

/**
 * Wallet connection with explicit states: disconnected, connecting, connected,
 * wrong network, and no-wallet-available. Injected connector only for now.
 */
export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { address, status, chainId } = useAccount();
  const { connect, connectors, status: connectStatus, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);

  const injectedConnector = connectors[0];
  const wrongNetwork = status === "connected" && chainId !== appChain.id;

  const baseClass =
    "inline-flex h-9 items-center gap-2 rounded-xs border px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors";

  if (status === "connected" && address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`${baseClass} ${wrongNetwork ? "border-gold-deep/50 text-gold-deep" : "border-line-strong text-ink hover:border-ink"}`}
          aria-expanded={open}
        >
          <StatusDot tone={wrongNetwork ? "gold" : "green"} />
          {truncateAddress(address)}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-50 w-64 rounded-xs border border-line bg-bone-raised p-3 shadow-[0_2px_0_0_rgba(25,27,20,0.06)]">
            <p className="label-mono">wallet</p>
            <p className="mt-1 font-mono text-[12px] text-ink break-all">{address}</p>
            <p className="mt-2 text-[12px] text-grey">
              {wrongNetwork ? `Wrong network — expected ${appChain.name} (${appChain.id}).` : `Network: ${appChain.name}`}
            </p>
            {wrongNetwork && (
              <button
                type="button"
                disabled={switching}
                onClick={() => switchChain({ chainId: appChain.id })}
                className={`${baseClass} mt-3 w-full justify-center border-ink bg-ink text-bone hover:bg-green-deep hover:border-green-deep`}
              >
                {switching ? "switching…" : `switch network`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className={`${baseClass} mt-2 w-full justify-center border-line-strong text-ink-soft hover:border-ink hover:text-ink`}
            >
              disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === "connecting" || status === "reconnecting" || connectStatus === "pending") {
    return (
      <button type="button" disabled className={`${baseClass} border-line text-grey`}>
        <StatusDot tone="sage" pulse />
        connecting…
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => injectedConnector && connect({ connector: injectedConnector })}
        className={`${baseClass} border-ink bg-ink text-bone hover:bg-green-deep hover:border-green-deep ${compact ? "" : ""}`}
      >
        connect
      </button>
      {error && (
        <p className="absolute right-0 top-11 z-50 w-56 rounded-xs border border-red-deep/40 bg-red-wash/80 p-2 text-[11px] text-red-deep">
          {error.message.includes("Provider not found") || error.message.includes("not found")
            ? "No injected wallet found. Install a browser wallet to connect."
            : error.message.slice(0, 120)}
        </p>
      )}
    </div>
  );
}
