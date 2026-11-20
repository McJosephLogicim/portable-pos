import { readJoinCode } from "@/lib/join-link";
import { shiftPreview } from "@/server/link-preview";

export const runtime = "nodejs";

/** Shows which shift a shared link opens before the person signs in. */
export async function GET(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const raw = (await ctx.params).code;
  const headers = { "Cache-Control": "no-store" };
  const preview = readJoinCode(raw)?.shift ? await shiftPreview(raw).catch(() => undefined) : null;
  if (preview === undefined) return Response.json({ error: "Unavailable" }, { status: 503, headers });
  if (!preview) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json(preview, { headers });
}
