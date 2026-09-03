import { PROVIDER_CATALOG, isProviderConfigured, type ProviderSpec } from "./catalog.ts";

/**
 * Does a configured key actually work?
 *
 * "Configured" used to mean "the environment variable is non-empty". A
 * truncated paste is non-empty. It sat in the failover chain answering 401 to
 * every request that reached it, and the status surface reported it as fine.
 *
 * A probe is one cheap authenticated call — GET /models — cached for ten
 * minutes so it never becomes traffic. The result is what an operator needs:
 * valid, invalid (the provider rejected the credential), unreachable (the
 * provider did not answer), or unconfigured.
 */

export type ProbeStatus = "valid" | "invalid" | "unreachable" | "unconfigured";

export interface ProviderProbe {
  id: string;
  label: string;
  cost: ProviderSpec["cost"];
  status: ProbeStatus;
  httpStatus: number | null;
  detail: string | null;
  checkedAt: string;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { result: ProviderProbe; until: number }>();

function keyFor(spec: ProviderSpec): string | null {
  if (!spec.envKey) return null; // local runtimes take no credential
  const value = typeof process !== "undefined" ? process.env[spec.envKey] : undefined;
  return value && value.length > 0 ? value : null;
}

export async function probeProvider(spec: ProviderSpec, now = Date.now()): Promise<ProviderProbe> {
  const hit = cache.get(spec.id);
  if (hit && hit.until > now) return hit.result;

  const base = { id: spec.id, label: spec.label, cost: spec.cost, checkedAt: new Date(now).toISOString() };
  const finish = (result: ProviderProbe): ProviderProbe => {
    cache.set(spec.id, { result, until: now + TTL_MS });
    return result;
  };

  if (!isProviderConfigured(spec)) {
    return finish({ ...base, status: "unconfigured", httpStatus: null, detail: null });
  }

  const key = keyFor(spec);
  try {
    const response = await fetch(`${spec.baseUrl.replace(/\/$/, "")}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return finish({ ...base, status: "valid", httpStatus: response.status, detail: null });
    const text = (await response.text().catch(() => "")).slice(0, 160);
    const status: ProbeStatus = response.status === 401 || response.status === 403 ? "invalid" : "unreachable";
    return finish({ ...base, status, httpStatus: response.status, detail: text || null });
  } catch (error) {
    return finish({
      ...base,
      status: "unreachable",
      httpStatus: null,
      detail: error instanceof Error ? error.message.slice(0, 160) : "probe failed",
    });
  }
}

/** Probe every catalog entry in parallel. Unconfigured ones cost nothing. */
export async function probeProviders(): Promise<ProviderProbe[]> {
  return Promise.all(PROVIDER_CATALOG.map((spec) => probeProvider(spec)));
}

/** Test seam. */
export function clearProbeCache(): void {
  cache.clear();
}
