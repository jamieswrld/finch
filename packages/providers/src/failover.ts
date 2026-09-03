import type { ResolvedProvider } from "./catalog.ts";
import { ProviderError } from "./errors.ts";
import type { ChatRequest, ChatResponse, ModelProvider } from "./types.ts";

/**
 * Providers whose credential was rejected, and until when to skip them.
 * A 401 is a fact about the key, not the request: retrying it on every task
 * burns a slot and turns a rate-limited burst into an auth error. Ten
 * minutes is long enough to stop the churn and short enough that a fixed
 * key is picked up without a restart.
 */
const DEAD_MS = 10 * 60 * 1000;
const deadUntil = new Map<string, number>();

/** Test seam. */
export function clearDeadProviders(): void {
  deadUntil.clear();
}

/** Which failures are the PROVIDER's rather than the request's. */
function shouldAdvance(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  // rate_limit / server / network / timeout: the provider is busy or down.
  // auth: the provider rejected OUR key. Every one of these is the same
  // request on a different provider away from succeeding. bad_request,
  // parse and unsupported are the request's problem on any provider.
  return error.retryable || error.code === "auth";
}


/**
 * Fail over between configured providers on rate limits.
 *
 * A nest fans several tool-heavy finches out at once. On a free tier with a
 * tokens-per-minute ceiling that is a burst the ceiling was never going to
 * absorb, and one 429 used to fail the task outright — while a second,
 * perfectly idle provider key sat configured and unused.
 *
 * This wrapper walks the configured chain in cost order. It advances on
 * failures that belong to the PROVIDER — rate limit, outage, timeout, and a
 * rejected credential — after the adapter's own retries are exhausted. It
 * never advances on a bad request or an unknown model: those are the same
 * on every provider and must surface as what they are. A provider that
 * rejects the key is remembered as dead for ten minutes so a truncated paste
 * cannot turn every burst into a 401. Streaming and embeddings stay on the
 * primary; a nest task uses chat.
 */
/**
 * Every provider failed. Throwing only the last one's error hid the real
 * story: a run that "failed on OpenRouter" had in fact exhausted Groq's
 * per-minute budget first. Name each provider and what it said, keep the
 * last one's code and status so callers still classify it, and carry the
 * longest retry hint any of them offered.
 */
function aggregate(failures: Array<{ id: string; error: unknown }>): ProviderError {
  if (failures.length === 1) {
    const only = failures[0]!.error;
    if (only instanceof ProviderError) return only;
  }
  const describe = (error: unknown) =>
    error instanceof ProviderError ? `${error.code}${error.status ? ` ${error.status}` : ""}` : error instanceof Error ? error.message.slice(0, 60) : "unknown";
  const last = failures[failures.length - 1]?.error;
  const code = last instanceof ProviderError ? last.code : "network";
  const status = last instanceof ProviderError ? last.status : undefined;
  const retryAfterMs = Math.max(0, ...failures.map((f) => (f.error instanceof ProviderError ? f.error.retryAfterMs ?? 0 : 0))) || undefined;
  return new ProviderError(
    code,
    `all ${failures.length} providers failed: ${failures.map((f) => `${f.id} → ${describe(f.error)}`).join("; ")}`,
    { status, retryAfterMs, cause: last },
  );
}

export function withFailover(chain: ResolvedProvider[]): ModelProvider {
  const primary = chain[0];
  if (!primary) throw new Error("withFailover: no providers configured");

  const fallbacks = chain.slice(1).map((entry) => entry.spec.id);
  const info = {
    ...primary.provider.info,
    label: fallbacks.length > 0 ? `${primary.provider.info.label} (failover: ${fallbacks.join(", ")})` : primary.provider.info.label,
  };

  return {
    info,
    stream: primary.provider.stream ? primary.provider.stream.bind(primary.provider) : undefined,
    embed: primary.provider.embed ? primary.provider.embed.bind(primary.provider) : undefined,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const now = Date.now();
      const live = chain.filter((entry) => (deadUntil.get(entry.spec.id) ?? 0) <= now);
      const candidates = live.length > 0 ? live : chain; // if all are marked dead, try anyway
      const failures: Array<{ id: string; error: unknown }> = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        try {
          return await candidate.provider.chat(request);
        } catch (error) {
          failures.push({ id: candidate.spec.id, error });
          if (error instanceof ProviderError && error.code === "auth") {
            deadUntil.set(candidate.spec.id, now + DEAD_MS);
          }
          const isLast = index === candidates.length - 1;
          if (!shouldAdvance(error)) throw error; // the request's fault: surface it as-is
          if (isLast) throw aggregate(failures);
        }
      }
      throw aggregate(failures);
    },
  };
}
