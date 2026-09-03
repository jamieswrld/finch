import type { ModelProvider, ModelRef } from "@finch/providers";
import { resolveModel } from "@finch/providers";
import {
  finchManifestSchema,
  type FinchAllowance,
  type FinchBudget,
  type FinchManifest,
  type FinchManifestInput,
  type FinchMemoryConfig,
  type FinchTrigger,
  type FinchWalletConfig,
} from "./manifest.ts";
import type { MemoryAdapter } from "./memory.ts";
import { Nest, type HatchOptions } from "./runtime.ts";

/**
 * The Finch builder. The whole SDK promise in one chain:
 *
 *   const nest = await createFinch("market-watcher")
 *     .model(hyperbolic("meta-llama/Llama-3.3-70B-Instruct"))
 *     .memory({ kind: "ephemeral" })
 *     .tools("balance_native", "token_data", "portfolio_snapshot")
 *     .wallet({ mode: "observer" })
 *     .hatch();
 */

export interface WalletInput {
  mode: FinchWalletConfig["mode"];
  /** e.g. [{ asset: "native", perDay: "0.25" }] in human units. */
  allowances?: FinchAllowance[];
  allowedContracts?: string[];
  allowedRecipients?: string[];
  approvalThreshold?: number;
}

export class FinchBuilder {
  private draft: Record<string, unknown>;
  private providerInstance?: ModelProvider;
  private memoryAdapter?: MemoryAdapter;

  constructor(name: string) {
    const handle = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    this.draft = {
      identity: { name, handle: handle || "finch", description: "", instructions: "", glyph: "finch-01" },
      tools: { flightpath: [], services: [] },
      permissions: { allowWrites: false, rwaApprovedOnly: true },
      wallet: { mode: "none", allowances: [], allowedContracts: [] },
      triggers: [{ kind: "manual" }],
    };
  }

  describe(description: string): this {
    (this.draft.identity as Record<string, unknown>).description = description;
    return this;
  }

  instructions(instructions: string): this {
    (this.draft.identity as Record<string, unknown>).instructions = instructions;
    return this;
  }

  /** Attach a model — a live provider instance or a serializable ref. */
  model(provider: ModelProvider | ModelRef, options?: { temperature?: number; maxTokens?: number }): this {
    if ("chat" in provider) {
      this.providerInstance = provider;
      this.draft.model = {
        provider: provider.info.provider,
        model: provider.info.model,
        ...options,
      };
    } else {
      this.draft.model = { ...provider, ...options };
    }
    return this;
  }

  /** Attach memory — serializable config, or a live adapter (implies ephemeral config). */
  memory(memory: FinchMemoryConfig | MemoryAdapter): this {
    if ("recall" in memory) {
      this.memoryAdapter = memory;
      this.draft.memory = { kind: "ephemeral", maxItems: 64 };
    } else {
      this.draft.memory = memory;
    }
    return this;
  }

  /** Attach Flightpath tools by name (see FLIGHTPATH_TOOLS in @finch/flightpath). */
  tools(...names: string[]): this {
    const tools = this.draft.tools as { flightpath: string[]; services: unknown[] };
    tools.flightpath = [...new Set([...tools.flightpath, ...names])];
    return this;
  }

  /** Attach an Aviary service by listing slug. */
  service(slug: string, version?: string): this {
    const tools = this.draft.tools as { flightpath: string[]; services: Array<{ slug: string; version?: string }> };
    tools.services.push({ slug, version });
    return this;
  }

  /** Configure Robinhood wallet permissions — mode, allowances, allowlists. */
  wallet(input: WalletInput): this {
    this.draft.wallet = {
      mode: input.mode,
      allowances: input.allowances ?? [],
      allowedContracts: input.allowedContracts ?? [],
      allowedRecipients: input.allowedRecipients,
    };
    const permissions = this.draft.permissions as Record<string, unknown>;
    permissions.allowWrites = input.mode === "operator";
    if (input.approvalThreshold !== undefined) permissions.approvalThreshold = input.approvalThreshold;
    return this;
  }

  trigger(trigger: FinchTrigger): this {
    const triggers = this.draft.triggers as FinchTrigger[];
    if (triggers.length === 1 && triggers[0]?.kind === "manual" && trigger.kind !== "manual") {
      this.draft.triggers = [trigger];
    } else {
      triggers.push(trigger);
    }
    return this;
  }

  budget(budget: Partial<FinchBudget>): this {
    this.draft.budget = { ...(this.draft.budget as object | undefined), ...budget };
    return this;
  }

  /** Validate and return the serializable manifest (what the Nest Builder UI emits). */
  manifest(): FinchManifest {
    return finchManifestSchema.parse({ ...this.draft, createdAt: new Date().toISOString() });
  }

  /**
   * Hatch: validate the manifest, resolve infrastructure, return a live Nest.
   * Missing pieces fail loudly here — never silently downgrade.
   */
  async hatch(options: Partial<HatchOptions> = {}): Promise<Nest> {
    const manifest = this.manifest();
    const provider =
      options.provider ??
      this.providerInstance ??
      resolveModel({ provider: manifest.model.provider, model: manifest.model.model });
    return Nest.hatch(manifest, {
      ...options,
      provider,
      memory: options.memory ?? this.memoryAdapter,
    });
  }
}

export function createFinch(name: string): FinchBuilder {
  return new FinchBuilder(name);
}

/** Hatch directly from a stored manifest (what the platform runtime does). */
export async function hatchFromManifest(manifest: FinchManifest | FinchManifestInput, options: HatchOptions): Promise<Nest> {
  return Nest.hatch(finchManifestSchema.parse(manifest), options);
}
