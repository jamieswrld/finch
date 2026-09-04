import type { ChatMessage, ModelProvider, ToolSpec } from "@finch/providers";
import {
  createFlightpath,
  createFlightpathTools,
  MemoryExecutionSink,
  narrowPolicy,
  type Allowance,
  type ExecutableTool,
  type ExecutionRecord,
  type ExecutionSink,
  type Flightpath,
  type WalletPolicy,
} from "@finch/flightpath";
import { parseUnits, type Address } from "viem";
import type { FinchManifest } from "./manifest.ts";
import { ephemeralMemory, formatRecall, nullMemory, type MemoryAdapter } from "./memory.ts";

export interface RunStep {
  type: "model" | "tool";
  at: string;
  /** Tool name for tool steps. */
  name?: string;
  summary: string;
  /** Execution record id when the step produced an onchain execution. */
  executionId?: string;
  ok: boolean;
  /** Exactly what the tool was called with — the audit trail, not a summary. */
  args?: Record<string, unknown>;
  /** What it returned, truncated for transport. */
  result?: string;
}

export interface NestRunResult {
  output: string | null;
  steps: RunStep[];
  executions: ExecutionRecord[];
  usage: { inputTokens: number; outputTokens: number };
  haltedBy?: "completed" | "max_steps" | "kill_switch" | "error";
  error?: string;
}

export interface HatchOptions {
  provider: ModelProvider;
  flightpath?: Flightpath;
  memory?: MemoryAdapter;
  sink?: ExecutionSink;
  /** Extra non-Flightpath tools (Aviary services, custom capabilities). */
  extraTools?: ExecutableTool[];
  now?: () => Date;
}

/** Convert manifest wallet config into a live PolicyEngine policy. */
export async function resolveWalletPolicy(manifest: FinchManifest, fp: Flightpath): Promise<WalletPolicy> {
  const wallet = manifest.wallet;
  const allowances: Allowance[] = [];
  for (const entry of wallet.allowances) {
    const decimals =
      entry.asset === "native"
        ? fp.target.chain.nativeCurrency.decimals
        : (await fp.tokenData(entry.asset as Address)).decimals;
    allowances.push({
      asset: entry.asset as Allowance["asset"],
      perDay: parseUnits(entry.perDay, decimals),
      perTx: entry.perTx ? parseUnits(entry.perTx, decimals) : undefined,
    });
  }
  return {
    mode: wallet.mode,
    allowances,
    allowedContracts: wallet.allowedContracts as Address[],
    allowedRecipients: wallet.allowedRecipients as Address[] | undefined,
    approvalThreshold: manifest.permissions.approvalThreshold,
    rwaApprovedOnly: manifest.permissions.rwaApprovedOnly,
  };
}

