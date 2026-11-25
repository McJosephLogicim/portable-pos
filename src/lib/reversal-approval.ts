import type { ReversalEvent } from "./types";

export type ReversalDetails = Omit<ReversalEvent, "approval">;

// Bind an encrypted PIN to one correction. Changing any detail requires fresh approval.
export function reversalLabel(businessId: string, memberId: string, deviceId: string, event: ReversalDetails) {
  return new TextEncoder().encode(JSON.stringify(["pos-reversal-v1", businessId, memberId, deviceId,
    event.id, event.shiftId, event.targetId, event.at, event.reason]));
}

export async function sealReversalPin(publicKey: string, pin: string, label: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0)),
    { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP", label }, key, new TextEncoder().encode(pin));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}
