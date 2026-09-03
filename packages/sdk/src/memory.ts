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
