import { finchManifestSchema, type FinchManifest } from "@finch/sdk";

/**
 * Flight School presets — REAL finches, not demo fakes.
 *
 * Each preset is a genuine finch.manifest/0.1 document run by the same
 * runtime developers use (hatchFromManifest → nest.run). Every preset is
 * strictly read-only: observer wallet, no write tools, no wallet required
 * from the visitor.
 */

export interface SchoolPreset {
  slug: string;
  title: string;
  blurb: string;
  prompts: string[];
  manifest: FinchManifest;
}

function preset(input: {
  slug: string;
  title: string;
  blurb: string;
  prompts: string[];
  description: string;
  instructions: string;
  tools: string[];
}): SchoolPreset {
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
        instructions:
          input.instructions +
          "\nYou are in PREVIEW mode: read-only. You cannot transact, and you never pretend to. If asked to trade or transfer, explain that this finch is read-only and what an execution finch would require. If a tool fails or data is unavailable, say so plainly — never invent chain state, prices, or holders.",
        glyph: "finch-01",
      },
      model: { provider: "hyperbolic", model: "meta-llama/Llama-3.3-70B-Instruct", temperature: 0.2, maxTokens: 1400 },
      memory: { kind: "ephemeral", maxItems: 16 },
      tools: { flightpath: input.tools, services: [] },
      permissions: { allowWrites: false, rwaApprovedOnly: true },
      wallet: { mode: "observer", allowances: [], allowedContracts: [] },
      triggers: [{ kind: "manual" }],
      budget: { maxActionsPerDay: 200, maxComputeCreditsPerDay: 200, maxToolStepsPerRun: 6, killSwitch: { maxConsecutiveFailures: 3 } },
      deployment: { runtime: "self-hosted", status: "draft" },
    }),
  };
}

export const SCHOOL_PRESETS: SchoolPreset[] = [
  preset({
    slug: "market-scout",
    title: "Market Scout",
    blurb: "Research Robinhood assets and market activity.",
    description: "Read-only researcher for Robinhood Chain assets and activity.",
    instructions:
      "You are Market Scout, a research finch for Robinhood Chain (id 4663). Use your tools to read token metadata, balances and portfolios. Report with concrete numbers and clear structure. Distinguish observed onchain facts from interpretation.",
    prompts: [
      "explain what you can research",
      "read token data for 0x…",
      "snapshot the portfolio of 0x…",
      "what does total supply tell you about a token?",
    ],
    tools: ["token_data", "balance_native", "balance_erc20", "portfolio_snapshot", "contract_read"],
  }),
  preset({
    slug: "pons-scout",
    title: "Pons Scout",
    blurb: "Research Pons launches, markets, activity and protocol data.",
    description: "Read-only researcher for the Pons launch protocol on Robinhood Chain.",
    instructions:
      "You are Pons Scout, a research finch for the Pons launchpad on Robinhood Chain. Check integration status with pons_status before claiming anything about live Pons data. Explain launch mechanics, creator taxes (Finch's is 3%/300 bps; Pons protocol fees are separate) and how to evaluate a launch: supply structure, holders, liquidity, activity.",
    prompts: [
      "is the pons indexer connected?",
      "how should i evaluate a new launch?",
      "compute the creator tax on 1 ETH of volume",
      "what's the difference between creator tax and protocol fees?",
    ],
    tools: ["pons_status", "pons_creator_tax", "token_data", "contract_read"],
  }),
  preset({
    slug: "rwa-researcher",
    title: "RWA Researcher",
    blurb: "Research tokenized equities and RWA assets.",
    description: "Read-only researcher for tokenized real-world assets on Robinhood Chain.",
    instructions:
      "You are RWA Researcher, a finch for tokenized equities and real-world assets. Use rwa_registry to see which assets are approved for agent interaction and report their issuer restrictions honestly. Explain permissioning, eligibility and structure; an empty registry means none are configured yet — say so.",
    prompts: [
      "list the approved rwa registry",
      "why are rwa tokens permissioned?",
      "what should an agent check before touching an rwa asset?",
    ],
    tools: ["rwa_registry", "token_data", "contract_read"],
  }),
  preset({
    slug: "watchtower",
    title: "Watchtower",
    blurb: "Monitor wallets, contracts, tokens and events.",
    description: "Read-only monitor for addresses, balances and contract state.",
    instructions:
      "You are Watchtower, a monitoring finch. Given addresses or tokens, read their current state and describe what a monitoring rule on them would watch: balance deltas, supply changes, unusual flows. You observe and report; alerting rules run in a nest.",
    prompts: [
      "check the balance of 0x…",
      "watch this token for me — what would you track?",
      "what changes on a contract are worth alerts?",
    ],
    tools: ["balance_native", "balance_erc20", "token_data", "portfolio_snapshot", "contract_read"],
  }),
  preset({
    slug: "developer-finch",
    title: "Developer Finch",
    blurb: "Analyze contracts and technical systems.",
    description: "Read-only analyst for contracts, ABIs and technical structure.",
    instructions:
      "You are Developer Finch, a technical analysis finch. Read contract state through provided ABIs, explain function surfaces, permissioning patterns and risks. When you lack the ABI or source, say exactly what you'd need instead of guessing.",
    prompts: [
      "how do you analyze an unverified contract?",
      "read totalSupply from this token: 0x…",
      "what makes a contract's permissions dangerous?",
    ],
    tools: ["contract_read", "token_data"],
  }),
];

export function getSchoolPreset(slug: string): SchoolPreset | undefined {
  return SCHOOL_PRESETS.find((candidate) => candidate.slug === slug);
}
