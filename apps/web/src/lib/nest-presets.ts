import { nestManifestSchema, type NestFinch, type NestManifest } from "@finch/sdk";

/**
 * Preset nests — real, runnable coordinated swarms.
 *
 * Each member is a genuine finch manifest executed by the standard runtime,
 * and each nest runs in PREVIEW mode: read-only, no wallet, no writes. The
 * Chain Intelligence nest reads Robinhood Chain 4663 live, so its output is
 * actual onchain state rather than a scripted demo.
 */

const MODEL = { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct" };

const HONESTY =
  "\nYou run in PREVIEW mode: read-only, no wallet, no transactions. Report tool results exactly — " +
  "if a tool reports something unconfigured, unreachable or empty, say so plainly. Never invent chain " +
  "state, prices, holders, or liquidity. Be concise and structured; downstream finches consume your output.";

function member(input: {
  handle: string;
  name: string;
  role: string;
  instructions: string;
  tools: string[];
  temperature?: number;
}): NestFinch {
  return {
    handle: input.handle,
    name: input.name,
    role: input.role,
    manifest: {
      schema: "finch.manifest/0.1",
      identity: {
        name: input.name,
        handle: input.handle,
        description: input.role,
        instructions: input.instructions + HONESTY,
        glyph: "finch-01",
      },
      model: { ...MODEL, temperature: input.temperature ?? 0.2, maxTokens: 1100 },
      memory: { kind: "none" },
      tools: { flightpath: input.tools, services: [] },
      permissions: { allowWrites: false, rwaApprovedOnly: true },
      wallet: { mode: "observer", allowances: [], allowedContracts: [] },
      triggers: [{ kind: "manual" }],
      budget: { maxActionsPerDay: 500, maxComputeCreditsPerDay: 500, maxToolStepsPerRun: 5, killSwitch: { maxConsecutiveFailures: 3 } },
      deployment: { runtime: "self-hosted", status: "draft" },
      supportedChains: [4663],
      endpoints: { mcp: [], api: [] },
    },
  } as NestFinch;
}

function nest(input: {
  id: string;
  name: string;
  objective: string;
  description: string;
  coordinatorInstructions: string;
  finches: NestFinch[];
  tasks: NestManifest["tasks"];
}): NestManifest {
  return nestManifestSchema.parse({
    schema: "nest.manifest/0.1",
    identity: { id: input.id, name: input.name, objective: input.objective, description: input.description },
    coordinator: { model: { ...MODEL, temperature: 0.2 }, instructions: input.coordinatorInstructions, synthesize: true },
    finches: input.finches,
    tasks: input.tasks,
    executionPolicy: { mode: "preview", maxParallel: 3, maxTotalTokens: 120_000, maxTaskFailures: 2, taskTimeoutMs: 120_000 },
  });
}

// ── 1. Chain Intelligence — reads Robinhood Chain 4663 for real ───────────

const chainIntelligence = nest({
  id: "chain-intelligence",
  name: "Chain Intelligence Nest",
  objective: "Assess the current state and health of Robinhood Chain, and explain what it means for agents executing there.",
  description: "Live chain telemetry → block analysis → throughput/cost reading → operational risk → briefing.",
  coordinatorInstructions:
    "Produce an operator's briefing on Robinhood Chain conditions right now. Lead with the concrete numbers the finches read.",
  finches: [
    member({
      handle: "network-scout",
      name: "Network Scout",
      role: "Reads live chain status: head block, gas, block time, throughput.",
      instructions:
        "You are Network Scout. Call network_status and report the live figures for Robinhood Chain (id 4663, Arbitrum Nitro): head block, block age, block time, gas price in gwei, transactions in the latest block, RPC latency. Present the raw numbers first, then one line of interpretation.",
      tools: ["network_status"],
    }),
    member({
      handle: "block-analyst",
      name: "Block Analyst",
      role: "Profiles recent blocks for utilization and activity.",
      instructions:
        "You are Block Analyst. Use block_read on the latest block, then on an earlier block (subtract ~50 from the head block number you are given) to compare. Report gas utilization (gasUsed/gasLimit), transaction counts, and whether the chain looks congested or idle. Show your arithmetic.",
      tools: ["block_read", "network_status"],
    }),
    member({
      handle: "cost-analyst",
      name: "Cost Analyst",
      role: "Translates gas conditions into agent execution economics.",
      instructions:
        "You are Cost Analyst. Given the network figures, compute what a simple agent action costs right now: a native transfer (~21,000 gas) and a typical ERC20 transfer (~65,000 gas) at the reported gas price. Show gas x price in ETH. State clearly that these are estimates from the current base fee, not quotes.",
      tools: ["network_status"],
    }),
    member({
      handle: "risk-finch",
      name: "Risk Finch",
      role: "Flags operational risk for agents executing under these conditions.",
      instructions:
        "You are Risk Finch. Given the chain status, block profile and cost reading, list the operational risks for an autonomous agent executing on this chain right now (fee volatility, congestion, reorg/finality considerations for an Arbitrum Nitro L2, RPC dependency). Rank them and state what an execution policy should cap.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    {
      id: "t1",
      finch: "network-scout",
      title: "Read live chain status",
      instruction: "Report the current live status of Robinhood Chain.",
      dependsOn: [],
      outputChannel: "chain.status",
    },
    {
      id: "t2",
      finch: "block-analyst",
      title: "Profile block utilization",
      instruction: "Here is the current chain status:\n{{chain.status}}\n\nProfile recent block utilization and activity.",
      dependsOn: ["t1"],
      outputChannel: "block.profile",
    },
    {
      id: "t3",
      finch: "cost-analyst",
      title: "Compute agent execution costs",
      instruction: "Current chain status:\n{{chain.status}}\n\nCompute what common agent actions cost right now.",
      dependsOn: ["t1"],
      outputChannel: "cost.profile",
    },
    {
      id: "t4",
      finch: "risk-finch",
      title: "Assess operational risk",
      instruction:
        "Chain status:\n{{chain.status}}\n\nBlock profile:\n{{block.profile}}\n\nCost profile:\n{{cost.profile}}\n\nAssess operational risk for agents executing here.",
      dependsOn: ["t2", "t3"],
      outputChannel: "risk.assessment",
    },
  ],
});

// ── 2. Pons Intelligence ──────────────────────────────────────────────────

const ponsIntelligence = nest({
  id: "pons-intelligence",
  name: "Pons Intelligence Nest",
  objective: "Monitor new Pons launches, analyze their structure, liquidity and activity, and alert when they match criteria.",
  description: "Pons status → launch structure → holder/liquidity reading → risk → alert.",
  coordinatorInstructions:
    "Report the nest's readiness and findings. If Pons contracts are not yet configured, say exactly that and describe the methodology that activates on publication — do not imply live launch data exists.",
  finches: [
    member({
      handle: "pons-scout",
      name: "Pons Scout",
      role: "Checks Pons integration status and launch surface.",
      instructions:
        "You are Pons Scout. Call pons_status and report whether the Pons integration is configured. State Finch's creator tax (3% / 300 bps) and that Pons protocol fees are separate and not Finch revenue. If unconfigured, say plainly that no live launch data is available yet and list exactly which parameters are missing.",
      tools: ["pons_status", "pons_creator_tax"],
    }),
    member({
      handle: "structure-analyst",
      name: "Structure Analyst",
      role: "Reads token structure for a launch candidate.",
      instructions:
        "You are Structure Analyst. If a token address is provided in the objective, call token_data on it and report name, symbol, decimals and total supply. If none is provided or Pons is unconfigured, describe precisely which structural signals you would read (supply concentration, mint authority, transfer restrictions) and which tool call each requires.",
      tools: ["token_data", "contract_read"],
    }),
    member({
      handle: "liquidity-analyst",
      name: "Liquidity Analyst",
      role: "Assesses liquidity depth and lock structure.",
      instructions:
        "You are Liquidity Analyst. Describe the liquidity profile you can establish from available reads, and state clearly which liquidity facts require the Pons contracts that are not yet published. Never estimate depth you cannot read.",
      tools: ["token_data", "contract_read"],
    }),
    member({
      handle: "risk-finch",
      name: "Risk Finch",
      role: "Scores launch risk and can veto an alert.",
      instructions:
        "You are Risk Finch. From the structure and liquidity findings, produce a risk assessment with an explicit confidence level. If the inputs are mostly 'unavailable', your verdict must be INSUFFICIENT DATA rather than a risk score.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    { id: "t1", finch: "pons-scout", title: "Check Pons integration", instruction: "Report Pons integration status and Finch's creator-tax configuration.", dependsOn: [], outputChannel: "pons.status" },
    { id: "t2", finch: "structure-analyst", title: "Analyze launch structure", instruction: "Pons status:\n{{pons.status}}\n\nAnalyze token structure for the objective's target, or state what you would read.", dependsOn: ["t1"], outputChannel: "launch.structure" },
    { id: "t3", finch: "liquidity-analyst", title: "Profile liquidity", instruction: "Pons status:\n{{pons.status}}\n\nProfile liquidity for the objective's target, or state what remains unavailable.", dependsOn: ["t1"], outputChannel: "liquidity.profile" },
    { id: "t4", finch: "risk-finch", title: "Score risk", instruction: "Structure:\n{{launch.structure}}\n\nLiquidity:\n{{liquidity.profile}}\n\nProduce the risk verdict.", dependsOn: ["t2", "t3"], outputChannel: "risk.score" },
  ],
});

// ── 3. RWA Research ───────────────────────────────────────────────────────

const rwaResearch = nest({
  id: "rwa-research",
  name: "RWA Research Nest",
  objective: "Research tokenized real-world assets available to agents on Robinhood Chain and report what is approved and why.",
  description: "Approved registry → asset structure → eligibility and restrictions → risk → report.",
  coordinatorInstructions:
    "Report what the approved RWA registry actually contains. If it is empty, state that no assets are approved for agent interaction yet and explain the gate.",
  finches: [
    member({
      handle: "registry-scout",
      name: "Registry Scout",
      role: "Lists RWA assets approved for agent interaction.",
      instructions:
        "You are Registry Scout. Call rwa_registry and report exactly what it returns, including an empty registry. Explain that Finch hard-limits agent RWA interaction to this approved registry and that the gate cannot be waived from a manifest.",
      tools: ["rwa_registry"],
    }),
    member({
      handle: "asset-analyst",
      name: "Asset Analyst",
      role: "Reads structure of approved assets.",
      instructions:
        "You are Asset Analyst. For each approved asset (if any), call token_data and report its structure. If the registry is empty, describe the reads you would perform and what issuer restrictions typically constrain.",
      tools: ["rwa_registry", "token_data", "contract_read"],
    }),
    member({
      handle: "eligibility-finch",
      name: "Eligibility Finch",
      role: "Explains permissioning and agent eligibility.",
      instructions:
        "You are Eligibility Finch. Explain how permissioned RWA rails interact with autonomous agents: identified counterparties, transfer restrictions, jurisdiction gates, and what an agent must prove before touching such an asset. Ground every claim in what the registry actually reports.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    { id: "t1", finch: "registry-scout", title: "Read approved registry", instruction: "Report the approved RWA registry contents.", dependsOn: [], outputChannel: "rwa.registry" },
    { id: "t2", finch: "asset-analyst", title: "Analyze asset structure", instruction: "Registry:\n{{rwa.registry}}\n\nAnalyze the structure of approved assets.", dependsOn: ["t1"], outputChannel: "asset.profile" },
    { id: "t3", finch: "eligibility-finch", title: "Explain eligibility", instruction: "Registry:\n{{rwa.registry}}\n\nAssets:\n{{asset.profile}}\n\nExplain agent eligibility and restrictions.", dependsOn: ["t2"], outputChannel: "eligibility.notes" },
  ],
});

// ── 4. Address Watch ──────────────────────────────────────────────────────

const addressWatch = nest({
  id: "address-watch",
  name: "Address Watch Nest",
  objective: "Profile an address on Robinhood Chain and describe what a monitoring policy over it should watch.",
  description: "Balance read → holdings profile → activity context → monitoring policy.",
  coordinatorInstructions:
    "Produce a monitoring brief for the address in the objective. If no address was supplied, say so and explain what the nest needs.",
  finches: [
    member({
      handle: "balance-scout",
      name: "Balance Scout",
      role: "Reads native and token balances for an address.",
      instructions:
        "You are Balance Scout. Extract the 0x address from the objective. Call balance_native on it, and portfolio_snapshot if token addresses were given. Report exact balances with units. If no valid address is present, say so and stop — do not invent one.",
      tools: ["balance_native", "balance_erc20", "portfolio_snapshot"],
    }),
    member({
      handle: "context-finch",
      name: "Context Finch",
      role: "Places the address in current chain conditions.",
      instructions:
        "You are Context Finch. Call network_status and relate the address's holdings to current chain conditions: how many typical actions its native balance funds at the current gas price. Show the arithmetic.",
      tools: ["network_status"],
    }),
    member({
      handle: "policy-finch",
      name: "Policy Finch",
      role: "Drafts the monitoring and execution policy.",
      instructions:
        "You are Policy Finch. From the balance and context findings, draft a concrete monitoring policy: which balance deltas warrant an alert, sensible daily/per-transaction allowance caps if an agent were to operate this address, and which contracts an allowlist should contain. Express caps as numbers.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    { id: "t1", finch: "balance-scout", title: "Read balances", instruction: "Read balances for the address in the objective.", dependsOn: [], outputChannel: "address.balances" },
    { id: "t2", finch: "context-finch", title: "Contextualize", instruction: "Balances:\n{{address.balances}}\n\nRelate these to current chain conditions.", dependsOn: ["t1"], outputChannel: "address.context" },
    { id: "t3", finch: "policy-finch", title: "Draft monitoring policy", instruction: "Balances:\n{{address.balances}}\n\nContext:\n{{address.context}}\n\nDraft the monitoring and execution policy.", dependsOn: ["t2"], outputChannel: "policy.draft" },
  ],
});

export const NEST_PRESETS: NestManifest[] = [chainIntelligence, ponsIntelligence, rwaResearch, addressWatch];

export function getNestPreset(id: string): NestManifest | undefined {
  return NEST_PRESETS.find((preset) => preset.identity.id === id);
}
