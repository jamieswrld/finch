import "server-only";
import { formatUnits, getFinchTokenMint, getFlightpathTarget, isSolanaAddress } from "@finch/flightpath";

/**
 * The publishing gate.
 *
 * Publishing is OPEN AND FREE. Anyone with a wallet signs for a publisher key
 * and lists finches and nests; reading, running and composing were always
 * free. This is deliberate: a network nobody can add to is not a network, and
 * the hive learns from every nest that runs. It stays open until the network
 * says otherwise — even once $FINCH trades.
 *
 * The switch is PUBLISH_GATE. Unset or "open" is the default and the truth
 * right now. "hold" turns on the $FINCH gate: a publisher must then HOLD at
 * least PUBLISH_COST_FINCH of the $FINCH mint, read live at publish time. A
 * pay gate (the tokens actually move) needs the publisher to sign a transfer
 * through the user-signed execution path, and is stated here rather than
 * faked. No state implies publishing works when it does not, or costs
 * something when it does not.
 *
 *   open    — free (default), or hold-gated with a mint configured
 *   locked  — hold-gated but no mint to check against
 *   error   — balance could not be read; refuse, do not guess
 */

export const PUBLISH_COST_FINCH = BigInt(process.env.PUBLISH_COST_FINCH ?? "250000");

export type GateState = "locked" | "open" | "error";
export type GateMechanism = "free" | "hold" | "pay";

export interface PublishGate {
  state: GateState;
  /** How publishing is enforced right now. */
  mechanism: GateMechanism;
  /** Whole-token cost once a token gate is on, e.g. 250000. Informational while free. */
  cost: string;
  /** The $FINCH mint the gate would check. */
  token: string | null;
  /** What a visitor should read. Always true, never aspirational. */
  reason: string;
}

function gateSwitch(): "open" | "hold" {
  return process.env.PUBLISH_GATE === "hold" ? "hold" : "open";
}

/** The gate as it stands right now, with no caller in mind. */
export function describeGate(): PublishGate {
  const token = getFinchTokenMint();
  const cost = PUBLISH_COST_FINCH.toString();
  if (gateSwitch() === "open") {
    return {
      state: "open",
      mechanism: "free",
      cost,
      token,
      // Whether or not the token exists changes nothing about the gate; never
      // imply publishing costs something.
      reason: "Publishing is open and free. Sign for a publisher key with any Solana wallet and list what you build; the $FINCH gate is off until the network turns it on.",
    };
  }
  if (!token) {
    return {
      state: "locked",
      mechanism: "hold",
      cost,
      token: null,
      reason: "The $FINCH hold gate is switched on but no mint is configured, so publishing is closed until it is.",
    };
  }
  return {
    state: "open",
    mechanism: "hold",
    cost,
    token,
    reason: `Publishing requires holding at least ${Number(cost).toLocaleString()} $FINCH.`,
  };
}

export interface GateVerdict {
  ok: boolean;
  status: number;
  reason: string;
  gate: PublishGate;
  balance?: string;
}

interface ParsedTokenAccount {
  account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } };
}

/**
 * May this address publish right now?
 *
 * While the gate is free the answer is yes for anyone — the publisher key
 * (issued to a wallet that signed for it) is the only requirement, and that
 * is checked by the identity layer, not here. Once a hold gate is on, the
 * live balance is read every time — never cached, because a hold gate that
 * remembers yesterday's balance is not a hold gate.
 */
export async function checkPublisher(publisher: string | null | undefined): Promise<GateVerdict> {
  const gate = describeGate();

  if (gate.mechanism === "free") {
    return { ok: true, status: 200, reason: "publishing is open and free", gate };
  }
  if (gate.state === "locked" || !gate.token) {
    return { ok: false, status: 423, reason: gate.reason, gate };
  }
  if (!publisher || !isSolanaAddress(publisher)) {
    return {
      ok: false,
      status: 400,
      reason: "publishing requires the publisher's Solana address so the $FINCH balance can be checked",
      gate,
    };
  }

  try {
    const target = getFlightpathTarget();
    const [{ value: accounts }, { value: mint }] = await Promise.all([
      target.rpc
        .getTokenAccountsByOwner(publisher, { mint: gate.token as never }, { encoding: "jsonParsed", commitment: "confirmed" })
        .send(),
      target.rpc.getAccountInfo(gate.token as never, { encoding: "jsonParsed", commitment: "confirmed" }).send(),
    ]);
    if (!mint) {
      return { ok: false, status: 423, reason: "the $FINCH mint does not exist on chain yet, so no balance can satisfy the hold gate", gate };
    }
    let raw = 0n;
    let decimals: number | null = null;
    for (const entry of accounts as unknown as ParsedTokenAccount[]) {
      const amount = entry.account.data.parsed?.info?.tokenAmount;
      raw += BigInt(amount?.amount ?? "0");
      decimals ??= amount?.decimals ?? null;
    }
    const mintDecimals =
      decimals ?? (mint.data as unknown as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals ?? null;
    if (mintDecimals === null) throw new Error("mint decimals unreadable");
    const required = PUBLISH_COST_FINCH * 10n ** BigInt(mintDecimals);
    const held = formatUnits(raw, mintDecimals);
    if (raw < required) {
      return {
        ok: false,
        status: 402,
        reason: `this address holds ${Number(held).toLocaleString()} $FINCH; publishing requires ${Number(gate.cost).toLocaleString()}`,
        gate,
        balance: held,
      };
    }
    return { ok: true, status: 200, reason: "publisher holds the required $FINCH", gate, balance: held };
  } catch (error) {
    // A balance that cannot be read is not a balance of zero, and not a pass.
    return {
      ok: false,
      status: 503,
      reason: `could not read the $FINCH balance (${error instanceof Error ? error.message.slice(0, 120) : "unknown"}) — refusing rather than guessing`,
      gate: { ...gate, state: "error" },
    };
  }
}
