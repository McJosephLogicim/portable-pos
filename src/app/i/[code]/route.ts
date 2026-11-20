import { readInviteCode } from "@/lib/join-link";

/** Invite links open the app, which keeps the code through sign-in and then joins the team. */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL("/", request.url);
  if (readInviteCode(code)) url.searchParams.set("invite", code);
  return Response.redirect(url, 307);
}
