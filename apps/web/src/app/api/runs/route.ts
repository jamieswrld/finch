import { listRuns } from "@finch/db";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/runs — recent finch and nest runs.
 *
 * `source` says where the history came from: "db" is durable, "memory" is a
 * bounded in-process buffer used when no database is configured. The UI shows
 * that distinction rather than implying every run is permanently recorded.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const result = await listRuns(Number.isFinite(limit) ? limit : 20);
  return json(result);
}
