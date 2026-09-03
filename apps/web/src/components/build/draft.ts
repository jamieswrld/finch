import { FLIGHTPATH_TOOLS } from "@finch/flightpath";

/**
 * UI draft state for the Nest Builder. `toManifestCandidate` converts it into
 * a candidate FinchManifest; @finch/sdk's schema is the single validator —
 * the builder never invents its own rules.
 */

export interface FinchDraft {
  identity: {
    name: string;
    handle: string;
    handleTouched: boolean;
    description: string;
    instructions: string;
    glyph: string;
  };
  model: {
    provider: "hyperbolic" | "openai-compatible";
    model: string;
    customModel: string;
    temperature: number;
    maxTokens: number;
  };
  memory: {
    kind: "none" | "ephemeral" | "mongo-vector";
    namespace: string;
    retentionDays: number;
  };
  tools: {
    flightpath: string[];
    services: string[];
  };
  permissions: {
    approvalThreshold: number; // 0–100 (%)
    useApprovalThreshold: boolean;
  };
  wallet: {
    mode: "none" | "observer" | "operator";
    nativePerDay: string;
    nativePerTx: string;
    allowedContracts: string;
    allowedRecipients: string;
  };
  triggers: {
    cronEnabled: boolean;
    cronSchedule: string;
    webhookEnabled: boolean;
    webhookSlug: string;
  };
  budget: {
    maxActionsPerDay: number;
    maxComputeCreditsPerDay: number;
    maxToolStepsPerRun: number;
    maxConsecutiveFailures: number;
  };
  deployment: {
    runtime: "self-hosted" | "finch-cloud";
  };
}

export function defaultDraft(): FinchDraft {
  return {
    identity: { name: "", handle: "", handleTouched: false, description: "", instructions: "", glyph: "finch-01" },
    model: {
      provider: "hyperbolic",
      model: "meta-llama/Llama-3.3-70B-Instruct",
      customModel: "",
      temperature: 0.3,
      maxTokens: 2048,
    },
    memory: { kind: "ephemeral", namespace: "", retentionDays: 90 },
    tools: { flightpath: ["balance_native", "token_data", "portfolio_snapshot"], services: [] },
    permissions: { approvalThreshold: 50, useApprovalThreshold: true },
    wallet: { mode: "observer", nativePerDay: "0.25", nativePerTx: "0.1", allowedContracts: "", allowedRecipients: "" },
    triggers: { cronEnabled: false, cronSchedule: "*/15 * * * *", webhookEnabled: false, webhookSlug: "" },
    budget: { maxActionsPerDay: 96, maxComputeCreditsPerDay: 500, maxToolStepsPerRun: 8, maxConsecutiveFailures: 5 },
    deployment: { runtime: "self-hosted" },
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function parseAddressLines(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function toManifestCandidate(draft: FinchDraft): Record<string, unknown> {
  const model = draft.model.provider === "openai-compatible" ? draft.model.customModel : draft.model.model;
  const writesAllowed = draft.wallet.mode === "operator";
  const triggers: Array<Record<string, unknown>> = [{ kind: "manual" }];
  if (draft.triggers.cronEnabled) triggers.push({ kind: "cron", schedule: draft.triggers.cronSchedule });
  if (draft.triggers.webhookEnabled) triggers.push({ kind: "webhook", slug: draft.triggers.webhookSlug });

  const recipients = parseAddressLines(draft.wallet.allowedRecipients);

  return {
    schema: "finch.manifest/0.1",
    identity: {
      name: draft.identity.name,
      handle: draft.identity.handle,
      description: draft.identity.description,
      instructions: draft.identity.instructions,
      glyph: draft.identity.glyph,
    },
    model: {
      provider: draft.model.provider,
      model,
      temperature: draft.model.temperature,
      maxTokens: draft.model.maxTokens,
    },
    memory:
      draft.memory.kind === "mongo-vector"
        ? { kind: "mongo-vector", namespace: draft.memory.namespace || draft.identity.handle, retentionDays: draft.memory.retentionDays }
        : draft.memory.kind === "ephemeral"
          ? { kind: "ephemeral", maxItems: 64 }
          : { kind: "none" },
    tools: {
      flightpath: draft.tools.flightpath,
      services: draft.tools.services.map((slug) => ({ slug })),
    },
    permissions: {
      allowWrites: writesAllowed,
      approvalThreshold: draft.permissions.useApprovalThreshold ? draft.permissions.approvalThreshold / 100 : undefined,
      rwaApprovedOnly: true,
    },
    wallet: {
      mode: draft.wallet.mode,
      allowances:
        draft.wallet.mode === "operator"
          ? [{ asset: "native", perDay: draft.wallet.nativePerDay, perTx: draft.wallet.nativePerTx || undefined }]
          : [],
      allowedContracts: draft.wallet.mode === "operator" ? parseAddressLines(draft.wallet.allowedContracts) : [],
      allowedRecipients: draft.wallet.mode === "operator" && recipients.length > 0 ? recipients : undefined,
    },
    triggers,
    budget: {
      maxActionsPerDay: draft.budget.maxActionsPerDay,
      maxComputeCreditsPerDay: draft.budget.maxComputeCreditsPerDay,
      maxToolStepsPerRun: draft.budget.maxToolStepsPerRun,
      killSwitch: { maxConsecutiveFailures: draft.budget.maxConsecutiveFailures },
    },
    deployment: { runtime: draft.deployment.runtime, status: "draft" },
    createdAt: new Date().toISOString(),
  };
}

export const SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "model", label: "Model" },
  { id: "memory", label: "Memory" },
  { id: "tools", label: "Tools" },
  { id: "permissions", label: "Permissions" },
  { id: "wallet", label: "Wallet" },
  { id: "triggers", label: "Triggers" },
  { id: "budget", label: "Budget" },
  { id: "deployment", label: "Deployment" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function sectionComplete(draft: FinchDraft, section: SectionId): boolean {
  switch (section) {
    case "identity":
      return draft.identity.name.length >= 2 && draft.identity.handle.length >= 2;
    case "model":
      return draft.model.provider === "hyperbolic" ? draft.model.model.length > 0 : draft.model.customModel.length > 0;
    case "memory":
      return draft.memory.kind !== "mongo-vector" || (draft.memory.namespace || draft.identity.handle).length > 0;
    case "tools":
      return draft.tools.flightpath.length + draft.tools.services.length > 0;
    case "permissions":
      return true;
    case "wallet":
      return draft.wallet.mode !== "operator" || Number(draft.wallet.nativePerDay) > 0;
    case "triggers":
      return (!draft.triggers.cronEnabled || draft.triggers.cronSchedule.length >= 9) &&
        (!draft.triggers.webhookEnabled || draft.triggers.webhookSlug.length > 0);
    case "budget":
      return draft.budget.maxActionsPerDay > 0;
    case "deployment":
      return true;
  }
}

export const WRITE_TOOL_NAMES = new Set(FLIGHTPATH_TOOLS.filter((tool) => tool.mode === "write").map((tool) => tool.name));
