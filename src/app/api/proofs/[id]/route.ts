import { authenticatedOwner } from "@/server/auth";
import { RegisterError } from "@/server/errors";
import { readProof } from "@/server/images";

export const runtime = "nodejs";

/** Proof photos need the same sign-in as the register, so they're fetched with it. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticatedOwner(request);
    const { id } = await ctx.params;
    const image = await readProof(actor, id);
    if (!image) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof RegisterError ? error.status : 503;
    return new Response("Unavailable", { status });
  }
}
