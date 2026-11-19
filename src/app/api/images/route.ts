import { authenticatedOwner } from "@/server/auth";
import { RegisterError } from "@/server/errors";
import { maxImageBytes, saveImage } from "@/server/images";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const actor = await authenticatedOwner(request);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > maxImageBytes) throw new RegisterError(413, "That photo is too large. Try again.");
    const data = Buffer.from(await request.arrayBuffer());
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    return Response.json({ url: await saveImage(actor, type, data) }, { headers });
  } catch (error) {
    if (error instanceof RegisterError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Image upload failed", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "The photo didn't upload. Try again when connected." }, { status: 503, headers });
  }
}
