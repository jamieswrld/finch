import { isSolanaAddress } from "@finch/flightpath";
/**
 * Agent memory abstraction. The SDK owns the interface; adapters live where
 * their infrastructure lives (`@finch/db` provides the MongoDB vector adapter).
 */

export interface MemoryItem {
  role: "user" | "assistant" | "observation";
  content: string;
  at: string;
  /** Cosine-similarity score when returned from a vector recall. */
  score?: number;
  /**
   * Provenance. A memory with no origin is indistinguishable from a fact, and
   * that is precisely how a shared memory turns one hallucination into every
   * later finch's "knowledge". Every hive item says which run, nest, finch and
   * channel produced it, and what it was about.
   */
  subject?: string;
  runId?: string;
  nestId?: string;
  finch?: string;
  channel?: string;
  source?: "run" | "user";
}

export interface MemoryAdapter {
  append(item: Omit<MemoryItem, "at">): Promise<void>;
  /** Return the most relevant / most recent items for a query. */
  recall(query: string, limit?: number): Promise<MemoryItem[]>;
}

/** In-process ring buffer. Recency-based recall; gone on restart. */
export function ephemeralMemory(maxItems = 64): MemoryAdapter {
  const items: MemoryItem[] = [];
  return {
    async append(item) {
      items.push({ ...item, at: new Date().toISOString() });
      if (items.length > maxItems) items.splice(0, items.length - maxItems);
    },
    async recall(_query, limit = 12) {
      return items.slice(-limit);
    },
  };
}

export const nullMemory: MemoryAdapter = {
  async append() {},
  async recall() {
    return [];
  },
};


// ── Hive helpers (pure) ───────────────────────────────────────────────────

const BASE58 = /[1-9A-HJ-NP-Za-km-z]/;
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/**
 * The subject an objective is about: its first Solana address. Recall is
 * keyed on this, so a finch inspecting a token reads only that token's
 * history. Only a whole base58 run that decodes to 32 bytes counts — a slice
 * of a longer string, such as a transaction signature, is not an address.
 * No address means no subject — never a guess.
 */
export function subjectOf(text: string): string | null {
  const source = text ?? "";
  for (const match of source.matchAll(BASE58_RUN)) {
    const start = match.index ?? 0;
    const before = start > 0 ? source[start - 1]! : "";
    const after = source[start + match[0].length] ?? "";
    if (BASE58.test(before) || BASE58.test(after)) continue;
    if (isSolanaAddress(match[0])) return match[0];
  }
  return null;
}

/** Coarse, honest age for a label. */
export function describeAge(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown age";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Render recalled items for a model.
 *
 * The wording is part of the honesty contract. A prior finding is a LEAD:
 * it tells the finch where to look, and the grounding rules still require
 * that anything asserted came from a tool result in this run. Each line
 * carries its provenance so the model — and anyone reading the transcript —
 * can see it is history, not observation.
 */
export function formatRecall(items: MemoryItem[], now = Date.now()): string {
  if (items.length === 0) return "";
  const lines = items.map((item) => {
    const bits = [
      "prior finding",
      item.nestId ? `nest ${item.nestId}` : null,
      item.finch ?? null,
      item.runId ? item.runId.slice(0, 10) : null,
      describeAge(item.at, now),
      "unverified",
    ].filter(Boolean);
    return `- [${bits.join(" · ")}] ${item.content}`;
  });
  return (
    "Prior findings from the hive — leads, not facts. Each came from an earlier run and is UNVERIFIED for " +
    "this one: use them to decide what to read, then re-read the tool before asserting any of it.\n" +
    lines.join("\n")
  );
}
