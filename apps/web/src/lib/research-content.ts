/**
 * Research program content. Statuses are honest: benchmark suites are defined
 * with methodology before any numbers are published — no fabricated results.
 */

export const EXPERIMENTS = [
  {
    id: "EXP-001",
    title: "Murmuration routing",
    status: "active" as const,
    area: "coordination",
    summary:
      "How should messages route through a nest as it grows? Compares staged pipelines (current Nest model) against gossip and quorum topologies on task completion and token cost.",
  },
  {
    id: "EXP-002",
    title: "Budgeted autonomy",
    status: "active" as const,
    area: "safety",
    summary:
      "Behavioral study of spend-bounded agents: how allowance size, approval thresholds and kill switches change what an execution agent attempts — and what it abandons.",
  },
  {
    id: "EXP-003",
    title: "Receipt attestations",
    status: "design" as const,
    area: "verification",
    summary:
      "Can a nest prove what it did? Signed execution receipts (Flightpath logs → onchain attestations) as a primitive for trust between nests that have never met.",
  },
  {
    id: "EXP-004",
    title: "Memory drift under retention",
    status: "design" as const,
    area: "memory",
    summary:
      "Long-horizon agents accumulate stale beliefs. Measures recall precision on Atlas vector memory as namespaces age, under different retention and re-embedding policies.",
  },
];

export const BENCHMARKS = [
  {
    suite: "flightpath-bench",
    tasks: 48,
    metric: "execution correctness",
    description: "Transfer, approval, swap and read tasks against a fork — did the agent produce the right intent, and did it respect policy?",
    status: "harness ready — first public run pending",
  },
  {
    suite: "nest-relay",
    tasks: 24,
    metric: "end-to-end task completion",
    description: "Multi-agent relay tasks through 2–4 stage nests; measures completion, latency and token cost per stage.",
    status: "in design",
  },
  {
    suite: "policy-probe",
    tasks: 60,
    metric: "deny-rate fidelity",
    description: "Adversarial prompts that try to exceed allowances, reach unlisted contracts, or fake confirmations. Score = correctly denied / total.",
    status: "harness ready — first public run pending",
  },
];

export const OPEN_PROBLEMS = [
  {
    id: "OP-01",
    title: "Delegated custody granularity",
    body: "Per-epoch budgets are coarse. What does a useful, auditable per-intent authorization language look like — without making humans review everything?",
  },
  {
    id: "OP-02",
    title: "Inter-agent pricing",
    body: "When finches buy services from finches, what discovers the price? Posted prices, auctions, or negotiated credit lines all have failure modes at swarm scale.",
  },
  {
    id: "OP-03",
    title: "Simulation validity",
    body: "A simulation is a promise about a future block. How stale can it be before submission becomes dishonest — and should agents re-simulate on reorg signals?",
  },
  {
    id: "OP-04",
    title: "Memory consistency across a nest",
    body: "Two finches with different memories of the same event will disagree productively — or catastrophically. When should memory be shared vs. private?",
  },
  {
    id: "OP-05",
    title: "Permissioned-asset agents",
    body: "RWA rails assume identified counterparties. What does agent eligibility even mean, and how do issuer restrictions compose with agent autonomy?",
  },
];

export const GRANT_TRACKS = [
  { track: "Open-source tooling", note: "SDK adapters, indexers, testing harnesses.", size: "up to 25k $FINCH" },
  { track: "Aviary services", note: "High-quality data feeds, risk modules, attestation services.", size: "up to 40k $FINCH" },
  { track: "Coordination research", note: "Published experiments on nest/swarm behavior, with code.", size: "up to 60k $FINCH" },
  { track: "Security", note: "Audits, fuzzing suites, policy-bypass bounties.", size: "case by case" },
];

export const FIPS = [
  {
    id: "FIP-0",
    title: "finch.manifest/0.1 — the agent manifest",
    status: "implemented-draft" as const,
    summary: "One serializable document describing identity, model, memory, tools, permissions, wallet, triggers, budget. Implemented in @finch/sdk and the Nest Builder.",
  },
  {
    id: "FIP-1",
    title: "Flightpath execution records",
    status: "implemented-draft" as const,
    summary: "The mandatory lifecycle (policy → simulate → approve → submit → confirm → log) and the ExecutionRecord shape every write produces.",
  },
  {
    id: "FIP-2",
    title: "Aviary service listings",
    status: "draft" as const,
    summary: "Listing metadata, verification levels, uptime probes and per-call metering for services published to the registry.",
  },
  {
    id: "FIP-3",
    title: "Credits accounting & $FINCH settlement",
    status: "draft" as const,
    summary: "Double-entry credit ledger (live) and the CreditsLedger contract (draft) that will bind $FINCH deposits to credit issuance after launch.",
  },
  {
    id: "FIP-4",
    title: "Onchain registry & Proof of Flight",
    status: "implemented-draft" as const,
    summary: "FinchRegistry (permissionless finch/nest identity: manifest hash, URI, version, status, events) and the Proof of Flight receipt format for verifiable executions.",
  },
];
