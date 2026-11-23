import type { Product } from "./types";

/** The first available photo wins, so historical views can prefer their shift's menu. */
export function itemPhotos(...menus: (readonly Product[])[]) {
  const photos = new Map<string, string>();
  for (const menu of menus) {
    for (const item of menu) {
      if (item.image && !photos.has(item.id)) photos.set(item.id, item.image);
    }
  }
  return photos;
}

export function itemInitials(name: string) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]);
  return initials.join("").toUpperCase() || "?";
}
