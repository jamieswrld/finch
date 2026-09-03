import { z } from "zod";

/**
 * The Finch manifest — the single serializable description of an agent.
 *
 * The same schema backs both surfaces:
 *  · the Finch SDK (`createFinch(...).manifest()`)
 *  · the Nest Builder UI at /build, which emits exactly this document
 *
 * A manifest is inert data. Hatching resolves it against live infrastructure
 * (model provider, Flightpath target, memory store) — and nothing in a
 * manifest can widen its own permissions at hatch time.
 */

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed EVM address");

const decimalString = z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "must be a decimal amount string");

export const identitySchema = z.object({
  name: z.string().min(2).max(64),
  handle: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and hyphens"),
  description: z.string().max(400).default(""),
  /** System instructions given to the model on every run. */
  instructions: z.string().max(8000).default(""),
  glyph: z.string().max(24).default("finch-01"),
});

export const modelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32_768).optional(),
});

export const memoryConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("ephemeral"),
    maxItems: z.number().int().positive().max(512).default(64),
  }),
  z.object({
    kind: z.literal("mongo-vector"),
    namespace: z.string().min(1).max(64),
    retentionDays: z.number().int().positive().max(3650).default(90),
    embeddingModel: z.string().optional(),
  }),
]);

export const toolsConfigSchema = z.object({
  /** Flightpath tool names (see FLIGHTPATH_TOOLS in @finch/flightpath). */
  flightpath: z.array(z.string()).default([]),
  /** Aviary services attached to this finch, by listing slug. */
  services: z.array(z.object({ slug: z.string(), version: z.string().optional() })).default([]),
});

export const permissionsSchema = z.object({
  /** Master gate: with false, every write-mode tool is stripped at hatch. */
  allowWrites: z.boolean().default(false),
  /** Fraction of daily allowance above which a human must approve (0–1). */
  approvalThreshold: z.number().min(0).max(1).optional(),
  /** RWA interactions restricted to the approved registry. Cannot default to false. */
  rwaApprovedOnly: z.boolean().default(true),
});

export const allowanceSchema = z.object({
  asset: z.union([z.literal("native"), addressSchema]),
  /** Per rolling 24h, in human units (resolved to smallest units at hatch). */
  perDay: decimalString,
  perTx: decimalString.optional(),
});

export const walletConfigSchema = z.object({
  mode: z.enum(["none", "observer", "operator"]).default("none"),
  allowances: z.array(allowanceSchema).default([]),
  allowedContracts: z.array(addressSchema).default([]),
  allowedRecipients: z.array(addressSchema).optional(),
});

export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("cron"), schedule: z.string().min(9).max(64) }),
  z.object({ kind: z.literal("webhook"), slug: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("onchain"),
    address: addressSchema,
    event: z.string().min(3).max(256),
  }),
]);

export const budgetSchema = z.object({
  maxActionsPerDay: z.number().int().positive().max(10_000).default(96),
  maxComputeCreditsPerDay: z.number().int().positive().max(1_000_000).default(500),
  maxToolStepsPerRun: z.number().int().positive().max(32).default(8),
  killSwitch: z
    .object({ maxConsecutiveFailures: z.number().int().positive().max(100).default(5) })
    .default({ maxConsecutiveFailures: 5 }),
});

export const deploymentSchema = z.object({
  runtime: z.enum(["self-hosted", "finch-cloud"]).default("self-hosted"),
  /** finch-cloud is waitlisted until the hosted runtime ships. */
  status: z.enum(["draft", "hatched"]).default("draft"),
});

export const endpointsSchema = z.object({
  /** MCP endpoints this finch exposes or consumes. */
  mcp: z.array(z.string().max(300)).default([]),
  /** HTTP API endpoints this finch exposes or consumes. */
  api: z.array(z.string().max(300)).default([]),
});

export const finchManifestSchema = z.object({
  schema: z.literal("finch.manifest/0.1").default("finch.manifest/0.1"),
  identity: identitySchema,
  model: modelRefSchema,
  /** Publisher wallet — the identity that registers this finch onchain. */
  publisher: addressSchema.optional(),
  /** Chains this finch understands. Robinhood (4663) first. */
  supportedChains: z.array(z.number().int().positive()).default([4663]),
  endpoints: endpointsSchema.default({ mcp: [], api: [] }),
  /** JSON Schemas for structured composition (finch→finch, nest→nest). */
  io: z
    .object({
      input: z.record(z.unknown()).optional(),
      output: z.record(z.unknown()).optional(),
    })
    .optional(),
  sourceRepository: z.string().max(300).optional(),
  metadataUri: z.string().max(300).optional(),
  memory: memoryConfigSchema.default({ kind: "none" }),
  tools: toolsConfigSchema.default({ flightpath: [], services: [] }),
  permissions: permissionsSchema.default({ allowWrites: false, rwaApprovedOnly: true }),
  wallet: walletConfigSchema.default({ mode: "none", allowances: [], allowedContracts: [] }),
  triggers: z.array(triggerSchema).default([{ kind: "manual" }]),
  budget: budgetSchema.default({}),
  deployment: deploymentSchema.default({}),
  createdAt: z.string().datetime().optional(),
});

export type FinchIdentity = z.infer<typeof identitySchema>;
export type FinchModelRef = z.infer<typeof modelRefSchema>;
export type FinchMemoryConfig = z.infer<typeof memoryConfigSchema>;
export type FinchToolsConfig = z.infer<typeof toolsConfigSchema>;
export type FinchPermissions = z.infer<typeof permissionsSchema>;
export type FinchAllowance = z.infer<typeof allowanceSchema>;
export type FinchWalletConfig = z.infer<typeof walletConfigSchema>;
export type FinchTrigger = z.infer<typeof triggerSchema>;
export type FinchBudget = z.infer<typeof budgetSchema>;
export type FinchDeployment = z.infer<typeof deploymentSchema>;
export type FinchManifest = z.infer<typeof finchManifestSchema>;
/** Pre-parse shape: fields with schema defaults may be omitted. */
export type FinchManifestInput = z.input<typeof finchManifestSchema>;

export function validateManifest(candidate: unknown): FinchManifest {
  return finchManifestSchema.parse(candidate);
}

export function safeValidateManifest(candidate: unknown):
  | { ok: true; manifest: FinchManifest }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const result = finchManifestSchema.safeParse(candidate);
  if (result.success) return { ok: true, manifest: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}
