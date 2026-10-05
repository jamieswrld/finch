/**
 * Research program content. Statuses are honest: benchmark suites are defined
 * with methodology before any numbers are published — no fabricated results.
 */

export const EXPERIMENTS = [
  {
    id: "EXP-001",
    title: "Swarm routing",
    status: "active" as const,
    area: "coordination",
    summary:
      "How should messages route through a swarm as it grows? Compares staged pipelines (the current swarm model) against gossip and quorum topologies on task completion and token cost.",
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
      "Can a swarm prove what it did? Signed execution receipts (execution-layer logs → onchain attestations) as a primitive for trust between swarms that have never met.",
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
    suite: "execution-bench",
    tasks: 48,
    metric: "execution correctness",
    description: "Transfer, approval, swap and read tasks against a local validator — did the agent produce the right instructions, and did it respect policy?",
    status: "harness ready — first public run pending",
  },
  {
    suite: "swarm-relay",
    tasks: 24,
    metric: "end-to-end task completion",
    description: "Multi-agent relay tasks through 2–4 stage swarms; measures completion, latency and token cost per stage.",
    status: "in design",
  },
  {
    suite: "policy-probe",
    tasks: 60,
    metric: "deny-rate fidelity",
    description: "Adversarial prompts that try to exceed allowances, reach unlisted programs, or fake confirmations. Score = correctly denied / total.",
    status: "harness ready — first public run pending",
  },
];

export const OPEN_PROBLEMS = [
  {
    id: "OP-01",
    title: "Delegated custody granularity",
    body: "Daily allowances are coarse. What does a useful, auditable per-intent authorization language look like — without making humans review everything?",
  },
  {
    id: "OP-02",
    title: "Inter-agent pricing",
    body: "When agents buy services from agents, what discovers the price? Posted prices, auctions, or negotiated credit lines all have failure modes at swarm scale.",
  },
  {
    id: "OP-03",
    title: "Simulation validity",
    body: "A simulation is a promise about a future slot. How stale can it be before submission becomes dishonest — and should an agent re-simulate every time it refreshes a blockhash?",
  },
  {
    id: "OP-04",
    title: "Memory consistency across a swarm",
    body: "Two agents with different memories of the same event will disagree productively — or catastrophically. When should memory be shared vs. private?",
  },
  {
    id: "OP-05",
    title: "Permissioned-asset agents",
    body: "RWA rails assume identified counterparties. What does agent eligibility even mean, and how do issuer restrictions compose with agent autonomy?",
  },
];

// Amounts are deliberately absent: none are set, and a figure here before one
// is would be an invented number.
export const GRANT_TRACKS = [
  { track: "Open-source tooling", note: "SDK adapters, indexers, testing harnesses.", size: "amount not set" },
  { track: "Directory services", note: "High-quality data feeds, risk modules, attestation services.", size: "amount not set" },
  { track: "Coordination research", note: "Published experiments on swarm behavior, with code.", size: "amount not set" },
  { track: "Security", note: "Audits, fuzzing suites, policy-bypass bounties.", size: "case by case" },
];

export const PROPOSALS = [
  {
    id: "YIP-0",
    title: "finch.manifest/0.1 — the agent manifest",
    status: "implemented-draft" as const,
    summary: "One serializable document describing identity, model, memory, tools, permissions, wallet, triggers, budget. Implemented in @finch/sdk and the agent builder.",
  },
  {
    id: "YIP-1",
    title: "Execution records",
    status: "implemented-draft" as const,
    summary: "The mandatory lifecycle (policy → simulate → approve → submit → confirm → log) and the ExecutionRecord shape every write produces.",
  },
  {
    id: "YIP-2",
    title: "Directory service listings",
    status: "draft" as const,
    summary: "Listing metadata, verification levels, uptime probes and per-call metering for services published to the directory.",
  },
  {
    id: "YIP-3",
    title: "Credits accounting & settlement",
    status: "draft" as const,
    summary: "Double-entry credit ledger (live), and a design not yet written for how credits are issued against onchain deposits.",
  },
  {
    id: "YIP-4",
    title: "Onchain registry & execution proofs",
    status: "implemented-draft" as const,
    summary: "The memo-anchored registry (finch-registry/1: kind, handle, manifest sha256 and URI, signed by the registry authority, rebuildable from Solana alone) and the proof-of-flight/0.2 receipt format for verifiable executions.",
  },
];
