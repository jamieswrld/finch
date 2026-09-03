/**
 * @finch/sdk — hatch autonomous agents on Robinhood Chain.
 *
 *   create Finch → add model → add memory → add tools →
 *   add Robinhood wallet permissions → hatch
 */

export { createFinch, hatchFromManifest, FinchBuilder, type WalletInput } from "./builder.ts";
export {
  nestExecutionPolicySchema,
  nestFinchSchema,
  nestManifestSchema,
  nestTaskSchema,
  resolveInstruction,
  runNest,
  safeValidateNestManifest,
  validateNestManifest,
  validateTaskGraph,
  type GraphIssue,
  type NestEvent,
  type NestFinch,
  type NestManifest,
  type NestManifestInput,
  type NestRunState,
  type NestRunStatus,
  type NestTask,
  type RunNestOptions,
  type TaskRecord,
  type TaskStatus,
} from "./nest.ts";
export { Nest, resolveWalletPolicy, type HatchOptions, type NestRunResult, type RunStep } from "./runtime.ts";
export { ephemeralMemory, nullMemory, type MemoryAdapter, type MemoryItem } from "./memory.ts";
export {
  addressSchema,
  allowanceSchema,
  budgetSchema,
  deploymentSchema,
  finchManifestSchema,
  identitySchema,
  memoryConfigSchema,
  modelRefSchema,
  permissionsSchema,
  safeValidateManifest,
  toolsConfigSchema,
  triggerSchema,
  validateManifest,
  walletConfigSchema,
  type FinchAllowance,
  type FinchBudget,
  type FinchDeployment,
  type FinchIdentity,
  type FinchManifest,
  type FinchManifestInput,
  type FinchMemoryConfig,
  type FinchModelRef,
  type FinchPermissions,
  type FinchTrigger,
  type FinchToolsConfig,
  type FinchWalletConfig,
} from "./manifest.ts";

// Convenience re-exports so `@finch/sdk` alone covers the common path.
export { hyperbolic, openAICompatible, resolveModel, HYPERBOLIC_MODELS } from "@finch/providers";
export type { ModelProvider, ModelRef } from "@finch/providers";
export { FLIGHTPATH_TOOLS, createFlightpath, createFlightpathTools, getFlightpathTarget } from "@finch/flightpath";
export type { ExecutionRecord, Flightpath, FlightpathToolMeta, WalletPolicy } from "@finch/flightpath";
