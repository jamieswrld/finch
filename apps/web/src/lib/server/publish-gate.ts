import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, type Address } from "viem";
import { buildRobinhoodChain, getFlightpathTarget } from "@finch/flightpath";

/**
 * The publishing gate.
 *
 * Publishing is OPEN AND FREE. Anyone with a wallet signs for a publisher key
 * and lists finches and nests; reading, running and composing were always
 * free. This is deliberate: a network nobody can add to is not a network, and
 * the hive learns from every nest that runs. It stays open until the network
 * says otherwise — even once $FINCH exists.
 *
 * The switch is PUBLISH_GATE. Unset or "open" is the default and the truth
 * right now. "hold" turns on the $FINCH gate: a publisher must then HOLD at
 * least PUBLISH_COST_FINCH, read live from FINCH_TOKEN_ADDRESS at publish
 * time. A pay gate (the tokens actually move) needs the publisher to sign a
 * transfer through the user-signed execution path, and is stated here rather
 * than faked. No state implies publishing works when it does not, or costs
 * something when it does not.
 *
 *   open    — free (default), or hold-gated with a token configured
 *   locked  — hold-gated but no token address to check against
 *   error   — token set but the balance could not be read; refuse, do not guess
 */

export const PUBLISH_COST_FINCH = BigInt(process.env.PUBLISH_COST_FINCH ?? "250000");
const TOKEN_DECIMALS_FALLBACK = 18;

export type GateState = "locked" | "open" | "error";
export type GateMechanism = "free" | "hold" | "pay";

export interface PublishGate {
  state: GateState;
  /** How publishing is enforced right now. */
  mechanism: GateMechanism;
  /** Whole-token cost once a token gate is on, e.g. 250000. Informational while free. */
  cost: string;
  token: Address | null;
  /** What a visitor should read. Always true, never aspirational. */
  reason: string;
}

function tokenAddress(): Address | null {
  const raw = process.env.FINCH_TOKEN_ADDRESS;
  return raw && isAddress(raw) ? getAddress(raw) : null;
}

function gateSwitch(): "open" | "hold" {
  return process.env.PUBLISH_GATE === "hold" ? "hold" : "open";
}

/** The gate as it stands right now, with no caller in mind. */
export function describeGate(): PublishGate {
  const token = tokenAddress();
  const cost = PUBLISH_COST_FINCH.toString();
  if (gateSwitch() === "open") {
    return {
      state: "open",
      mechanism: "free",
      cost,
      token,
      reason:
        "Publishing is open and free. Sign for a publisher key with any wallet and list what you build; the $FINCH gate is off until the network turns it on.",
    };
  }
  if (!token) {
    return {
      state: "locked",
      mechanism: "hold",
      cost,
      token: null,
      reason: "The $FINCH hold gate is switched on but no token address is configured, so publishing is closed until it is.",
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
  if (!publisher || !isAddress(publisher)) {
    return {
      ok: false,
      status: 400,
      reason: "publishing requires the publisher's wallet address so the $FINCH balance can be checked",
      gate,
    };
  }

  try {
    const target = getFlightpathTarget();
    const client = createPublicClient({ chain: buildRobinhoodChain(), transport: http(target.rpcUrl, { timeout: 8_000 }) });
    const contract = { address: gate.token, abi: erc20Abi } as const;
    const [balance, decimals] = await Promise.all([
      client.readContract({ ...contract, functionName: "balanceOf", args: [getAddress(publisher)] }),
      client.readContract({ ...contract, functionName: "decimals" }).catch(() => TOKEN_DECIMALS_FALLBACK),
    ]);
    const required = PUBLISH_COST_FINCH * 10n ** BigInt(decimals);
    const held = formatUnits(balance, decimals);
    if (balance < required) {
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
