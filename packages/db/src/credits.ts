import { getCollections } from "./collections.ts";
import { creditEntrySchema, type CreditEntry } from "./schemas.ts";

/**
 * Finch compute credits — double-entry accounting.
 *
 * This is the accounting architecture for $FINCH network consumption
 * (compute credits, paid executions, premium APIs, Aviary services, Swarm
 * workloads, resource limits). IMPORTANT: token settlement is NOT live —
 * until the $FINCH contracts exist, credits enter the system only through
 * "grant" and "adjustment" entries made by operators. Nothing here mints
 * balances from pretend token payments.
 *
 * Account naming:
 *   user:<id>          — a developer/agent owner's spendable credits
 *   provider:<slug>    — an Aviary publisher's earned credits (payout-able)
 *   network:compute    — credits consumed by model/compute usage
 *   network:executions — credits consumed by agent executions
 *   treasury:reserve   — the treasury-side pool credits are issued from
 *
 * Invariant: every movement is one entry debiting exactly one account and
 * crediting exactly one account; balances are sums over entries. The unique
 * index on idempotencyKey makes retries safe.
 */

export const CREDIT_ACCOUNTS = {
  treasuryReserve: "treasury:reserve",
  networkCompute: "network:compute",
  networkExecutions: "network:executions",
  user: (id: string) => `user:${id}`,
  provider: (slug: string) => `provider:${slug}`,
} as const;

export interface PostCreditEntryInput {
  debit: string;
  credit: string;
  amount: number;
  reason: CreditEntry["reason"];
  ref?: string;
  idempotencyKey: string;
}

export async function postCreditEntry(input: PostCreditEntryInput): Promise<{ posted: boolean; entryId: string }> {
  const entry = creditEntrySchema.parse({
    entryId: `ce_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    ...input,
  });
  if (entry.debit === entry.credit) {
    throw new Error("credit entry must move value between two different accounts");
  }
  const { creditEntries } = await getCollections();
  try {
    await creditEntries.insertOne(entry);
    return { posted: true, entryId: entry.entryId };
  } catch (error) {
    // Duplicate idempotencyKey → the entry already exists; treat as success.
    if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
      const existing = await creditEntries.findOne({ idempotencyKey: entry.idempotencyKey });
      return { posted: false, entryId: existing?.entryId ?? entry.entryId };
    }
    throw error;
  }
}

/** Authoritative balance: credits received minus credits spent. */
export async function creditBalance(account: string): Promise<number> {
  const { creditEntries } = await getCollections();
  const [received, spent] = await Promise.all([
    creditEntries.aggregate([{ $match: { credit: account } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
    creditEntries.aggregate([{ $match: { debit: account } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
  ]);
  return Number(received[0]?.total ?? 0) - Number(spent[0]?.total ?? 0);
}

/** Charge a user for an agent execution. Fails closed on insufficient balance. */
export async function chargeExecution(userId: string, credits: number, executionId: string): Promise<void> {
  const account = CREDIT_ACCOUNTS.user(userId);
  const balance = await creditBalance(account);
  if (balance < credits) {
    throw new Error(`insufficient credits: balance ${balance}, required ${credits}`);
  }
  await postCreditEntry({
    debit: account,
    credit: CREDIT_ACCOUNTS.networkExecutions,
    amount: credits,
    reason: "execution",
    ref: executionId,
    idempotencyKey: `exec-charge:${executionId}`,
  });
}

/**
 * Meter a paid Aviary service call: caller pays, publisher earns.
 * Publishers earn the full listed price; network margin, if any, is applied
 * as a separate transparent entry — never hidden in the spread.
 */
export async function chargeServiceCall(params: {
  callerId: string;
  listingSlug: string;
  credits: number;
  idempotencyKey: string;
}): Promise<void> {
  const caller = CREDIT_ACCOUNTS.user(params.callerId);
  const balance = await creditBalance(caller);
  if (balance < params.credits) {
    throw new Error(`insufficient credits: balance ${balance}, required ${params.credits}`);
  }
  await postCreditEntry({
    debit: caller,
    credit: CREDIT_ACCOUNTS.provider(params.listingSlug),
    amount: params.credits,
    reason: "service-call",
    ref: params.listingSlug,
    idempotencyKey: params.idempotencyKey,
  });
}
