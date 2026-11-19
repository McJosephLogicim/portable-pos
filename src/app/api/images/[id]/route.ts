import { readImage } from "@/server/images";

export const runtime = "nodejs";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const image = await readImage(id).catch(() => null);
  if (!image) return new Response("Not found", { status: 404 });
  // An image id never points at different bytes, so phones can keep it forever.
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
