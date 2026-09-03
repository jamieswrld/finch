import type { NestDoc } from "@finch/db";
import { safeValidateNestManifest, type NestManifest } from "@finch/sdk";

/**
 * Lift a composed diagram into a real, runnable nest.manifest/0.1.
 *
 * The composer draws stages, nodes and channels. That drawing is not runnable
 * on its own — a nest needs each member to be a full finch manifest and each
 * task to carry an instruction. This fills those in from the drawing (role
 * becomes the finch's instructions, declared inputs become {{channel}}
 * references) and validates the result, so what you export is the same
 * document runNest() executes rather than a picture of one.
 */

const MODEL = { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct", temperature: 0.2, maxTokens: 1100 };

const HONESTY =
  "\nYou run in PREVIEW mode: read-only, no wallet, no transactions. Report tool results exactly — if something is " +
  "unconfigured, unreachable or empty, say so. Never invent chain state. Be concise and structured; downstream " +
  "finches consume your output.";

/** Map the composer's permission chips to read-only Flightpath tools. */
function toolsFor(permissions: string[]): string[] {
  const tools = new Set<string>();
  for (const permission of permissions) {
    if (permission.startsWith("read:prices") || permission.startsWith("read:portfolio")) {
      tools.add("portfolio_snapshot");
      tools.add("token_data");
    }
    if (permission.startsWith("read:chain")) {
      tools.add("network_status");
      tools.add("balance_native");
    }
    if (permission.startsWith("read:pons")) tools.add("pons_status");
    if (permission.startsWith("read:rwa")) tools.add("rwa_registry");
  }
  return [...tools];
}

export interface LiftResult {
  ok: boolean;
  manifest?: NestManifest;
  issues: Array<{ path: string; message: string }>;
  /** Things the drawing could not express, stated rather than silently filled. */
  notes: string[];
}

export function liftComposedNest(nest: NestDoc): LiftResult {
  const notes: string[] = [];
  const nodes = nest.stages.flatMap((stage) => stage.finches);

  if (nodes.length === 0) {
    return { ok: false, issues: [{ path: "stages", message: "a nest needs at least one finch" }], notes };
  }

  const finches = nodes.map((node) => {
    const tools = toolsFor(node.permissions);
    if (node.permissions.some((permission) => permission.startsWith("wallet:") || permission.startsWith("veto:"))) {
      notes.push(
        `"${node.name}" declares ${node.permissions.filter((p) => p.startsWith("wallet:") || p.startsWith("veto:")).join(", ")} — preview mode grants neither, so it is exported read-only.`,
      );
    }
    return {
      handle: node.handle,
      name: node.name,
      role: node.role,
      manifest: {
        schema: "finch.manifest/0.1" as const,
        identity: {
          name: node.name,
          handle: node.handle,
          description: node.role,
          instructions: (node.role || `You are ${node.name}.`) + HONESTY,
          glyph: "finch-01",
        },
        model: MODEL,
        memory: { kind: "none" as const },
        tools: { flightpath: tools, services: [] },
        permissions: { allowWrites: false, rwaApprovedOnly: true },
        wallet: { mode: "observer" as const, allowances: [], allowedContracts: [] },
        triggers: [{ kind: "manual" as const }],
        budget: {
          maxActionsPerDay: 500,
          maxComputeCreditsPerDay: 500,
          maxToolStepsPerRun: 5,
          killSwitch: { maxConsecutiveFailures: 3 },
        },
        deployment: { runtime: "self-hosted" as const, status: "draft" as const },
        supportedChains: [4663],
        endpoints: { mcp: [], api: [] },
      },
    };
  });

  // Each node becomes one task; its edges become dependencies, and the
  // upstream channels are interpolated into the instruction.
  const taskIdOf = new Map(nodes.map((node, index) => [node.handle, `t${index + 1}`]));
  const tasks = nodes.map((node) => {
    const incoming = nest.edges.filter((edge) => edge.to === node.handle);
    const dependsOn = incoming
      .map((edge) => taskIdOf.get(edge.from))
      .filter((id): id is string => Boolean(id));
    const channelRefs = incoming.map((edge) => `${edge.channel}:\n{{${edge.channel}}}`).join("\n\n");
    const outputChannel = node.outputs[0] ?? `${node.handle}.out`;
    if (node.outputs.length === 0) {
      notes.push(`"${node.name}" declared no output channel — defaulted to ${outputChannel}.`);
    }
    return {
      id: taskIdOf.get(node.handle) as string,
      finch: node.handle,
      title: node.role ? node.role.slice(0, 110) : node.name,
      instruction: channelRefs ? `${channelRefs}\n\nDo your part of the objective.` : "Do your part of the objective.",
      dependsOn,
      outputChannel,
    };
  });

  const candidate = {
    schema: "nest.manifest/0.1",
    identity: {
      id: nest.slug,
      name: nest.name,
      objective: nest.description || `Coordinate ${nodes.length} finches toward the objective of ${nest.name}.`,
      description: nest.description,
    },
    coordinator: {
      model: { provider: MODEL.provider, model: MODEL.model, temperature: 0.2 },
      instructions: "Synthesize the member outputs into one answer to the objective.",
      synthesize: true,
    },
    finches,
    tasks,
    executionPolicy: { mode: "preview", maxParallel: 3, maxTotalTokens: 120_000, maxTaskFailures: 2, taskTimeoutMs: 120_000 },
  };

  const validated = safeValidateNestManifest(candidate);
  if (!validated.ok) return { ok: false, issues: validated.issues, notes };
  return { ok: true, manifest: validated.manifest, issues: [], notes };
}
