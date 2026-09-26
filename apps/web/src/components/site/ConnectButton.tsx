"use client";

import { useState } from "react";
import { chainLabel } from "@/lib/chain";
import { truncateAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import { StatusDot } from "@/components/ui/Badge";

/**
 * Wallet connection with explicit states: disconnected, connecting, connected,
 * and no-wallet-available. Any Wallet Standard extension that can sign on this
 * cluster is offered; with more than one, the visitor picks. There is no
 * wrong-network state to fix here — every signing request names the cluster,
 * so the wallet is asked for the right one each time.
 */
export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { status, address, walletName, wallets, connect, disconnect, error } = useWallet();
  const [open, setOpen] = useState(false);

  const baseClass =
    "inline-flex h-9 items-center gap-2 rounded-xs border px-3 font-mono text-[11px] transition-colors";
  const panelClass =
    "absolute right-0 top-11 z-50 w-64 rounded-xs border border-line bg-bone-raised p-3 shadow-[0_2px_0_0_rgba(25,27,20,0.06)]";

  if (status === "connected" && address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={`${baseClass} border-line-strong text-ink hover:border-ink`}
          aria-expanded={open}
          title={address}
        >
          <StatusDot tone="green" />
          {truncateAddress(address)}
        </button>
        {open && (
          <div className={panelClass}>
            <p className="label-mono">{walletName ? `wallet · ${walletName}` : "wallet"}</p>
            <p className="mt-1 font-mono text-[12px] text-ink break-all">{address}</p>
            <p className="mt-2 text-[12px] text-grey">Network: {chainLabel}</p>
            <button
              type="button"
              onClick={() => {
                void disconnect();
                setOpen(false);
              }}
              className={`${baseClass} mt-3 w-full justify-center border-line-strong text-ink-soft hover:border-ink hover:text-ink`}
            >
              disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  if (status === "connecting") {
    return (
      <button type="button" disabled className={`${baseClass} border-line text-grey`}>
        <StatusDot tone="sage" pulse />
        connecting…
      </button>
    );
  }

  function onConnect() {
    // One wallet: connect straight away. None, or several: open the panel,
    // which either says how to get one or lets the visitor choose.
    if (wallets.length === 1 && wallets[0]) {
      setOpen(false);
      void connect(wallets[0].name);
      return;
    }
    setOpen((value) => !value);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onConnect}
        aria-expanded={wallets.length === 1 ? undefined : open}
        className={`${baseClass} border-ink bg-ink text-bone hover:bg-green-deep hover:border-green-deep ${compact ? "" : ""}`}
      >
        connect
      </button>
      {open && wallets.length === 0 && (
        <p className={`${panelClass} text-[12px] leading-snug text-ink-soft`}>
          No Solana wallet found. Install a Solana wallet such as Phantom, Solflare or Backpack to connect.
        </p>
      )}
      {open && wallets.length > 1 && (
        <div className={panelClass}>
          <p className="label-mono">choose a wallet</p>
          <ul className="mt-2 space-y-1">
            {wallets.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void connect(entry.name);
                  }}
                  className={`${baseClass} w-full border-line text-ink hover:border-ink`}
                >
                  <img src={entry.icon} alt="" width={14} height={14} className="size-[14px] rounded-[2px]" />
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && !open && (
        // Declining in the wallet is a decision, so it is not painted as a failure.
        <p
          className={`absolute right-0 top-11 z-50 w-56 rounded-xs border p-2 text-[11px] ${
            /declined/.test(error) ? "border-gold/50 bg-bone-raised text-gold-deep" : "border-red-deep/40 bg-red-wash/80 text-red-deep"
          }`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
