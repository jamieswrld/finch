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

  constructor(code: ProviderErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.code = code;
    this.status = options?.status;
    this.retryable = code === "rate_limit" || code === "server" || code === "network" || code === "timeout";
  }

  static fromStatus(status: number, body: string): ProviderError {
    const message = body.length > 400 ? `${body.slice(0, 400)}…` : body;
    if (status === 401 || status === 403) return new ProviderError("auth", `provider rejected credentials (${status}): ${message}`, { status });
    if (status === 429) return new ProviderError("rate_limit", `provider rate limit (${status}): ${message}`, { status });
    if (status >= 500) return new ProviderError("server", `provider error (${status}): ${message}`, { status });
    return new ProviderError("bad_request", `provider rejected request (${status}): ${message}`, { status });
  }
}

/** Retry with exponential backoff on retryable provider errors. */
export async function withRetries<T>(
  attempt: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 400;
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || i === maxRetries) throw error;
      const delay = baseDelayMs * 2 ** i + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
