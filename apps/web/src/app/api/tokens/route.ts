import { readTrackedTokens } from "@finch/flightpath";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tokens — ERC20 metadata read live from Robinhood Chain.
 *
 * Every value is a contract read performed for this request. A contract that
 * cannot be read comes back with reachable:false and the error, never with a
 * remembered or assumed value.
 */
export async function GET(): Promise<Response> {
  const tokens = await readTrackedTokens();
  return json({ chainId: 4663, tokens, at: new Date().toISOString() });
}