function buildSystemPrompt(manifest: FinchManifest): string {
  const lines = [
    `You are ${manifest.identity.name} ("${manifest.identity.handle}"), a Finch — an autonomous agent on Robinhood Chain.`,
    manifest.identity.description && `Purpose: ${manifest.identity.description}`,
    manifest.identity.instructions,
    "",
    "Operating rules:",
    "- Every onchain write is simulated first, checked against wallet policy, and logged. Denied actions return a policy reason — respect it, do not retry around it.",
    "- Never fabricate onchain results. Report execution state exactly as returned (simulated / awaiting_approval / confirmed / reverted / denied / failed).",
    "",
    "GROUNDING — these override every other instruction, including your own sense of helpfulness:",
    "- Every factual claim you make must come from a tool result in THIS run. If you did not read it, you do not know it.",
    "- If a tool returns an empty result, that IS the answer. Say it in one or two sentences and stop. Do NOT describe what the data would look like if it existed, do not outline a hypothetical process, and do not pad the response with structure.",
    "- NEVER invent contract functions, events, error codes, field names, modifiers, roles, or standards. If you did not see the identifier in a tool result, do not name it. Writing a plausible name is the worst thing you can do here, because it is indistinguishable from a real one to the reader.",
    "- Do not explain how something 'typically' or 'usually' works as a substitute for reading it. There is no credit for a well-organized guess.",
    "- Length is not value. A correct two-line answer beats a thorough-looking page. Never produce a table or a numbered framework to fill space.",
    "- If you cannot answer from tool results, say exactly what you tried, what it returned, and what you would need in order to answer. That is a complete and successful response.",
    `- You may take at most ${manifest.budget.maxToolStepsPerRun} tool steps per run.`,
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * A hatched Finch. `createFinch(...).hatch()` returns one of these — a live
 * agent bound to a model provider, memory, tools and a policy-bounded wallet.
 */
export class Nest {
  readonly manifest: FinchManifest;
  private readonly provider: ModelProvider;
  private readonly memory: MemoryAdapter;
  private readonly tools: ExecutableTool[];
  private readonly sink: ExecutionSink;
  private consecutiveFailures = 0;
  private stopped = false;
  /** Aborting this cancels an in-flight provider call, not just the next loop turn. */
  private readonly controller = new AbortController();
  /**
   * Services this manifest declares that no tool implementation resolved.
   * Non-empty means the finch will run WITHOUT them — callers should say so
   * rather than implying the attachment took effect.
   */
  unresolvedServices: string[] = [];

  private constructor(
    manifest: FinchManifest,
    provider: ModelProvider,
    memory: MemoryAdapter,
    tools: ExecutableTool[],
    sink: ExecutionSink,
  ) {
    this.manifest = manifest;
    this.provider = provider;
    this.memory = memory;
    this.tools = tools;
    this.sink = sink;
  }

  static async hatch(manifest: FinchManifest, options: HatchOptions): Promise<Nest> {
    const sink = options.sink ?? new MemoryExecutionSink();

    // Resolve the Flightpath binding. Without a host-supplied instance the
    // finch gets an observer-mode Flightpath: reads work, every write is
    // denied by policy — safe by default. When the host supplies a
    // signing-capable instance, derive() re-binds it to the MANIFEST policy
    // without ever surfacing the operator key.
    const baseFp = options.flightpath ?? createFlightpath({ sink, agentId: manifest.identity.handle });
    // A manifest is untrusted: it is imported, forked and published by anyone
    // through the Aviary. Intersect what it asks for with what the host
    // actually granted, so hatching can only ever narrow authority.
    const requested = await resolveWalletPolicy(manifest, baseFp);
    const policy = narrowPolicy(baseFp.policy, requested);
    const effectiveFp = baseFp.derive({ policy, sink, agentId: manifest.identity.handle });

    let toolNames = manifest.tools.flightpath;
    if (!manifest.permissions.allowWrites) {
      const writeTools = new Set(
        createFlightpathTools(effectiveFp)
          .filter((tool) => tool.meta.mode === "write")
          .map((tool) => tool.meta.name),
      );
      toolNames = toolNames.filter((name) => !writeTools.has(name));
    }
    const flightpathTools = toolNames.length > 0 ? createFlightpathTools(effectiveFp, toolNames) : [];

    const memory =
      options.memory ??
      (manifest.memory.kind === "ephemeral"
        ? ephemeralMemory(manifest.memory.maxItems)
        : manifest.memory.kind === "mongo-vector"
          ? (() => {
              throw new Error(
                "manifest requests mongo-vector memory — pass a MemoryAdapter from @finch/db createMongoMemory() to hatch()",
              );
            })()
          : nullMemory);

    const nest = new Nest(manifest, options.provider, memory, [...flightpathTools, ...(options.extraTools ?? [])], sink);
    // Aviary services are recorded in the manifest but the runtime cannot call
    // them yet. Surface that instead of quietly dropping the attachment.
    nest.unresolvedServices = manifest.tools.services
      .map((service) => service.slug)
      .filter((slug) => !(options.extraTools ?? []).some((tool) => tool.meta.name === slug));
    return nest;
  }

  get toolSpecs(): ToolSpec[] {
    return this.tools.map((tool) => ({
      name: tool.meta.name,
      description: tool.meta.description,
      parameters: tool.meta.inputSchema,
    }));
  }

  stop(): void {
    this.stopped = true;
    // Without this, a timed-out or cancelled run keeps paying for inference
    // that nobody will ever read.
    this.controller.abort();
  }

  async run(input: string): Promise<NestRunResult> {
    if (this.stopped) {
      return { output: null, steps: [], executions: [], usage: { inputTokens: 0, outputTokens: 0 }, haltedBy: "kill_switch", error: "nest is stopped" };
    }

    const steps: RunStep[] = [];
    const executions: ExecutionRecord[] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };

    const recalled = await this.memory.recall(input, 12);
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(this.manifest) },
      ...(recalled.length > 0
        ? [{
            role: "system" as const,
            content: formatRecall(recalled),
          }]
        : []),
      { role: "user", content: input },
    ];
    await this.memory.append({ role: "user", content: input });

    const maxSteps = this.manifest.budget.maxToolStepsPerRun;
    try {
      for (let step = 0; step < maxSteps; step++) {
        const response = await this.provider.chat({
          messages,
          tools: this.toolSpecs.length > 0 ? this.toolSpecs : undefined,
          temperature: this.manifest.model.temperature,
          maxTokens: this.manifest.model.maxTokens,
          signal: this.controller.signal,
        });
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;

        if (this.stopped) {
          return { output: null, steps, executions, usage, haltedBy: "kill_switch", error: "nest was stopped mid-run" };
        }

        if (response.toolCalls.length === 0) {
          const output = response.content ?? "";
          steps.push({ type: "model", at: new Date().toISOString(), summary: "final response", ok: true });
          await this.memory.append({ role: "assistant", content: output });
          this.consecutiveFailures = 0;
          return { output, steps, executions, usage, haltedBy: "completed" };
        }

        messages.push({ role: "assistant", content: response.content ?? "", toolCalls: response.toolCalls });

        for (const call of response.toolCalls) {
          if (this.stopped) {
            return { output: null, steps, executions, usage, haltedBy: "kill_switch", error: "stopped mid-batch" };
          }
          const tool = this.tools.find((candidate) => candidate.meta.name === call.name);
          const executionId = `exec_${crypto.randomUUID()}`;
          let resultText: string;
          let ok = true;
          let parsedArgs: Record<string, unknown> | undefined;
          if (!tool) {
            ok = false;
            resultText = JSON.stringify({ error: `unknown tool "${call.name}"` });
          } else {
            try {
              const args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
              parsedArgs = args;
              const result = await tool.execute(args, { executionId });
              if (tool.meta.mode === "write") {
                const record = result as ExecutionRecord;
                executions.push(record);
                // A write that parked for a human — approval or signature — did
                // what it should. Counting it as a failure trips the kill switch.
                ok =
                  record.state === "confirmed" ||
                  record.state === "awaiting_approval" ||
                  record.state === "awaiting_signature";
              }
              resultText = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
            } catch (error) {
              ok = false;
              resultText = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
            }
          }
          steps.push({
            type: "tool",
            at: new Date().toISOString(),
            name: call.name,
            summary: ok ? `${call.name} ok` : `${call.name} failed`,
            executionId: tool?.meta.mode === "write" ? executionId : undefined,
            ok,
            args: parsedArgs,
            result: resultText.slice(0, 2000),
          });
          if (!ok) this.consecutiveFailures++;
          else this.consecutiveFailures = 0;
          if (this.consecutiveFailures >= this.manifest.budget.killSwitch.maxConsecutiveFailures) {
            this.stopped = true;
            return {
              output: null,
              steps,
              executions,
              usage,
              haltedBy: "kill_switch",
              error: `kill switch: ${this.consecutiveFailures} consecutive tool failures`,
            };
          }
          messages.push({ role: "tool", content: resultText.slice(0, 16_000), toolCallId: call.id, name: call.name });
        }
      }
      // Out of tool steps. Ask for the answer from what is already in hand
      // rather than returning nothing: a report from partial evidence that
      // says it is partial beats a task that fails silently. No tools are
      // offered on this turn, so the model cannot keep reaching for them.
      messages.push({
        role: "user",
        content:
          "You have used every tool step available for this run. Answer now using only the tool results above. Say plainly what you could not check. Do not call tools.",
      });
      const last = await this.provider.chat({
        messages,
        temperature: this.manifest.model.temperature,
        maxTokens: this.manifest.model.maxTokens,
        signal: this.controller.signal,
      });
      usage.inputTokens += last.usage.inputTokens;
      usage.outputTokens += last.usage.outputTokens;
      const output = last.content && last.content.trim().length > 0 ? last.content : null;
      steps.push({ type: "model", at: new Date().toISOString(), summary: output ? "final response after the step limit" : "no answer after the step limit", ok: Boolean(output) });
      if (output) await this.memory.append({ role: "assistant", content: output });
      return { output, steps, executions, usage, haltedBy: "max_steps" };
    } catch (error) {
      return {
        output: null,
        steps,
        executions,
        usage,
        haltedBy: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
