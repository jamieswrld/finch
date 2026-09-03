import { getFlightpathTarget, getNetworkStatus, getPonsConfig } from "@finch/flightpath";
import { getDb, isDbConfigured } from "@finch/db";
import { probeProviders, providerStatus, resolveProviderFromEnv } from "@finch/providers";
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

  // A key is only as configured as the provider says it is. Probes are
  // cached for ten minutes, so this costs one call per provider per window.
  const resolved = resolveProviderFromEnv();
  const probes = await probeProviders();
  const available = providerStatus().map((entry) => {
    const probe = probes.find((candidate) => candidate.id === entry.id);
    return { ...entry, probe: probe ? { status: probe.status, httpStatus: probe.httpStatus, detail: probe.detail } : null };
  });
  const activeProbe = resolved ? probes.find((candidate) => candidate.id === resolved.spec.id) : undefined;
  const compute = {
    configured: Boolean(resolved),
    // "active" is the cheapest configured provider; whether its key WORKS is
    // a separate, reported fact.
    active: resolved
      ? { id: resolved.spec.id, label: resolved.spec.label, cost: resolved.spec.cost, keyStatus: activeProbe?.status ?? "unknown" }
      : null,
    available,
    invalidKeys: probes.filter((candidate) => candidate.status === "invalid").map((candidate) => candidate.id),
  };

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
    compute,
    at: new Date().toISOString(),
  });
}
