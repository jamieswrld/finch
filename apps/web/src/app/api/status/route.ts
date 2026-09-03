import { getFlightpathTarget, getNetworkStatus, getPonsConfig } from "@finch/flightpath";
import { getDb, isDbConfigured } from "@finch/db";
import { providerStatus, resolveProviderFromEnv } from "@finch/providers";
import { json, safeErrorMessage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/status — infrastructure connectivity, honestly reported. */
export async function GET(): Promise<Response> {
  const target = getFlightpathTarget();
  const pons = getPonsConfig();

  const [network, db] = await Promise.all([
    getNetworkStatus(target),
    (async () => {
      if (!isDbConfigured()) return { configured: false, reachable: null as boolean | null };
      try {
        const database = await getDb();
        await database.command({ ping: 1 });
        return { configured: true, reachable: true as boolean | null };
      } catch (error) {
        return {
          configured: true,
          reachable: false as boolean | null,
          error: safeErrorMessage(error, 140),
        };
      }
    })(),
  ]);

  return json({
    db,
    chain: {
      robinhoodConfigured: target.robinhoodConfigured,
      label: target.label,
      chainId: target.chain.id,
      reachable: network.reachable,
      blockNumber: network.blockNumber,
      gasPriceGwei: network.gasPriceGwei,
      latencyMs: network.latencyMs,
      error: network.error,
    },
    pons: { configured: pons.configured },
    compute: (() => {
      const resolved = resolveProviderFromEnv();
      return {
        configured: Boolean(resolved),
        active: resolved ? { id: resolved.spec.id, label: resolved.spec.label, cost: resolved.spec.cost } : null,
        available: providerStatus(),
      };
    })(),
    at: new Date().toISOString(),
  });
}
