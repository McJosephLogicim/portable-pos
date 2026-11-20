import { readInviteCode } from "@/lib/join-link";
import { invitePreview } from "@/server/link-preview";

export const runtime = "nodejs";

/** Shows who sent an invite link before the person signs in. */
export async function GET(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = readInviteCode((await ctx.params).code);
  const headers = { "Cache-Control": "no-store" };
  const preview = code ? await invitePreview(code).catch(() => undefined) : null;
  if (preview === undefined) return Response.json({ error: "Unavailable" }, { status: 503, headers });
  if (!preview) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json(preview, { headers });
}
