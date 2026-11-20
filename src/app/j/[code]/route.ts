import { readJoinCode } from "@/lib/join-link";

/** Short join links open the app, which finds the team and the shift on the phone. */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL("/", request.url);
  if (readJoinCode(code)) url.searchParams.set("j", code);
  return Response.redirect(url, 307);
}
