"use client";

import { getBase58Decoder } from "@solana/kit";
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from "@wallet-standard/features";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { walletChain } from "./chain";

/**
 * The visitor's Solana wallet, through the Wallet Standard.
 *
 * Every wallet extension that implements the standard registers itself on the
 * page; this lists the ones that can do what Finch asks of a wallet — connect,
 * sign a plain message, and sign-and-send a transaction on this cluster — and
 * nothing else. Finch never holds a key for the visitor: the server prepares
 * a transaction, the wallet signs and sends it, and the only thing that comes
 * back here is the signature. The address and signatures go nowhere except
 * where a caller explicitly sends them.
 */

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface WalletContextValue {
  status: WalletStatus;
  address: string | null;
  walletName: string | null;
  /** Wallets detected in this browser that qualify for this cluster. */
  wallets: Array<{ name: string; icon: string }>;
  connect: (name: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs raw bytes as a message (never a transaction). Returns the 64-byte ed25519 signature. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /** Hands a serialized transaction to the wallet to sign and send. Returns the base58 signature. */
  signAndSendTransaction: (transaction: Uint8Array) => Promise<string>;
  /** The last connection problem, in words a person can act on. Signing errors are thrown to the caller instead. */
  error: string | null;
}

const STORAGE_KEY = "finch:wallet";

// Every storage access is guarded: private windows, blocked site data and
// previews can all throw here, and none of them should break connecting.
function readRemembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(name: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* not remembered — the visitor connects again next time */
  }
}

