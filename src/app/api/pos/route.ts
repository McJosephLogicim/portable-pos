import { getDb } from "@/server/db";
import { historyPage } from "@/server/snapshot";
import { authenticatedOwner } from "@/server/auth";
import { RegisterError } from "@/server/errors";
import { readCommand } from "@/server/request";
import { runCommand } from "@/server/register";
import { resolveAccess } from "@/server/team";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const actor = await authenticatedOwner(request);
    const body = await readCommand(request);
    if (
      typeof body === "object" &&
      body &&
      "action" in body &&
      body.action === "historyPage"
    ) {
      const cursor = "cursor" in body ? body.cursor : undefined;
      return Response.json(
        await getDb().transaction(async (tx) => {
          const access = await resolveAccess(tx, actor, false);
          const till = access && (access.member.owner || access.member.roles.includes("cashier"));
          return historyPage(tx, till ? access.business.id : undefined, cursor);
        }),
        { headers },
      );
    }
    return Response.json(await runCommand(actor, body), { headers });
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
          "Something went wrong on our side. Try again in a moment.",
      },
      { status: 503, headers },
    );
  }
}
