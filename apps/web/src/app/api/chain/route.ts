import { getNetworkStatus, probeEndpoints, type NetworkStatus } from "@finch/flightpath";
import { json } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chain — live Robinhood Chain telemetry.
 *
 * Every field is a real RPC read. Because this endpoint is public and polled
 * by every visitor, results are shared behind a short TTL cache: one upstream
 * sample serves all concurrent readers rather than multiplying RPC load by
 * the number of open tabs. The cache is deliberately shorter than the poll
 * interval, and `sampledAt` always states when the numbers were taken.
 */
const TTL_MS = 5_000;

type Payload = NetworkStatus & { endpoints: Awaited<ReturnType<typeof probeEndpoints>> };

let cached: { at: number; payload: Payload } | null = null;
let inflight: Promise<Payload> | null = null;

async function sample(): Promise<Payload> {
  const [status, endpoints] = await Promise.all([getNetworkStatus(), probeEndpoints()]);
  return { ...status, endpoints };
}

async function getTelemetry(): Promise<Payload> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.payload;
  // Collapse a thundering herd into a single upstream sample.
  if (inflight) return inflight;
  inflight = sample()
    .then((payload) => {
      cached = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function GET(request: Request): Promise<Response> {
  const limited = rateLimit(request, 1);
  if (limited) return limited;

  const payload = await getTelemetry();
  return json(payload, {
    headers: { "cache-control": `public, max-age=0, s-maxage=5, stale-while-revalidate=15` },
  });
}
