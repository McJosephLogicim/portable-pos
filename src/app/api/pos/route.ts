import { getDb } from "@/server/db";
import { historyPage } from "@/server/snapshot";
import { authenticatedOwner } from "@/server/auth";
import { RegisterError } from "@/server/errors";
import { readCommand } from "@/server/request";
import { runCommand } from "@/server/register";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const ownerId = await authenticatedOwner(request);
    const body = await readCommand(request);
    if (
      typeof body === "object" &&
      body &&
      "action" in body &&
      body.action === "historyPage"
    ) {
      const cursor = "cursor" in body ? body.cursor : undefined;
      return Response.json(
        await getDb().transaction((tx) => historyPage(tx, ownerId, cursor)),
        { headers },
      );
    }
    return Response.json(await runCommand(ownerId, body), { headers });
  } catch (error) {
    if (error instanceof RegisterError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    }
    console.error(
      "Register operation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      {
        error:
          "The register service could not complete the request. Retry when connected.",
      },
      { status: 503, headers },
    );
  }
}
