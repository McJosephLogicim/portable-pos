import { z } from "zod";
import { commandLabel, digest, exitsRegister, offlineActions } from "../lib/offline-command";
import { getDb } from "./db";
import { ensure } from "./errors";
import { openReversalPin } from "./pin";
import { resolveAccess, type Actor } from "./team";

const envelope = z.object({
  request: z.object({
    id: z.uuid(), at: z.iso.datetime(), businessId: z.uuid(), memberId: z.uuid(),
    deviceId: z.string().min(1).max(128), till: z.uuid().nullable(),
    command: z.record(z.string(), z.unknown()), before: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict(),
  approval: z.string().max(512).optional(),
});

export async function readOfflineCommand(actor: Actor, input: unknown) {
  if (!input || typeof input !== "object" || !("action" in input) || input.action !== "offlineCommand") return;
  const parsed = envelope.safeParse(input);
  ensure(parsed.success, "This saved change could not be read.", 400);
  const { request, approval } = parsed.data;
  const command = request.command;
  ensure(typeof command.action === "string" && offlineActions.includes(command.action) && !("pin" in command),
    "This action requires a connection.", 400);
  ensure(!actor.businessId || actor.businessId === request.businessId, "Open the matching business to sync.", 403);
  actor.businessId = request.businessId;
  const access = await getDb().transaction((tx) => resolveAccess(tx, actor));
  const exit = exitsRegister(command.action);
  ensure(!exit || command.businessId === request.businessId, "Open the matching business to sync.", 403);
  if (exit && !access) return { request, fingerprint: "", join: false, finishedExit: true,
    input: { action: "bootstrap", deviceId: request.deviceId, till: null } };
  ensure(access && access.member.id === request.memberId, "This membership has changed.", 403);
  const pin = approval && openReversalPin(access.business.reversalPrivateKey, approval, commandLabel(request));
  ensure(!approval || pin, "Enter the owner PIN again to sync this change.", 403);
  const join = command.action === "joinTill";
  if (join) ensure(z.uuid().safeParse(command.shiftId).success, "Choose a saved till.");
  return {
    request, fingerprint: await digest([actor.id, request]), join,
    input: { ...command, ...(command.action === "createBusiness" && { action: "setup", id: request.id }), ...(pin ? { pin } : {}), deviceId: request.deviceId,
      ...(join ? { action: "bootstrap", till: command.shiftId } : { till: request.till }) },
  };
}
