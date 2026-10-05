import { createHiveMemory, isDbConfigured } from "@finch/db";
import { subjectOf } from "@finch/sdk";
import { errorJson, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/memory?subject=<address> — what the network has already found about a
 * subject, with provenance.
 *
 * Shared memory is what every completed built-in swarm writes into and every
 * agent reads from. It is inspectable on purpose: "the network learns"
 * is a claim, and this is where anyone can check it — which run, which swarm,
 * which agent, which channel, when. Nothing here is presented as fact; each
 * item is a prior finding a later run may confirm or contradict.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("subject") ?? "";
  const subject = subjectOf(raw);
  if (!subject) return errorJson(400, "subject must contain a Solana address");

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);

  if (!isDbConfigured()) {
    return json({ configured: false, subject, findings: [], note: "no registry database — shared memory has nowhere to live in this environment" });
  }

  const hive = createHiveMemory({ subject });
  const findings = await hive.recall("", limit);
  return json({
    configured: true,
    subject,
    count: findings.length,
    findings: findings.map((item) => ({
      at: item.at,
      nestId: item.nestId ?? null,
      finch: item.finch ?? null,
      channel: item.channel ?? null,
      runId: item.runId ?? null,
      content: item.content,
    })),
    at: new Date().toISOString(),
  });
}
