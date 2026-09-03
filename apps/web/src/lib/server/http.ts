import { NextResponse } from "next/server";

/** Shared server-route helpers: JSON responses, body guards, rate limiting. */

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorJson(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

const MAX_BODY_BYTES = 128 * 1024;

export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return { ok: false, response: errorJson(413, "request body too large") };
  }
  try {
    const body = (await request.json()) as unknown;
    return { ok: true, body };
  } catch {
    return { ok: false, response: errorJson(400, "invalid JSON body") };
  }
}

/**
 * In-memory token bucket per client IP. Suitable for a single instance;
 * production replaces this with a shared store (documented in SECURITY.md).
 */
const buckets = new Map<string, { tokens: number; updatedAt: number }>();
const BUCKET_CAPACITY = 20;
const REFILL_PER_SECOND = 0.5;

export function rateLimit(request: Request, cost = 1): NextResponse | null {
  // x-forwarded-for is client-writable. Trust only the hop your proxy appends:
  // count TRUSTED_PROXY_HOPS from the RIGHT, never the leftmost entry (which
  // any caller can forge to get a fresh bucket per request).
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const ip =
    (forwarded && forwarded.length > 0
      ? forwarded[Math.max(0, forwarded.length - Math.max(1, hops))]
      : undefined) ??
    request.headers.get("x-real-ip") ??
    "local";
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { tokens: BUCKET_CAPACITY, updatedAt: now };
  const elapsed = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsed * REFILL_PER_SECOND);
  bucket.updatedAt = now;
  if (bucket.tokens < cost) {
    buckets.set(ip, bucket);
    return errorJson(429, "rate limit exceeded — slow down");
  }
  bucket.tokens -= cost;
  buckets.set(ip, bucket);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (buckets.size > 5000) {
    for (const [key, value] of buckets) {
      if (now - value.updatedAt > 10 * 60 * 1000) buckets.delete(key);
    }
  }
  return null;
}
