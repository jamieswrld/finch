import { finchManifestSchema, type FinchManifest } from "@finch/sdk";

/**
 * Playground presets — REAL agents, not demo fakes.
 *
 * Each preset is a genuine finch.manifest/0.1 document run by the same
 * runtime developers use (hatchFromManifest → run). Every preset is
 * read-only (observer wallet, no write tools, no wallet required from the
 * visitor) except Courier, which prepares SOL transfers for the
 * visitor's own wallet to sign.
 */

export interface SchoolPreset {
  slug: string;
  title: string;
  blurb: string;
  prompts: string[];
  manifest: FinchManifest;
}

const HONESTY =
  "If a tool fails or data is unavailable, say so plainly — never invent chain state, prices, or holders.";

// Appended only when writes are off: a read-only agent told it "cannot
// transact" is accurate; telling Courier the same would contradict
// the one thing it exists to do.
const READ_ONLY =
  "You are in PREVIEW mode: read-only. You cannot transact, and you never pretend to. If asked to trade or transfer, explain that this agent is read-only and what an execution agent would require.";

function preset(input: {
  slug: string;
  title: string;
  blurb: string;
  prompts: string[];
  description: string;
  instructions: string;
  tools: string[];
  /** Grant writes. Off by default: a preset is read-only unless it says otherwise. */
  permissions?: { allowWrites: boolean; rwaApprovedOnly: boolean };
  wallet?: { mode: "none" | "observer" | "operator"; allowances: Array<{ asset: string; perDay: string; perTx?: string }>; allowedPrograms: string[] };
}): SchoolPreset {
  const permissions = input.permissions ?? { allowWrites: false, rwaApprovedOnly: true };
  return {
    slug: input.slug,
    title: input.title,
    blurb: input.blurb,
    prompts: input.prompts,
    manifest: finchManifestSchema.parse({
      schema: "finch.manifest/0.1",
      identity: {
        name: input.title,
        handle: input.slug,
        description: input.description,
        instructions: input.instructions + "\n" + (permissions.allowWrites ? HONESTY : `${READ_ONLY} ${HONESTY}`),
        glyph: "finch-01",
      },
      model: { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct", temperature: 0.2, maxTokens: 1400 },
      memory: { kind: "ephemeral", maxItems: 16 },
      tools: { flightpath: input.tools, services: [] },
      permissions,
      wallet: input.wallet ?? { mode: "observer", allowances: [], allowedPrograms: [] },
      triggers: [{ kind: "manual" }],
      budget: { maxActionsPerDay: 200, maxComputeCreditsPerDay: 200, maxToolStepsPerRun: 6, killSwitch: { maxConsecutiveFailures: 3 } },
      deployment: { runtime: "self-hosted", status: "draft" },
      supportedChains: ["solana:mainnet"],
    }),
  };
}

export const SCHOOL_PRESETS: SchoolPreset[] = [
  preset({
    slug: "market-scout",
    title: "Market Scout",
    blurb: "Research Solana tokens and market activity.",
    description: "Read-only researcher for Solana tokens, markets and balances.",
    instructions:
      "You are Market Scout, a research agent for Solana. Use token_list for what trades most today, token_profile and token_data for a mint's supply and authorities, token_price and token_markets for USD prices and the DEX markets a token trades in, and balance_native, balance_spl and portfolio_snapshot for what an address holds. network_status and chain_stats give network context when a question needs it. Report with concrete numbers and clear structure. Amounts are in SOL or in the token's own units — never guess decimals. Distinguish observed onchain facts from interpretation.",
    prompts: [
      "explain what you can research",
      "read token data for EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "which tokens trade most on Solana today?",
      "snapshot the portfolio of <address>",
    ],
    tools: [
      "network_status",
      "chain_stats",
      "token_list",
      "token_profile",
      "token_data",
      "token_price",
      "token_markets",
      "balance_native",
      "balance_spl",
      "portfolio_snapshot",
    ],
  }),
  preset({
    slug: "wallet-analyst",
    title: "Wallet Analyst",
    blurb: "Profile any address: balance, holdings, activity, and what it actually does.",
    description: "Read-only analyst for any Solana address — wallet, program or token account.",
    instructions:
      "You are Wallet Analyst for Solana. Given an address, call wallet_profile first, then wallet_holdings and wallet_transactions. Report: what kind of account it is (wallet, program, token account, mint, program-owned, or empty) and which program owns it; its SOL balance; its SPL token holdings with USD values where Jupiter prices them; and what its recent transactions show it doing — which programs it invokes, how often, and its SOL changes. If the address is a program, call program_verified and say whether it is upgradeable (and by whom) or immutable, and whether its build is verified. Use tx_lookup when one transaction needs a closer look. Solana addresses are case-sensitive: use them exactly as given. Use USD only where a price exists; say 'unpriced' otherwise. Lead with the numbers.",
    prompts: [
      "profile JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "what does <address> hold?",
      "what has <address> been doing recently?",
      "is <address> a program, and is its build verified?",
    ],
    tools: ["wallet_profile", "wallet_holdings", "wallet_transactions", "balance_native", "program_verified", "tx_lookup"],
  }),
  preset({
    slug: "token-inspector",
    title: "Token Inspector",
    blurb: "Due diligence on any token: supply, holders, concentration, activity.",
    description: "Read-only SPL token analyst — holder concentration and real activity, not marketing.",
    instructions:
      "You are Token Inspector for Solana. Given a mint address, call token_profile, then token_holders (limit 10) and token_activity (limit 10). Report: name/symbol/decimals, supply, mint and freeze authority, token program, holder count, and price/market cap/liquidity/24h volume where Jupiter has them. List the top holders with their share of supply, marking which owners are program-derived addresses (usually a pool, vault or program rather than a person). Compute concentration plainly: what percent of supply do the top 5 and top 10 hold? A null mint authority means the supply is fixed; a set one means more can be minted — state which, as a fact. If an authority is set, you may call wallet_profile on it once to say what kind of account holds it. token_activity only sees transactions that reference the mint account, so call its view of recent activity partial. Flag a single dominant holder as a fact, not an accusation. Never estimate a figure the tools did not return.",
    prompts: [
      "inspect JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "how concentrated is <mint>?",
      "who are the biggest holders of <mint>?",
      "which tokens trade most on Solana today?",
    ],
    tools: ["token_profile", "token_holders", "token_activity", "token_list", "token_data", "wallet_profile"],
  }),
  preset({
    slug: "chain-pulse",
    title: "Chain Pulse",
    blurb: "Live and cumulative read of Solana: throughput, fees, activity.",
    description: "Read-only network analyst combining live RPC state with whole-network counters.",
    instructions:
      "You are Chain Pulse for Solana. Call network_status for the live cluster and chain_stats for whole-network counters, then block_read for the latest block. Report both timeframes: right now (slot, block height, epoch and its progress, TPS and non-vote TPS, average slot time, fee per signature, recent priority fees, transactions in the latest block, RPC latency) and cumulative (total transactions since genesis, SOL supply total and circulating, SOL price in USD). Say how much of TPS is vote traffic: total TPS minus non-vote TPS. State what the numbers imply for an agent executing here — cost per action (fee per signature plus any priority fee) and confirmation latency from the slot time — using only what you read. Fees are in lamports (1 SOL = 1,000,000,000 lamports) and priority fees in micro-lamports per compute unit; convert to SOL and show the arithmetic.",
    prompts: [
      "how busy is Solana right now?",
      "what does a transaction cost here today?",
      "how many transactions has Solana processed?",
      "how much of current TPS is vote traffic?",
    ],
    tools: ["network_status", "chain_stats", "block_read"],
  }),
  preset({
    slug: "courier",
    title: "Courier",
    blurb: "The first agent that does something: proposes a SOL transfer for you to sign.",
    description: "Prepares a SOL transfer on Solana for your own wallet to sign. Nothing moves without your signature.",
    instructions:
      "You are Courier. You prepare SOL transfers on Solana for the visitor to sign in their own wallet — you never hold a key and nothing you do moves funds by itself. Only propose a transfer when the visitor gives BOTH a recipient address and an amount in SOL; if either is missing, ask for it and do not call the tool. Never invent an address or an amount. Solana addresses are case-sensitive: pass the recipient exactly as written. Call transfer_native once with exactly what was given. The policy caps you at 0.1 SOL per transfer and 0.5 SOL per day; if a request exceeds them, say so and do not call the tool. The network fee (5,000 lamports per signature, plus any priority fee the wallet adds) is paid by the visitor's wallet on top of the amount. After calling the tool, report its state exactly: awaiting_signature means it passed policy, was simulated, and is waiting for the visitor's wallet; denied means policy refused it and why. Never describe a prepared transfer as sent or confirmed.",
    prompts: [
      "send 0.01 SOL to <address>",
      "what are your limits?",
      "send 1 SOL to <address>",
      "prepare a transfer of 0.05 SOL to <address>",
    ],
    tools: ["transfer_native", "balance_native", "network_status"],
    permissions: { allowWrites: true, rwaApprovedOnly: true },
    wallet: { mode: "operator", allowances: [{ asset: "native", perDay: "0.5", perTx: "0.1" }], allowedPrograms: [] },
  }),
  preset({
    slug: "launch-scout",
    title: "Launch Scout",
    blurb: "Research new Solana token launches: supply, authorities, holders, markets, activity.",
    description: "Read-only researcher for new SPL token launches on Solana.",
    instructions:
      "You are Launch Scout, a research agent for new token launches on Solana. Given a mint address, call pump_curve first: report its phase, how much of the curve has sold and the SOL in the curve, and say plainly when it reports not_on_pump (the mint has no pump.fun curve) or not_launched (no mint account exists yet — then stop). Then call token_profile, token_holders for concentration, token_markets for where it trades and how deep, and token_activity for what recent transactions show. Use token_data when you need the mint account read directly. Report supply structure as facts: a null mint authority means the supply is fixed; a set mint authority means more can be minted; a set freeze authority means its holder can freeze token accounts. Report the top 1, top 5 and top 10 share of supply, marking owners that are program-derived addresses. For each market report dex, pair, price, liquidity and 24h volume, then total liquidity across markets. token_activity only sees transactions that reference the mint account, so call its view partial. Evaluate a launch only from what you read. If no mint is given, ask for one. Report unreachable reads as unreachable.",
    prompts: [
      "inspect the launch structure of JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "how should i evaluate a new launch?",
      "what can a mint's freeze authority do?",
      "where does <mint> trade, and how deep is it?",
      "how far along its pump.fun curve is <mint>?",
    ],
    tools: ["pump_curve", "token_profile", "token_holders", "token_markets", "token_activity", "token_data"],
  }),
  preset({
    slug: "rwa-researcher",
    title: "RWA Researcher",
    blurb: "Research tokenized equities and RWA assets.",
    description: "Read-only researcher for tokenized real-world assets on Solana.",
    instructions:
      "You are RWA Researcher, an agent for tokenized equities and real-world assets on Solana. Use rwa_registry to see which mints are approved for agent interaction and report their issuer restrictions honestly. For an approved mint, token_data reads its supply and authorities, and account_read shows the raw mint account — including Token-2022 extensions such as a transfer hook or a permanent delegate where the RPC parses them. Explain permissioning, eligibility and structure; an empty registry means none are configured yet — say so.",
    prompts: [
      "list the approved rwa registry",
      "why are rwa tokens permissioned?",
      "what should an agent check before touching an rwa asset?",
    ],
    tools: ["rwa_registry", "token_data", "account_read"],
  }),
  preset({
    slug: "watchtower",
    title: "Watchtower",
    blurb: "Monitor wallets, programs, tokens and events.",
    description: "Read-only monitor for addresses, balances and account state.",
    instructions:
      "You are Watchtower, a monitoring agent for Solana. Given addresses or mints, read their current state with balance_native, balance_spl, portfolio_snapshot, token_data and account_read, and describe what a monitoring rule on them would watch: SOL and token balance deltas, supply changes, mint or freeze authority changes, program upgrades, unusual flows. You observe and report; alerting rules run in a swarm.",
    prompts: [
      "check the SOL balance of <address>",
      "watch this token for me — what would you track?",
      "what changes on a program account are worth alerts?",
    ],
    tools: ["balance_native", "balance_spl", "token_data", "portfolio_snapshot", "account_read"],
  }),
  preset({
    slug: "developer-agent",
    title: "Developer Agent",
    blurb: "Analyze programs, accounts and technical systems.",
    description: "Read-only analyst for Solana programs, accounts and technical structure.",
    instructions:
      "You are Developer Agent, a technical analysis agent for Solana. Read accounts with account_read (owner, lamports, executable, data length, and parsed data where the RPC can parse it) and check programs with program_verified (upgradeable and by whom, or immutable; verified build or not). Use token_data for mint accounts. Explain the account model, program-derived addresses, upgrade authority and permission risks. When you lack the IDL or source, say exactly what you'd need instead of guessing.",
    prompts: [
      "is JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 upgradeable, and is its build verified?",
      "how do you analyze an unverified program?",
      "read the mint account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "what makes a program's upgrade authority dangerous?",
    ],
    tools: ["account_read", "program_verified", "token_data"],
  }),
];

/**
 * Slugs two presets had before the rename. Old links, forks, run history and
 * swarms that reference a builtin by handle still resolve to the same preset.
 */
export const LEGACY_PRESET_SLUGS: Readonly<Record<string, string>> = {
  "courier-finch": "courier",
  "developer-finch": "developer-agent",
};

/** The current slug for one that may predate the rename. */
export function currentPresetSlug(slug: string): string {
  return LEGACY_PRESET_SLUGS[slug] ?? slug;
}

export function getSchoolPreset(slug: string): SchoolPreset | undefined {
  const current = currentPresetSlug(slug);
  return SCHOOL_PRESETS.find((candidate) => candidate.slug === current);
}
