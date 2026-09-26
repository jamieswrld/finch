import { getFlightpathTarget, readTrackedTokens } from "@finch/flightpath";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tokens — tracked mints, read live from Solana.
 *
 * Every value is a mint-account read performed for this request. A mint that
 * cannot be read — or does not exist yet — comes back with reachable:false and
 * the reason, never with a remembered or assumed value.
 */
export async function GET(): Promise<Response> {
  const target = getFlightpathTarget();
  const tokens = await readTrackedTokens(target);
  return json({ chain: target.chain, tokens, at: new Date().toISOString() });
}
