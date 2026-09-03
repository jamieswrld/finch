import { describeGate } from "@/lib/server/publish-gate";
import { json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/publish/status — the publishing gate, as it stands.
 *
 * The UI renders exactly this: locked with the launch reason, or open with
 * the hold requirement. There is no state in which the page implies
 * publishing works when it does not.
 */
export async function GET(): Promise<Response> {
  return json({ ...describeGate(), at: new Date().toISOString() });
}
