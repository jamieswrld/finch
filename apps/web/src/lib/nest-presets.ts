import { nestManifestSchema, type NestFinch, type NestManifest } from "@finch/sdk";
import { SCHOOL_PRESETS } from "./school-presets";

/**
 * Preset nests — real, runnable coordinated swarms.
 *
 * Each member is a genuine finch manifest executed by the standard runtime,
 * and each nest runs in PREVIEW mode: read-only, no wallet, no writes. The
 * Chain Intelligence nest reads Solana mainnet live, so its output is
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
      wallet: { mode: "observer", allowances: [], allowedPrograms: [] },
      triggers: [{ kind: "manual" }],
      budget: { maxActionsPerDay: 500, maxComputeCreditsPerDay: 500, maxToolStepsPerRun: 6, killSwitch: { maxConsecutiveFailures: 3 } },
      deployment: { runtime: "self-hosted", status: "draft" },
      supportedChains: ["solana:mainnet"],
      endpoints: { mcp: [], api: [] },
    },
  } as NestFinch;
}

/**
 * A member drawn from the registry by handle — the same finch a visitor can
 * open and run in Flight School, composed into a nest unchanged. This is
 * what "a nest of everyone's finches" means in practice: the manifests are
 * shared, and the nest is just the coordination around them.
 */
function refMember(handle: string, role?: string): NestFinch {
  const preset = SCHOOL_PRESETS.find((entry) => entry.slug === handle);
  if (!preset) throw new Error(`refMember: no builtin finch "${handle}"`);
  return {
    handle,
    name: preset.title,
    role: role ?? preset.blurb,
    manifest: { ...preset.manifest, identity: { ...preset.manifest.identity, instructions: preset.manifest.identity.instructions + HONESTY } },
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
  /** Tool-heavy members on a free tier need longer than the default. */
  taskTimeoutMs?: number;
}): NestManifest {
  return nestManifestSchema.parse({
    schema: "nest.manifest/0.1",
    identity: { id: input.id, name: input.name, objective: input.objective, description: input.description },
    coordinator: { model: { ...MODEL, temperature: 0.2 }, instructions: input.coordinatorInstructions, synthesize: true },
    finches: input.finches,
    tasks: input.tasks,
    executionPolicy: { mode: "preview", maxParallel: 3, maxTotalTokens: 120_000, maxTaskFailures: 2, taskTimeoutMs: input.taskTimeoutMs ?? 120_000 },
  });
}

// ── 1. Chain Intelligence — reads Solana mainnet for real ─────────────────

