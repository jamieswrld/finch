import { z } from "zod";

/** Document schemas for every Finch collection. Writes are validated with these. */

export const addressString = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

// ── finches ───────────────────────────────────────────────────────────────
export const finchDocSchema = z.object({
  handle: z.string().min(2).max(32),
  owner: z.string().max(128).optional(),
  /** A FinchManifest document (validated by @finch/sdk before insert). */
  manifest: z.record(z.unknown()),
  status: z.enum(["draft", "hatched"]).default("draft"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinchDoc = z.infer<typeof finchDocSchema>;

// ── nests ─────────────────────────────────────────────────────────────────
export const nestNodeSchema = z.object({
  handle: z.string(),
  name: z.string(),
  role: z.string().max(120),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
});

export const nestStageSchema = z.object({
  id: z.string(),
  name: z.string().max(64),
  finches: z.array(nestNodeSchema).default([]),
});

export const nestEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  channel: z.string().max(64),
});

export const nestDocSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(80),
  description: z.string().max(400).default(""),
  owner: z.string().max(128).optional(),
  stages: z.array(nestStageSchema).default([]),
  edges: z.array(nestEdgeSchema).default([]),
  status: z.enum(["draft", "active", "paused"]).default("draft"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NestDoc = z.infer<typeof nestDocSchema>;
export type NestStage = z.infer<typeof nestStageSchema>;
export type NestNode = z.infer<typeof nestNodeSchema>;
export type NestEdge = z.infer<typeof nestEdgeSchema>;

// ── aviary_listings ───────────────────────────────────────────────────────
export const aviaryCategorySchema = z.enum([
  "agents",
  "tools",
  "data",
  "trading",
  "research",
  "rwa",
  "infrastructure",
]);
export type AviaryCategory = z.infer<typeof aviaryCategorySchema>;

export const aviaryListingSchema = z.object({
  slug: z.string().min(2).max(64),
  name: z.string().min(2).max(80),
  category: aviaryCategorySchema,
  description: z.string().max(400),
  creator: z.object({
    name: z.string().max(64),
    address: addressString.optional(),
  }),
  stats: z.object({
    calls30d: z.number().int().nonnegative(),
    /** null = never measured. A new listing has no uptime history; claiming 100% would be a fabrication. */
    uptime90d: z.number().min(0).max(100).nullable(),
  }),
  pricing: z.object({
    model: z.enum(["free", "per_call", "subscription"]),
    /** Price in Finch compute credits ($FINCH settlement activates post-launch). */
    credits: z.number().nonnegative().optional(),
  }),
  chains: z.array(z.string()).default(["robinhood"]),
  toolNames: z.array(z.string()).default([]),
  verified: z.boolean().default(false),
  version: z.string().default("0.1.0"),
  /**
   * "builtin" rows ship with the deployment and are runnable immediately;
   * "published" rows were registered by a user. There is deliberately no
   * "sample" tier — a listing that cannot be opened and run does not belong
   * in a registry at all.
   */
  source: z.enum(["builtin", "published"]).default("published"),
  createdAt: z.string(),
});
export type AviaryListing = z.infer<typeof aviaryListingSchema>;

// ── executions (Flightpath ExecutionRecord documents) ─────────────────────
export const executionDocSchema = z.object({
  id: z.string(),
  agentId: z.string().optional(),
  chainId: z.number(),
  createdAt: z.string(),
  state: z.enum([
    "created",
    "denied",
    "simulated",
    "simulation_failed",
    "awaiting_approval",
    "approved",
    "submitted",
    "confirmed",
    "reverted",
    "failed",
  ]),
  intent: z.record(z.unknown()),
  policy: z.record(z.unknown()).optional(),
  simulation: z.record(z.unknown()).optional(),
  tx: z.record(z.unknown()).optional(),
  receipt: z.record(z.unknown()).optional(),
  error: z.record(z.unknown()).optional(),
  /**
   * The human approval stamp. This MUST be part of the schema: the sink parses
   * records through it before writing, so an omitted field is not merely
   * undocumented — it is silently deleted on every save, and an approved
   * execution would never open the gate again.
   */
  approval: z.object({ approvedBy: z.string(), at: z.string() }).optional(),
  log: z.array(z.object({ at: z.string(), event: z.string(), detail: z.string().optional() })),
});
export type ExecutionDoc = z.infer<typeof executionDocSchema>;

// ── memory_items ──────────────────────────────────────────────────────────
export const memoryItemDocSchema = z.object({
  namespace: z.string().min(1).max(64),
  role: z.enum(["user", "assistant", "observation"]),
  content: z.string().max(16_000),
  /** Embedding vector for Atlas Vector Search (dimension set by the embed model). */
  embedding: z.array(z.number()).optional(),
  at: z.string(),
  // Provenance — see MemoryItem in @finch/sdk. A stored finding must be able
  // to say where it came from, or it cannot be trusted or purged.
  subject: z.string().max(64).optional(),
  runId: z.string().max(80).optional(),
  nestId: z.string().max(64).optional(),
  finch: z.string().max(64).optional(),
  channel: z.string().max(80).optional(),
  source: z.enum(["run", "user"]).optional(),
});
export type MemoryItemDoc = z.infer<typeof memoryItemDocSchema>;

// ── fee_events (Pons creator-tax indexer) ─────────────────────────────────
export const feeEventDocSchema = z.object({
  token: addressString,
  creator: addressString,
  recipient: addressString,
  /** Amount in wei of the fee asset. */
  amount: z.string().regex(/^[0-9]+$/),
  txHash: z.string(),
  blockNumber: z.string(),
  logIndex: z.number().int().nonnegative(),
  indexedAt: z.string(),
});
export type FeeEventDoc = z.infer<typeof feeEventDocSchema>;

// ── treasury_ledger ───────────────────────────────────────────────────────
export const treasuryCategorySchema = z.enum([
  "creator-fees",
  "compute",
  "data",
  "rpc",
  "hosting",
  "indexing",
  "security",
  "grants",
  "incentives",
  "subsidized-executions",
  "reserve",
]);
export type TreasuryCategory = z.infer<typeof treasuryCategorySchema>;

export const treasuryLedgerEntrySchema = z.object({
  at: z.string(),
  direction: z.enum(["in", "out"]),
  category: treasuryCategorySchema,
  /** Decimal string in `asset` units (not wei) for legibility in the public ledger. */
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
  asset: z.enum(["ETH", "FINCH", "USDC", "USD"]),
  memo: z.string().max(240),
  txHash: z.string().optional(),
  source: z.enum(["seed", "onchain", "manual"]),
});
export type TreasuryLedgerEntry = z.infer<typeof treasuryLedgerEntrySchema>;

// ── credits (double-entry accounting for $FINCH network consumption) ──────
export const creditEntrySchema = z.object({
  entryId: z.string(),
  at: z.string(),
  /** Account debited (balance decreases). Format: "user:<id>" | "provider:<slug>" | "network:<pool>" | "treasury:<pool>". */
  debit: z.string().min(3).max(120),
  /** Account credited (balance increases). */
  credit: z.string().min(3).max(120),
  amount: z.number().int().positive(),
  reason: z.enum(["purchase", "execution", "service-call", "grant", "adjustment", "payout"]),
  ref: z.string().max(200).optional(),
  idempotencyKey: z.string().min(8).max(120),
});
export type CreditEntry = z.infer<typeof creditEntrySchema>;

// ── service_calls (Aviary metering → developer earnings) ──────────────────
export const serviceCallDocSchema = z.object({
  listingSlug: z.string(),
  caller: z.string().max(128),
  at: z.string(),
  credits: z.number().int().nonnegative(),
  status: z.enum(["ok", "error"]),
  latencyMs: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(120),
});
export type ServiceCallDoc = z.infer<typeof serviceCallDocSchema>;

// ── api_keys ──────────────────────────────────────────────────────────────
export const apiKeyDocSchema = z.object({
  /** SHA-256 hex of the key. Raw keys are never stored. */
  keyHash: z.string().length(64),
  owner: z.string().max(128),
  label: z.string().max(64),
  scopes: z.array(z.enum(["aviary:read", "aviary:publish", "nests:write", "executions:read", "credits:spend"])),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  revoked: z.boolean().default(false),
});
export type ApiKeyDoc = z.infer<typeof apiKeyDocSchema>;

export const COLLECTIONS = {
  finches: "finches",
  nests: "nests",
  aviaryListings: "aviary_listings",
  executions: "executions",
  memoryItems: "memory_items",
  feeEvents: "fee_events",
  treasuryLedger: "treasury_ledger",
  creditEntries: "credit_entries",
  serviceCalls: "service_calls",
  apiKeys: "api_keys",
  runs: "runs",
} as const;
