import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, type Address } from "viem";
import { buildRobinhoodChain, getFlightpathTarget } from "@finch/flightpath";

/**
 * The publishing gate.
 *
 * Publishing to the registry is the one thing on Finch that is token-gated:
 * it costs PUBLISH_COST_FINCH ($FINCH). Everything else — reading, running,
 * composing, exporting — is open, because a network nobody can use without
 * paying first is not a network.
 *
 * $FINCH does not exist onchain yet. Until FINCH_TOKEN_ADDRESS is set, the
 * gate is LOCKED and says so; nothing pretends otherwise and nothing can be
 * published. When the token exists, the gate checks that the publisher's
 * address HOLDS at least the cost — a hold gate. A pay gate (the tokens
 * actually move) needs the publisher to sign a transfer, which is the
 * user-signed execution path, and that is stated here rather than faked.
 *
 * Three states, all reported honestly to the UI and the API:
 *   locked   — no token yet; publishing opens at launch
 *   open     — token exists; a publisher must hold >= cost
 *   error    — token set but the balance could not be read; refuse, do not guess
 */

export const PUBLISH_COST_FINCH = BigInt(process.env.PUBLISH_COST_FINCH ?? "250000");
const TOKEN_DECIMALS_FALLBACK = 18;

export type GateState = "locked" | "open" | "error";

export interface PublishGate {
  state: GateState;
  /** Whole-token cost, e.g. 250000. */
  cost: string;
  token: Address | null;
  /** What a visitor should read. Always true, never aspirational. */
  reason: string;
  /** How the gate is enforced once open. */
  mechanism: "hold" | "pay";
}

function tokenAddress(): Address | null {
  const raw = process.env.FINCH_TOKEN_ADDRESS;
  return raw && isAddress(raw) ? getAddress(raw) : null;
}

/** The gate as it stands right now, with no caller in mind. */
export function describeGate(): PublishGate {
  const token = tokenAddress();
  const cost = PUBLISH_COST_FINCH.toString();
  if (!token) {
    return {
      state: "locked",
      cost,
      token: null,
      reason: `Publishing opens when $FINCH launches. It will cost ${Number(cost).toLocaleString()} $FINCH per listing.`,
      mechanism: "hold",
    };
  }
  return {
    state: "open",
    cost,
    token,
    reason: `Publishing requires holding at least ${Number(cost).toLocaleString()} $FINCH.`,
    mechanism: "hold",
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
 * Reads the live balance every time — never cached, because a hold gate that
 * remembers yesterday's balance is not a hold gate.
 */
export async function checkPublisher(publisher: string | null | undefined): Promise<GateVerdict> {
  const gate = describeGate();

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
