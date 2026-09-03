export type ProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "bad_request"
  | "server"
  | "network"
  | "unsupported"
  | "parse";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  /** How long the provider itself asked us to wait, when it said so. */
  readonly retryAfterMs?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown; retryAfterMs?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.code = code;
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
    this.retryable = code === "rate_limit" || code === "server" || code === "network" || code === "timeout";
  }

  static fromStatus(status: number, body: string): ProviderError {
    const message = body.length > 400 ? `${body.slice(0, 400)}…` : body;
    if (status === 401 || status === 403) return new ProviderError("auth", `provider rejected credentials (${status}): ${message}`, { status });
    if (status === 429) {
      return new ProviderError("rate_limit", `provider rate limit (${status}): ${message}`, {
        status,
        // Providers say exactly how long to wait ("Please try again in 6.4575s").
        // Guessing shorter just burns the retry budget and fails anyway.
        retryAfterMs: parseRetryAfter(body),
      });
    }
    if (status >= 500) return new ProviderError("server", `provider error (${status}): ${message}`, { status });
    return new ProviderError("bad_request", `provider rejected request (${status}): ${message}`, { status });
  }
}

/**
 * Pull a wait hint out of a rate-limit body.
 *
 * Groq and friends state the exact delay in the message. Backing off 400ms
 * against a "try again in 6.4s" limit fails every attempt and reports the
 * request as broken when it was only early.
 */
function parseRetryAfter(body: string): number | undefined {
  const seconds = /try again in\s+([0-9.]+)\s*s/i.exec(body);
  if (seconds?.[1]) return Math.ceil(Number(seconds[1]) * 1000);
  const ms = /try again in\s+([0-9.]+)\s*ms/i.exec(body);
  if (ms?.[1]) return Math.ceil(Number(ms[1]));
  return undefined;
}

/** Retry with exponential backoff on retryable provider errors. */
export async function withRetries<T>(
  attempt: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  // Free tiers are token-per-minute limited and a nest runs tasks in parallel,
  // so a burst hitting the ceiling is expected traffic, not an error. Wait it
  // out rather than reporting a working provider as broken.
  const maxRetries = options?.maxRetries ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 400;
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || i === maxRetries) throw error;
      const hinted = error instanceof ProviderError ? error.retryAfterMs : undefined;
      const backoff = baseDelayMs * 2 ** i + Math.random() * 100;
      // Honour the provider's own hint when it is longer than our backoff,
      // capped so a pathological hint cannot hang the request forever.
      const delay = Math.min(Math.max(hinted ?? 0, backoff), 15_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