function forget(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

function connectFeature(wallet: Wallet) {
  return (wallet.features as unknown as Partial<StandardConnectFeature>)[StandardConnect];
}

function disconnectFeature(wallet: Wallet) {
  return (wallet.features as unknown as Partial<StandardDisconnectFeature>)[StandardDisconnect];
}

function eventsFeature(wallet: Wallet) {
  return (wallet.features as unknown as Partial<StandardEventsFeature>)[StandardEvents];
}

function signMessageFeature(wallet: Wallet) {
  return (wallet.features as unknown as Partial<SolanaSignMessageFeature>)[SolanaSignMessage];
}

function signAndSendFeature(wallet: Wallet) {
  return (wallet.features as unknown as Partial<SolanaSignAndSendTransactionFeature>)[SolanaSignAndSendTransaction];
}

/** A wallet that cannot sign for this cluster is not offered at all, rather than offered and failing later. */
function qualifies(wallet: Wallet): boolean {
  return (
    StandardConnect in wallet.features &&
    SolanaSignAndSendTransaction in wallet.features &&
    SolanaSignMessage in wallet.features &&
    wallet.chains.includes(walletChain)
  );
}

function qualifiedWallets(): Wallet[] {
  // Some extensions register twice (a legacy adapter and a standard one);
  // the first registration of a name wins.
  const seen = new Set<string>();
  return getWallets()
    .get()
    .filter((wallet) => {
      if (!qualifies(wallet) || seen.has(wallet.name)) return false;
      seen.add(wallet.name);
      return true;
    });
}

function pickAccount(accounts: readonly WalletAccount[], preferred?: string | null): WalletAccount | null {
  if (preferred) {
    const same = accounts.find((account) => account.address === preferred);
    if (same) return same;
  }
  return accounts.find((account) => account.chains.includes(walletChain)) ?? accounts[0] ?? null;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  // Wallets throw Error instances, plain { code, message } objects, or both.
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

function isRejection(error: unknown): boolean {
  const message = messageOf(error);
  // An expired blockhash is the chain's answer, not the visitor's, even if a
  // wallet words it as "rejected".
  if (/blockhash|block ?height (was )?exceeded|has expired/i.test(message)) return false;
  if ((error as { code?: unknown } | null)?.code === 4001) return true;
  return /reject|denied|declin|cancel/i.test(message);
}

function describe(error: unknown, fallback: string): string {
  const first = messageOf(error).split("\n")[0]?.trim() ?? "";
  return first ? first.slice(0, 200) : fallback;
}

function liveConnection(target: Wallet | null, current: WalletAccount | null): { target: Wallet; current: WalletAccount } {
  if (!target || !current) throw new Error("connect a wallet first");
  return { target, current };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  // Signing reads the live connection, not whatever a render closed over.
  const walletRef = useRef<Wallet | null>(null);
  const accountRef = useRef<WalletAccount | null>(null);
  // Each connect attempt takes a number; a slower, older attempt that
  // resolves after a newer one is ignored instead of overwriting it.
  const attemptRef = useRef(0);
  const triedSilentRef = useRef(false);

  const drop = useCallback(() => {
    walletRef.current = null;
    accountRef.current = null;
    setWallet(null);
    setAccount(null);
    setStatus("disconnected");
  }, []);

  // Discovery. Extensions inject at their own pace, some after the page has
  // loaded, so the list follows register/unregister rather than one read.
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setAvailable(qualifiedWallets());
    refresh();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const establish = useCallback(
    async (target: Wallet, silent: boolean) => {
      const feature = connectFeature(target);
      if (!feature) return;
      const attempt = ++attemptRef.current;
      // A silent attempt stays invisible: if a wallet never answers it, the
      // button must still say "connect", not hang on "connecting…".
      if (!silent) {
        setStatus("connecting");
        setError(null);
      }
      try {
        const { accounts } = await feature.connect(silent ? { silent: true } : undefined);
        if (attempt !== attemptRef.current) return;
        const chosen = pickAccount(accounts.length > 0 ? accounts : target.accounts);
        if (!chosen) {
          setStatus("disconnected");
          if (!silent) setError("the wallet returned no account — unlock it and try again");
          return;
        }
        walletRef.current = target;
        accountRef.current = chosen;
        setWallet(target);
        setAccount(chosen);
        setStatus("connected");
        setError(null);
        remember(target.name);
      } catch (cause) {
        if (attempt !== attemptRef.current) return;
        setStatus("disconnected");
        // A silent reconnect that fails is simply not connected — the
        // visitor did not ask for anything, so there is nothing to report.
        if (silent) return;
        setError(isRejection(cause) ? "connection declined in wallet" : describe(cause, "the wallet could not connect"));
      }
    },
    [],
  );

  // Silent reconnect to the wallet chosen last time, once, as soon as it has
  // registered. Wallets that have not authorized this site return nothing.
  useEffect(() => {
    if (triedSilentRef.current || walletRef.current) return;
    const remembered = readRemembered();
    if (!remembered) {
      triedSilentRef.current = true;
      return;
    }
    const candidate = available.find((entry) => entry.name === remembered);
    if (!candidate) return; // it may still be injecting; this runs again when it registers
    triedSilentRef.current = true;
    void establish(candidate, true);
  }, [available, establish]);

  // A connected wallet that unregisters, or stops qualifying, is no longer a
  // connection — say so rather than keep showing its address.
  useEffect(() => {
    if (wallet && !available.includes(wallet)) drop();
  }, [available, wallet, drop]);

  // Account switches, locks and revocations happen inside the wallet; the
  // standard reports them as change events.
  useEffect(() => {
    if (!wallet) return;
    const events = eventsFeature(wallet);
    if (!events) return;
    return events.on("change", (properties) => {
      if (properties.chains || properties.features) setAvailable(qualifiedWallets());
      if (!properties.accounts) return;
      const next = pickAccount(properties.accounts, accountRef.current?.address);
      if (!next) {
        drop();
        return;
      }
      accountRef.current = next;
      setAccount(next);
    });
  }, [wallet, drop]);

  const connect = useCallback(
    async (name: string) => {
      const target = available.find((entry) => entry.name === name);
      if (!target) {
        setError(`${name} is not available in this browser`);
        return;
      }
      triedSilentRef.current = true;
      await establish(target, false);
    },
    [available, establish],
  );

  const disconnect = useCallback(async () => {
    const current = walletRef.current;
    attemptRef.current += 1;
    drop();
    setError(null);
    forget();
    const feature = current ? disconnectFeature(current) : undefined;
    if (!feature) return;
    try {
      await feature.disconnect();
    } catch {
      /* this side has already let go; the wallet's own state is its own */
    }
  }, [drop]);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    const { target, current } = liveConnection(walletRef.current, accountRef.current);
    const feature = signMessageFeature(target);
    if (!feature) throw new Error(`${target.name} cannot sign messages`);
    let outputs;
    try {
      outputs = await feature.signMessage({ account: current, message });
    } catch (cause) {
      throw new Error(isRejection(cause) ? "signature declined in wallet" : describe(cause, "the wallet could not sign the message"));
    }
    const output = outputs[0];
    if (!output || output.signature.length !== 64) throw new Error("the wallet returned no usable signature");
    // The standard lets a wallet prefix or rewrite the message. A signature
    // over different bytes cannot verify against the text the visitor read,
    // so it is refused here rather than failing mysteriously on the server.
    if (output.signedMessage && output.signedMessage.length > 0 && !sameBytes(output.signedMessage, message)) {
      throw new Error("the wallet altered the message before signing it, so the signature cannot be checked");
    }
    return new Uint8Array(output.signature);
  }, []);

  const signAndSendTransaction = useCallback(async (transaction: Uint8Array): Promise<string> => {
    const { target, current } = liveConnection(walletRef.current, accountRef.current);
    const feature = signAndSendFeature(target);
    if (!feature) throw new Error(`${target.name} cannot sign and send transactions`);
    let outputs;
    try {
      // The chain rides on the call, so a wallet pointed at another cluster
      // cannot send this somewhere it was not prepared for.
      outputs = await feature.signAndSendTransaction({ account: current, chain: walletChain, transaction });
    } catch (cause) {
      throw new Error(isRejection(cause) ? "signature declined in wallet" : describe(cause, "the wallet could not sign and send the transaction"));
    }
    const signature = outputs[0]?.signature;
    if (!signature || signature.length !== 64) throw new Error("the wallet returned no transaction signature");
    return getBase58Decoder().decode(signature);
  }, []);

  const wallets = useMemo(() => available.map((entry) => ({ name: entry.name, icon: entry.icon as string })), [available]);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      address: status === "connected" ? (account?.address ?? null) : null,
      walletName: status === "connected" ? (wallet?.name ?? null) : null,
      wallets,
      connect,
      disconnect,
      signMessage,
      signAndSendTransaction,
      error,
    }),
    [status, account, wallet, wallets, connect, disconnect, signMessage, signAndSendTransaction, error],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
