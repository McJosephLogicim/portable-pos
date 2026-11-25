import type { Booking, Business, Organizer, Product } from "./types";
import { withoutMenuCosts, withoutStockCosts } from "./stock";
import type { OwnerAction } from "./demo";
import { planActions } from "./team";

export type LocalAction = OwnerAction | (Omit<Extract<OwnerAction, { action: "setup" }>, "action"> & { action: "createBusiness" }) | { action: "joinTill"; shiftId: string };
export const offlineActions: readonly string[] = [
  "open", "close", "joinTill", "adjustTill", "link", "linkBooking", "profile", "menu",
  "saveMenuCategory", "removeMenuCategories", "removeMenuItem", "restoreMenuItem", "mode",
  "settings", "mergeStock", "completeOnboarding", "createBusiness", "deleteBusiness", ...planActions,
];

export interface OfflineRequest {
  id: string;
  at: string;
  businessId: string;
  memberId: string;
  deviceId: string;
  till: string | null;
  command: Record<string, unknown>;
  before?: string;
}

export interface CommandEvent {
  type: "command";
  id: string;
  shiftId: string;
  request: OfflineRequest;
  approval?: string;
  photos?: Record<string, string>;
  failure?: string;
}

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
      : entry);
}

export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
}

export function commandLabel(request: OfflineRequest) {
  return new TextEncoder().encode("pos-command-v1:" + canonical(request));
}

// Generate the same immutable URL when another offline edit reuses a saved photo.
export async function prepareCommandPhotos(value: unknown, scope: string) {
  const json = JSON.stringify(value);
  const photos: Record<string, string> = {};
  const urls = new Map<string, string>();
  for (const match of json.matchAll(/"(data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+)"/g)) {
    const photo = match[1];
    if (urls.has(photo)) continue;
    const hash = await digest([scope, photo]);
    const id = [hash.slice(0, 8), hash.slice(8, 12), "4" + hash.slice(13, 16), "a" + hash.slice(17, 20), hash.slice(20, 32)].join("-");
    photos[id] = photo;
    urls.set(photo, "/api/images/" + id);
  }
  return { value: JSON.parse(json, (_, v) => urls.get(v) ?? v), photos };
}

export function exitsRegister(action: unknown) {
  return action === "deleteBusiness" || action === "leaveTeam";
}

/** Check bulk replacements against the version the operator actually edited. */
export function commandBase(action: string, business: Business, menu: Product[], organizers: Organizer[], booking?: Booking) {
  switch (action) {
    case "menu": return menu;
    case "settings": return [business.name, business.currency, business.timeZone, business.settings];
    case "organizers": return organizers;
    case "open": return [business.currency, withoutMenuCosts(menu), withoutStockCosts(business.settings)];
    case "booking":
    case "deleteBooking": {
      if (!booking) return null;
      const { id, startsAt, endsAt, place, organizer, event, seats, staff, rent, quota, incentive } = booking;
      return { id, startsAt, endsAt, place, organizer, event, seats, staff, rent: rent ?? 0, quota, incentive };
    }
  }
}