const chainIntelligence = nest({
  id: "chain-intelligence",
  name: "Chain Intelligence Nest",
  objective: "Assess the current state and health of Solana, and explain what it means for agents executing there.",
  description: "Live network status → block analysis → fee reading → operational risk → briefing.",
  coordinatorInstructions:
    "Produce an operator's briefing on Solana conditions right now. Lead with the concrete numbers the finches read. Fee figures are estimates from what was read, not quotes — keep them labeled that way.",
  finches: [
    member({
      handle: "network-scout",
      name: "Network Scout",
      role: "Reads live network status: slot, epoch, throughput, fees.",
      instructions:
        "You are Network Scout. Call network_status and report the live figures for Solana: slot, block height, epoch and its progress, TPS and non-vote TPS, average slot time, fee per signature (in lamports and in SOL; 1 SOL = 1,000,000,000 lamports), recent priority fees (median, p75 and p95 in micro-lamports per compute unit), RPC latency and node version. Present the raw numbers first, then one line of interpretation.",
      tools: ["network_status"],
    }),
    member({
      handle: "block-analyst",
      name: "Block Analyst",
      role: "Compares the latest block with an earlier one for pace and activity.",
      instructions:
        "You are Block Analyst. Make exactly two tool calls: block_read with no slot (the latest block), then block_read with slot = that block's slot minus 150. Do not call any tool a third time. Then answer. For each block report slot, block time, transaction count and parent slot. Then compute the slots between them, the seconds between their block times, and the average seconds per slot (seconds ÷ slots), and compare the two transaction counts. Block times have one-second resolution, so say the slot-time figure is approximate. If the earlier slot was skipped (no block was produced there, which is normal on Solana), report it as skipped and work from the latest block alone. Show your arithmetic.",
      tools: ["block_read"],
    }),
    member({
      handle: "cost-analyst",
      name: "Cost Analyst",
      role: "Translates network fees into agent execution costs.",
      instructions:
        "You are Cost Analyst. From the network figures, compute what a SOL transfer costs right now. Its base cost is the fee per signature once (one signer): lamports ÷ 1,000,000,000 = SOL. A priority fee adds micro-lamports per compute unit × the compute-unit limit ÷ 1,000,000 lamports; compute it at the median and the p95 priority fee for a 1,000 compute-unit limit (a transfer that sets its limit tightly) and a 200,000 compute-unit limit (a typical program call). Show each result in lamports and in SOL, then the totals. Label every figure as an estimate from what network_status read, not a quote — the fee is fixed only when a transaction lands. If a figure was not read, say which and skip that line rather than assuming a value.",
      tools: ["network_status"],
    }),
    member({
      handle: "risk-finch",
      name: "Risk Finch",
      role: "Flags operational risk for agents executing under these conditions.",
      instructions:
        "You are Risk Finch. Given the network status, block profile and cost reading, list the operational risks for an autonomous agent executing on Solana right now: congestion and priority fees (without an adequate priority fee a transaction can be dropped when leaders are busy), blockhash expiry (a transaction is valid only for about 150 blocks after its recent blockhash, so a slow signature or a retry must rebuild it), confirmation versus finalization (confirmed means a supermajority voted on the block; finalized means it is rooted, typically around 32 slots later — an action must say which it waits for), and RPC dependency and rate limits (one endpoint can lag, throttle or fail; failover and backoff matter). Rank them using the figures that were read, and state what an execution policy should cap.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    {
      id: "t1",
      finch: "network-scout",
      title: "Read live network status",
      instruction: "Report the current live status of Solana.",
      dependsOn: [],
      outputChannel: "chain.status",
    },
    {
      id: "t2",
      finch: "block-analyst",
      title: "Profile recent blocks",
      instruction: "Here is the current network status:\n{{chain.status}}\n\nCompare the latest block with an earlier one: pace and activity.",
      dependsOn: ["t1"],
      outputChannel: "block.profile",
    },
    {
      id: "t3",
      finch: "cost-analyst",
      title: "Compute agent execution costs",
      instruction: "Current network status:\n{{chain.status}}\n\nCompute what a SOL transfer and a typical program call cost right now.",
      dependsOn: ["t1"],
      outputChannel: "cost.profile",
    },
    {
      id: "t4",
      finch: "risk-finch",
      title: "Assess operational risk",
      instruction:
        "Network status:\n{{chain.status}}\n\nBlock profile:\n{{block.profile}}\n\nCost profile:\n{{cost.profile}}\n\nAssess operational risk for agents executing here.",
      dependsOn: ["t2", "t3"],
      outputChannel: "risk.assessment",
    },
  ],
});

// ── 2. Launch Intelligence ────────────────────────────────────────────────

const launchIntelligence = nest({
  id: "launch-intelligence",
  taskTimeoutMs: 240_000,
  name: "Launch Intelligence Nest",
  objective: "Analyze a Solana token launch: supply and authorities, holder concentration, markets and liquidity, and recent activity, then give a risk verdict.",
  description: "Launch target → structure → liquidity → risk. Name a mint in the objective; with none named, the nest reads $FINCH if its mint is configured.",
  coordinatorInstructions:
    "Report the nest's findings on the mint the Launch Scout identified. Lead with what was read: supply and authorities, holder concentration, markets and liquidity, recent activity. Mark anything unreachable as exactly that. If no mint was identified, say so and stop — never imply data that was not read.",
  finches: [
    member({
      handle: "launch-scout",
      name: "Launch Scout",
      role: "Identifies the mint and reads its pump.fun curve, profile and recent activity.",
      instructions:
        "You are Launch Scout. Find the SPL mint address in the objective (base58, 32–44 characters) and use it exactly as written — Solana addresses are case-sensitive. If the objective names none, call finch_token: if it reports a configured mint, use that mint; if it reports $FINCH is not configured, say that no token was named and $FINCH has no Solana mint configured, and stop. With a mint in hand, call pump_curve first and report its phase, how much of the curve has sold and the SOL in the curve; say plainly when it reports not_on_pump (no pump.fun curve for this mint) or not_launched (no mint account yet — then say so and stop). Then call token_profile, then token_activity with limit 10. Begin your answer with the line 'mint: <address>' so the next finches read the same mint. Report name, symbol, decimals, supply, mint and freeze authority, token program, holder count, and price, liquidity and 24h volume where Jupiter has them, then what recent activity shows — noting that token_activity only sees transactions that reference the mint account.",
      tools: ["finch_token", "pump_curve", "token_profile", "token_activity"],
    }),
    member({
      handle: "structure-analyst",
      name: "Structure Analyst",
      role: "Reads supply structure, authorities and holder concentration.",
      instructions:
        "You are Structure Analyst. Use the mint on the Launch Scout's 'mint:' line; if the scout reported no mint, say exactly that and stop. Call token_data for the mint account, then token_holders with limit 10. Report decimals, supply, token program, and both authorities as facts: a null mint authority means the supply is fixed; a set one means more can be minted; a set freeze authority means its holder can freeze token accounts. List the top holders with share of supply, marking owners that are program-derived addresses (usually a pool or vault), and compute the combined share of the top 1, top 5 and top 10.",
      tools: ["token_data", "token_holders"],
    }),
    member({
      handle: "liquidity-analyst",
      name: "Liquidity Analyst",
      role: "Measures where the token trades and how deep.",
      instructions:
        "You are Liquidity Analyst. Use the mint on the Launch Scout's 'mint:' line; if there is none, say so and stop. Call token_markets ONCE. For each market report dex, pair, USD price, USD liquidity, 24h volume and the 24h buy and sell counts. Then total the liquidity across markets and say which market dominates. You may then call swap_quote once for 1 SOL (input mint So11111111111111111111111111111111111111112) into the token to read the price impact of a small buy — it is a quote; nothing trades. If no market was found, say so; never estimate depth.",
      tools: ["token_markets", "swap_quote"],
    }),
    member({
      handle: "risk-finch",
      name: "Risk Finch",
      role: "Scores launch risk and can veto an alert.",
      instructions:
        "You are Risk Finch. From the scout, structure and liquidity findings, produce a risk assessment with an explicit confidence level. Authorities, concentration and liquidity are facts — cite which finch reported each. If the inputs are mostly 'unavailable', your verdict must be INSUFFICIENT DATA rather than a risk score.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    { id: "t1", finch: "launch-scout", title: "Identify and profile the launch", instruction: "Identify the mint for the objective (or $FINCH when none is named and its mint is configured) and profile it.", dependsOn: [], outputChannel: "launch.target" },
    { id: "t2", finch: "structure-analyst", title: "Analyze launch structure", instruction: "Launch Scout:\n{{launch.target}}\n\nAnalyze supply structure, authorities and holder concentration for this mint, or state exactly what could not be read.", dependsOn: ["t1"], outputChannel: "launch.structure" },
    { id: "t3", finch: "liquidity-analyst", title: "Profile liquidity", instruction: "Launch Scout:\n{{launch.target}}\n\nProfile the markets and liquidity for this mint, or state exactly what could not be read.", dependsOn: ["t1"], outputChannel: "liquidity.profile" },
    { id: "t4", finch: "risk-finch", title: "Score risk", instruction: "Launch Scout:\n{{launch.target}}\n\nStructure:\n{{launch.structure}}\n\nLiquidity:\n{{liquidity.profile}}\n\nProduce the risk verdict.", dependsOn: ["t2", "t3"], outputChannel: "risk.score" },
  ],
});

// ── 3. RWA Research ───────────────────────────────────────────────────────

const rwaResearch = nest({
  id: "rwa-research",
  name: "RWA Research Nest",
  objective: "Research tokenized real-world assets available to agents on Solana and report what is approved and why.",
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
        "You are Asset Analyst. For each approved asset (if any), call token_data on its mint and report its structure: supply, decimals, mint and freeze authority, token program. Use account_read to show Token-2022 extensions (such as a transfer hook or permanent delegate) where the RPC parses them. If the registry is empty, describe the reads you would perform and what issuer restrictions typically constrain.",
      tools: ["rwa_registry", "token_data", "account_read"],
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
  objective: "Profile an address on Solana and describe what a monitoring policy over it should watch.",
  description: "Balance read → holdings profile → activity context → monitoring policy.",
  coordinatorInstructions:
    "Produce a monitoring brief for the address in the objective. If no address was supplied, say so and explain what the nest needs.",
  finches: [
    member({
      handle: "balance-scout",
      name: "Balance Scout",
      role: "Reads SOL and token balances for an address.",
      instructions:
        "You are Balance Scout. Extract the Solana address (base58, 32–44 characters) from the objective and use it exactly as written — addresses are case-sensitive. Call balance_native on it; if mint addresses were given, call portfolio_snapshot with them (or balance_spl for a single mint). Report exact balances with units. If no valid address is present, say so and stop — do not invent one.",
      tools: ["balance_native", "balance_spl", "portfolio_snapshot"],
    }),
    member({
      handle: "context-finch",
      name: "Context Finch",
      role: "Places the address in current network conditions.",
      instructions:
        "You are Context Finch. Call network_status and relate the address's SOL balance to current conditions: how many typical actions it funds at the fee per signature plus the median priority fee on a 200,000 compute-unit limit (micro-lamports × 200,000 ÷ 1,000,000 = lamports). Show the arithmetic, and label the result an estimate.",
      tools: ["network_status"],
    }),
    member({
      handle: "policy-finch",
      name: "Policy Finch",
      role: "Drafts the monitoring and execution policy.",
      instructions:
        "You are Policy Finch. From the balance and context findings, draft a concrete monitoring policy: which SOL and token balance deltas warrant an alert, sensible daily and per-transaction allowance caps in SOL if an agent were to operate this address, and which programs an allowlist should contain. Express caps as numbers.",
      tools: [],
      temperature: 0.25,
    }),
  ],
  tasks: [
    { id: "t1", finch: "balance-scout", title: "Read balances", instruction: "Read balances for the address in the objective.", dependsOn: [], outputChannel: "address.balances" },
    { id: "t2", finch: "context-finch", title: "Contextualize", instruction: "Balances:\n{{address.balances}}\n\nRelate these to current network conditions.", dependsOn: ["t1"], outputChannel: "address.context" },
    { id: "t3", finch: "policy-finch", title: "Draft monitoring policy", instruction: "Balances:\n{{address.balances}}\n\nContext:\n{{address.context}}\n\nDraft the monitoring and execution policy.", dependsOn: ["t2"], outputChannel: "policy.draft" },
  ],
});

// ── 5. Token Due Diligence — a real token, read three ways, then judged ────

const tokenDueDiligence = nest({
  id: "token-due-diligence",
  name: "Token Due Diligence Nest",
  objective: "Assess a token on Solana from its onchain facts: supply, authorities, holder concentration, and recent activity.",
  description: "Token profile → holder concentration → recent activity → risk read. Set the objective to a mint address.",
  coordinatorInstructions:
    "Write a due-diligence note on the token named in the objective. Lead with the hard numbers the finches read: supply, mint and freeze authority, holders, top-holder share, recent activity pattern. Concentration and activity are facts; whether they are good or bad depends on the token's purpose, so say what the numbers are before saying what they might mean. If the objective contains no mint address, say so and stop.",
  finches: [
    member({
      handle: "profile-finch",
      name: "Profile Finch",
      role: "Reads the token's identity, supply, authorities and market data.",
      instructions:
        "You are Profile Finch. Extract the mint address from the objective and call token_profile, then token_data for the mint account's own view. Report name, symbol, decimals, supply, mint and freeze authority, token program, holder count, price, market cap, liquidity, 24h volume and Jupiter's verification flag exactly as returned; say 'unpriced' where Jupiter has no price. If no address is present in the objective, say exactly that.",
      tools: ["token_profile", "token_data"],
    }),
    member({
      handle: "holder-finch",
      name: "Holder Finch",
      role: "Measures how concentrated ownership is.",
      instructions:
        "You are Holder Finch. Call token_holders with limit 10 for the mint in the objective. Report the top 10 token accounts with balance and share of supply, mark which owners are program-derived addresses (usually a pool, vault or program), note when one owner holds several of the accounts, and compute the combined share of the top 1, top 5 and top 10. Identify the incinerator (1nc1nerator11111111111111111111111111111111) as a burn address, not as a holder. Numbers only, then one line on what the concentration pattern is.",
      tools: ["token_holders"],
    }),
    member({
      handle: "activity-finch",
      name: "Activity Finch",
      role: "Reads recent token activity.",
      instructions:
        "You are Activity Finch. Call token_activity with limit 20 for the mint in the objective. Report how many transactions you see, the slot range and time span they cover, the largest balance change in this token, and whether flow is concentrated between a few addresses or spread out. token_activity only sees transactions that reference the mint account — transfers that don't pass the mint are not visible — so state that the view is partial. Do not infer trading volume beyond what the transactions show.",
      tools: ["token_activity"],
    }),
    member({
      handle: "diligence-finch",
      name: "Diligence Finch",
      role: "Reads the three channels and writes the risk section.",
      instructions:
        "You are Diligence Finch. You receive the profile, holder analysis and activity read. Write a short risk section: supply and authority facts, concentration facts, activity facts, and verification status. Each point cites which channel it came from. Where the data cannot support a conclusion, say what would be needed. No tools; work only from the channels.",
      tools: [],
      temperature: 0.1,
    }),
  ],
  tasks: [
    { id: "t1", finch: "profile-finch", title: "Profile the token", instruction: "Profile the token named in the objective.", dependsOn: [], outputChannel: "token.profile" },
    { id: "t2", finch: "holder-finch", title: "Measure holder concentration", instruction: "Token profile:\n{{token.profile}}\n\nMeasure holder concentration for this token.", dependsOn: ["t1"], outputChannel: "token.holders" },
    { id: "t3", finch: "activity-finch", title: "Read recent activity", instruction: "Token profile:\n{{token.profile}}\n\nRead this token's recent activity.", dependsOn: ["t1"], outputChannel: "token.activity" },
    {
      id: "t4",
      finch: "diligence-finch",
      title: "Write the risk read",
      instruction: "Profile:\n{{token.profile}}\n\nHolders:\n{{token.holders}}\n\nActivity:\n{{token.activity}}\n\nWrite the risk section.",
      dependsOn: ["t2", "t3"],
      outputChannel: "token.risk",
    },
  ],
});

// ── 6. Network Due Diligence — everyone's finches, one objective, in parallel ─
//
// The giga-brain: the registry's own analysts composed into one nest by
// reference, fanned out on a single token at once, then synthesized. Every
// member is a finch a visitor can open and run alone; here they work together.

const networkDd = nest({
  id: "network-dd",
  taskTimeoutMs: 240_000,
  name: "Network Due Diligence Nest",
  objective: "Full due diligence on a token on Solana: network context, token structure, mint authority, liquidity, and a cited verdict.",
  description: "Chain Pulse ∥ Token Inspector ∥ Wallet Analyst → synthesis. Composed by reference from registry finches. Set the objective to a mint address.",
  coordinatorInstructions:
    "Write a due-diligence memo on the token named in the objective, built only from the channels. Sections: network conditions, token structure and concentration, mint authority profile, liquidity, verdict. Each figure cites its channel. The verdict is one of: PROCEED / CAUTION / INSUFFICIENT DATA, with the exact facts that decided it. If the objective contains no mint address, say so and stop.",
  finches: [
    refMember("chain-pulse", "Reads live and cumulative network conditions."),
    refMember("token-inspector", "Profiles the token: supply, authorities, holders, concentration, activity."),
    refMember("wallet-analyst", "Profiles the mint account and its mint authority."),
    member({
      handle: "dd-synthesis",
      name: "DD Synthesis Finch",
      role: "Reads every channel and writes the verdict section.",
      instructions:
        "You are DD Synthesis Finch. You receive network conditions, the token profile, and the mint authority profile. Write the verdict section: list the decisive facts with their channel, then one of PROCEED / CAUTION / INSUFFICIENT DATA. A missing input is a fact that lowers confidence, not a gap to fill. No tools.",
      tools: [],
      temperature: 0.1,
    }),
  ],
  tasks: [
    { id: "t1", finch: "chain-pulse", title: "Read network conditions", instruction: "Report current and cumulative Solana conditions relevant to trading and execution.", dependsOn: [], outputChannel: "dd.chain" },
    { id: "t2", finch: "token-inspector", title: "Inspect the token", instruction: "Inspect the token named in the objective: profile, top holders with concentration, recent activity.", dependsOn: [], outputChannel: "dd.token" },
    { id: "t3", finch: "wallet-analyst", title: "Profile the mint and its authority", instruction: "Profile the mint address named in the objective with wallet_profile, then profile its mint authority address if one is reported.", dependsOn: [], outputChannel: "dd.authority" },
    {
      id: "t4",
      finch: "dd-synthesis",
      title: "Write the verdict",
      instruction: "Network:\n{{dd.chain}}\n\nToken:\n{{dd.token}}\n\nMint authority:\n{{dd.authority}}\n\nWrite the verdict section.",
      dependsOn: ["t1", "t2", "t3"],
      outputChannel: "dd.verdict",
    },
  ],
});

export const NEST_PRESETS: NestManifest[] = [chainIntelligence, launchIntelligence, rwaResearch, addressWatch, tokenDueDiligence, networkDd];

export function getNestPreset(id: string): NestManifest | undefined {
  return NEST_PRESETS.find((preset) => preset.identity.id === id);
}
