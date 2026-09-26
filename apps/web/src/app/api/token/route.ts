import { readFinchToken, type FinchTokenReadout } from "@finch/flightpath";
import { errorJson, json, safeErrorMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/token — $FINCH as the chain reports it right now.
 *
 * Whether the mint exists yet, its pump.fun bonding curve (progress or
 * graduation), the mint account, Jupiter's price and holder count and
 * DexScreener's markets are each read live and each carry their own
 * reachable flag: one read failing never turns another into a guess, and a
 * failed read is reported as unreachable, never as zero.
 *
 * The readout is held for twenty seconds per instance so a page that polls
 * does not hammer the RPC; the response says whether it is fresh or cached
 * and when the cached copy was read, so a visitor knows how old a number is.
 */

const CACHE_MS = 20_000;

let cached: { readout: FinchTokenReadout; at: number } | null = null;
let inflight: Promise<FinchTokenReadout> | null = null;

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return json({ ...cached.readout, cache: "cached", cachedAt: new Date(cached.at).toISOString() });
  }

  try {
    // Coalesce concurrent misses into one chain read.
    inflight ??= readFinchToken();
    const readout = await inflight;
    const at = Date.now();
    cached = { readout, at };
    return json({ ...readout, cache: "fresh", cachedAt: new Date(at).toISOString() });
  } catch (error) {
    // readFinchToken isolates every sub-read and does not throw; if something
    // outside it does, say so with a 503 rather than a bare 500.
    return errorJson(503, safeErrorMessage(error), { cache: null, cachedAt: null });
  } finally {
    inflight = null;
  }
}
