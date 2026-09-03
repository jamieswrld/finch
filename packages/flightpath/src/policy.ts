import type { Address } from "viem";
import type { ExecutionIntent, PolicyDecision } from "./types.ts";

/**
 * Wallet policy — the boundary between an agent and funds.
 *
 * An agent NEVER holds unrestricted custody. It operates a restricted wallet
 * whose authority is defined here (mirrored onchain by OperatorBudget.sol):
 *
 *   Finch treasury wallet  →  restricted operator wallet  →  budgets/allowances
 */

export type WalletMode = "none" | "observer" | "operator";

export interface Allowance {
  /** "native" or an ERC20 token address. */
  asset: "native" | Address;
  /** Max spend per rolling 24h window, in the asset's smallest unit. */
  perDay: bigint;
  /** Max spend in a single transaction. Defaults to perDay. */
  perTx?: bigint;
}

export interface WalletPolicy {
  mode: WalletMode;
  allowances: Allowance[];
  /** Contracts the agent may call with arbitrary calldata (contract.write, swap routers). */
  allowedContracts: Address[];
  /** If set, native/ERC20 transfers may only go to these recipients. */
  allowedRecipients?: Address[];
  /** Spends above this fraction of the daily allowance require human approval (0–1). */
  approvalThreshold?: number;
  /** RWA writes must target the approved registry. Defaults to true and cannot be waived silently. */
  rwaApprovedOnly?: boolean;
}

export const OBSERVER_POLICY: WalletPolicy = {
  mode: "observer",
  allowances: [],
  allowedContracts: [],
};

/** Tracks realized spend so daily allowances mean something across restarts. */
export interface SpendTracker {
  spentInWindow(asset: "native" | Address, windowMs: number): Promise<bigint>;
  recordSpend(asset: "native" | Address, amount: bigint, at?: Date): Promise<void>;
}

export class MemorySpendTracker implements SpendTracker {
  private entries: Array<{ asset: string; amount: bigint; at: number }> = [];

  async spentInWindow(asset: "native" | Address, windowMs: number): Promise<bigint> {
    const cutoff = Date.now() - windowMs;
    const key = asset.toLowerCase();
    return this.entries
      .filter((entry) => entry.asset === key && entry.at >= cutoff)
      .reduce((sum, entry) => sum + entry.amount, 0n);
  }

  async recordSpend(asset: "native" | Address, amount: bigint, at?: Date): Promise<void> {
    this.entries.push({ asset: asset.toLowerCase(), amount, at: (at ?? new Date()).getTime() });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every rule evaluate() can return, in the order it checks them. Exported so
 * the docs render the real rule set rather than a hand-written copy that
 * drifts. A test asserts that every rule id evaluate() emits appears here.
 */
export const POLICY_RULES = [
  {
    id: "wallet.mode",
    verdict: "deny",
    when: "The wallet is not in operator mode.",
    why: "Observer and none-mode finches have no write authority at all. This is the default, so a finch is read-only until you deliberately grant otherwise.",
  },
  {
    id: "recipients.allowlist",
    verdict: "deny",
    when: "A counterparty is not on allowedRecipients (when that list is set).",
    why: "Counterparty means whoever ends up able to move value: a transfer's recipient, an approval's spender, an RWA action's other side — not just transfer destinations.",
  },
  {
    id: "contracts.allowlist",
    verdict: "deny",
    when: "A contract call, swap, approval or ERC20 transfer targets a contract outside allowedContracts.",
    why: "Anything that hands calldata to a contract must name that contract up front, approvals included.",
  },
  {
    id: "rwa.approved",
    verdict: "deny",
    when: "An RWA interaction targets an asset outside the approved registry.",
    why: "Permissioned real-world assets are gated to an explicit registry, and a manifest cannot waive the gate.",
  },
  {
    id: "rwa.contracts",
    verdict: "deny",
    when: "RWA registry gating was opted out of and the target is not an allowlisted contract.",
    why: "Even with the registry gate off, the target must still be named.",
  },
  {
    id: "allowance.missing",
    verdict: "deny",
    when: "The intent spends an asset with no configured allowance.",
    why: "Spending authority is opt-in per asset. No allowance means no spend.",
  },
  {
    id: "allowance.perTx",
    verdict: "deny",
    when: "A single spend exceeds the per-transaction cap.",
    why: "Caps the blast radius of any one mistake, independently of the daily budget.",
  },
  {
    id: "allowance.daily",
    verdict: "deny",
    when: "The rolling 24h spend would exceed perDay.",
    why: "Spend is debited at submission, so a transaction that broadcasts always counts even if its receipt is lost.",
  },
  {
    id: "allowance.approvalThreshold",
    verdict: "needs_approval",
    when: "A spend exceeds approvalThreshold as a fraction of the daily allowance.",
    why: "Parks the intent at awaiting_approval. Only a recorded human approval releases it — replaying the execution id will not.",
  },
  {
    id: "human.approval",
    verdict: "allow",
    when: "A human approved a parked intent.",
    why: "Recorded on the execution as who approved and when, and covered by the Proof of Flight hash.",
  },
  {
    id: "default",
    verdict: "allow",
    when: "Every check above passed.",
    why: "The intent proceeds to mandatory simulation before anything is signed.",
  },
] as const;

export type PolicyRuleId = (typeof POLICY_RULES)[number]["id"];

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Value-moving function selectors. An allowlisted contract is still a contract
 * you can hand `transfer(attacker, all)` to, so a raw contract.write must not
 * be a way around the counterparty allowlist.
 */
const VALUE_MOVING_SELECTORS: Record<
  string,
  { name: string; recipientArgIndex: number; amountArgIndex?: number }
> = {
  "0xa9059cbb": { name: "transfer(address,uint256)", recipientArgIndex: 0, amountArgIndex: 1 },
  "0x095ea7b3": { name: "approve(address,uint256)", recipientArgIndex: 0, amountArgIndex: 1 },
  "0x23b872dd": { name: "transferFrom(address,address,uint256)", recipientArgIndex: 1, amountArgIndex: 2 },
  // ERC721 transfers move a token id, not a fungible amount — recipient only.
  "0x42842e0e": { name: "safeTransferFrom(address,address,uint256)", recipientArgIndex: 1 },
  "0xb88d4fde": { name: "safeTransferFrom(address,address,uint256,bytes)", recipientArgIndex: 1 },
};

/** Read the Nth 32-byte ABI word of calldata as an address. */
function addressArg(data: string, index: number): string | null {
  const body = data.slice(10); // strip 0x + 4-byte selector
  const start = index * 64;
  const word = body.slice(start, start + 64);
  if (word.length !== 64) return null;
  return `0x${word.slice(24)}`;
}

/** Read the Nth 32-byte ABI word of calldata as a uint256. */
function uintArg(data: string, index: number): bigint | null {
  const body = data.slice(10);
  const start = index * 64;
  const word = body.slice(start, start + 64);
  if (word.length !== 64) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

/**
 * The value a raw contract call moves, in the token contract being called.
 * Without this, an ERC20 transfer smuggled through contract.write would be
 * priced as a zero-value native call and skip allowance accounting entirely.
 */
export function decodedSpend(
  data: string | undefined,
): { amount: bigint; amountArgIndex: number } | undefined {
  if (!data || data.length < 10) return undefined;
  const known = VALUE_MOVING_SELECTORS[data.slice(0, 10).toLowerCase()];
  if (!known || known.amountArgIndex === undefined) return undefined;
  const amount = uintArg(data, known.amountArgIndex);
  if (amount === null) return undefined;
  return { amount, amountArgIndex: known.amountArgIndex };
}

/**
 * Decode a raw contract call far enough to find who ends up able to move
 * value. Returns undefined when the call is not a known value-moving one.
 */
export function decodedCounterparty(data: string | undefined): string | undefined {
  if (!data || data.length < 10) return undefined;
  const selector = data.slice(0, 10).toLowerCase();
  const known = VALUE_MOVING_SELECTORS[selector];
  if (!known) return undefined;
  return addressArg(data, known.recipientArgIndex) ?? undefined;
}

/**
 * Whoever gains the ability to move value as a result of this intent.
 * Returns null only when there is genuinely no distinct counterparty.
 */
function counterpartyOf(intent: ExecutionIntent): string | null {
  switch (intent.kind) {
    case "transfer.native":
      return intent.meta?.recipient ?? intent.to;
    case "transfer.erc20":
      return intent.meta?.recipient ?? decodedCounterparty(intent.data) ?? null;
    case "erc20.approve":
      return intent.meta?.spender ?? decodedCounterparty(intent.data) ?? null;
    case "rwa.interact":
      return intent.meta?.counterparty ?? decodedCounterparty(intent.data) ?? null;
    case "swap.exactIn":
      // The router is allowlisted, but the swap's output recipient is not
      // implied by that — read it off the meta the intent builder recorded.
      return intent.meta?.recipient ?? null;
    case "contract.write":
      // Decoded from calldata: an allowlisted token contract must not become a
      // laundering route for a transfer to an unlisted address.
      return decodedCounterparty(intent.data) ?? null;
    default:
      return null;
  }
}

export class PolicyEngine {
  // Plain fields rather than TypeScript parameter properties: the SDK is meant
  // to run under type-stripping runtimes (node --experimental-strip-types,
  // Deno, Bun) with no build step, and those reject parameter properties.
  readonly policy: WalletPolicy;
  readonly spendTracker: SpendTracker;
  private readonly options: { rwaApprovedAssets?: Address[] };

  constructor(
    policy: WalletPolicy,
    spendTracker: SpendTracker = new MemorySpendTracker(),
    options: { rwaApprovedAssets?: Address[] } = {},
  ) {
    // Refuse a nonsensical threshold rather than silently behaving as if no
    // human gate were configured. Failing loudly at construction is the only
    // safe reading of "approvalThreshold: 1.5".
    const threshold = policy.approvalThreshold;
    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
      throw new Error(
        `invalid approvalThreshold ${threshold}: must be a fraction between 0 and 1 (it gates spends above that share of the daily allowance)`,
      );
    }
    this.policy = policy;
    this.spendTracker = spendTracker;
    this.options = options;
  }

  async evaluate(intent: ExecutionIntent): Promise<PolicyDecision> {
    const { policy } = this;

    if (policy.mode !== "operator") {
      return {
        verdict: "deny",
        rule: "wallet.mode",
        reason: `wallet mode is "${policy.mode}" — onchain writes require an operator wallet`,
      };
    }

    // Counterparty allowlist. "Counterparty" is whoever ends up able to move
    // value: a transfer's recipient, an approval's SPENDER, an RWA action's
    // other side. Checking only transfers would let `erc20.approve` hand an
    // arbitrary address a standing claim on the operator's balance.
    // A PRESENT list is authoritative — an empty one means "no counterparty is
    // allowed", not "no restriction". Reading [] as unrestricted would turn the
    // most restrictive-looking config into the most permissive.
    if (policy.allowedRecipients !== undefined) {
      const counterparty = counterpartyOf(intent);
      if (counterparty) {
        const allowed = policy.allowedRecipients.some((addr) => sameAddress(addr, counterparty));
        if (!allowed) {
          return {
            verdict: "deny",
            rule: "recipients.allowlist",
            reason: `counterparty ${counterparty} is not on the allowlist`,
          };
        }
      }
    }

    // Contract allowlist for any call that hands calldata to a contract —
    // including the token contract in an approval.
    if (
      intent.kind === "contract.write" ||
      intent.kind === "swap.exactIn" ||
      intent.kind === "erc20.approve" ||
      intent.kind === "transfer.erc20"
    ) {
      const allowed = this.policy.allowedContracts.some((addr) => sameAddress(addr, intent.to));
      if (!allowed) {
        return { verdict: "deny", rule: "contracts.allowlist", reason: `contract ${intent.to} is not on the allowlist` };
      }
    }

    // RWA gating keys on the TARGET ADDRESS as well as the intent kind, so a
    // value-moving contract.write to a registry asset cannot walk past the
    // gate that rwa.interact would have hit.
    //
    // Boundary, stated plainly: the registry lists APPROVED assets, so an
    // asset nobody has told us about cannot be recognised as an RWA at all.
    // For those, the contract allowlist is the control — allowlisting a
    // contract IS the act of trusting it.
    const rwaAssets = this.options.rwaApprovedAssets ?? [];
    const touchesKnownRwa = rwaAssets.some((addr) => sameAddress(addr, intent.to));
    const claimsRwa = intent.kind === "rwa.interact";

    if (claimsRwa || touchesKnownRwa) {
      if (policy.rwaApprovedOnly === false) {
        // Even when a developer opts out, the target must be an allowed contract.
        const allowed = this.policy.allowedContracts.some((addr) => sameAddress(addr, intent.to));
        if (!allowed) {
          return { verdict: "deny", rule: "rwa.contracts", reason: "RWA target not on contract allowlist" };
        }
      } else if (!touchesKnownRwa) {
        return { verdict: "deny", rule: "rwa.approved", reason: "asset is not on the approved RWA registry" };
      }
    }

    // Allowance accounting. A raw contract.write carrying ERC20 value is
    // repriced here in the token it actually moves — otherwise it would be
    // scored as a zero-value native call and skip every cap below.
    const decoded = intent.kind === "contract.write" ? decodedSpend(intent.data) : undefined;
    const spendAsset = decoded ? (intent.to as Address) : intent.spendAsset;
    const spendAmount = decoded ? decoded.amount : intent.spendAmount;

    if (spendAmount > 0n) {
      const allowance = policy.allowances.find((entry) => sameAddress(entry.asset, spendAsset));
      if (!allowance) {
        return {
          verdict: "deny",
          rule: "allowance.missing",
          reason: `no allowance configured for asset ${spendAsset}`,
        };
      }
      const perTx = allowance.perTx ?? allowance.perDay;
      if (spendAmount > perTx) {
        return {
          verdict: "deny",
          rule: "allowance.perTx",
          reason: `spend ${spendAmount} exceeds per-transaction cap ${perTx}`,
        };
      }
      const spent = await this.spendTracker.spentInWindow(spendAsset, DAY_MS);
      if (spent + spendAmount > allowance.perDay) {
        return {
          verdict: "deny",
          rule: "allowance.daily",
          reason: `daily allowance exhausted (${spent} of ${allowance.perDay} spent)`,
        };
      }
      // Range is guaranteed by the constructor, so a configured threshold
      // always applies — it can no longer vanish through bad config.
      const threshold = policy.approvalThreshold;
      if (threshold !== undefined) {
        const thresholdAmount = (allowance.perDay * BigInt(Math.round(threshold * 10_000))) / 10_000n;
        if (spendAmount > thresholdAmount) {
          return {
            verdict: "needs_approval",
            rule: "allowance.approvalThreshold",
            reason: `spend exceeds ${Math.round(threshold * 100)}% of daily allowance — human approval required`,
          };
        }
      }
    }

    return { verdict: "allow", rule: "default", reason: "within policy" };
  }

  async recordSpend(intent: ExecutionIntent): Promise<void> {
    // Same repricing as evaluate(), so what is debited matches what was checked.
    const decoded = intent.kind === "contract.write" ? decodedSpend(intent.data) : undefined;
    if (decoded) {
      await this.spendTracker.recordSpend(intent.to as Address, decoded.amount);
      return;
    }
    if (intent.spendAmount > 0n) {
      await this.spendTracker.recordSpend(intent.spendAsset, intent.spendAmount);
    }
  }
}
