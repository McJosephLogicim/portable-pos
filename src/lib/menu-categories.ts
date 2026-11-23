import type { Product } from "./types";

export type MenuCategoryChange =
  | { action: "saveMenuCategory"; name: string; previous?: string; itemIds?: string[] }
  | { action: "removeMenuCategories"; names: string[] };

/** Keep the saved order and include categories from menus created before the list existed. */
export function menuCategoryNames(menu: Product[], saved: readonly string[] = []) {
  return [...new Set([...saved, ...menu.map((item) => item.category)].map((name) => name.trim()).filter(Boolean))];
}

export function changeMenuCategories(menu: Product[], saved: string[] | undefined, change: MenuCategoryChange) {
  const current = menuCategoryNames(menu, saved);
  if (change.action === "removeMenuCategories") {
    const removed = new Set(change.names);
    return {
      menu: menu.map((item) => removed.has(item.category.trim()) ? { ...item, category: "" } : item),
      menuCategories: current.filter((name) => !removed.has(name)),
    };
  }
  const { name, previous, itemIds } = change;
  if (!previous && !itemIds?.length) return { menu, menuCategories: menuCategoryNames(menu, [...current, name]) };
  if (previous && !current.includes(previous)) {
    // A retry after a successful rename has nothing left to change.
    if (current.includes(name)) return { menu, menuCategories: current };
    throw Error("That category has changed. Open it again to make changes.");
  }
  const picked = new Set(itemIds);
  const next = menu.map((item) => {
    const category = picked.has(item.id) ? name : item.category.trim() === previous ? "" : item.category;
    return category === item.category ? item : { ...item, category };
  });
  const ordered = previous ? current.map((entry) => entry === previous ? name : entry) : [...current, name];
  return { menu: next, menuCategories: menuCategoryNames(next, ordered) };
}
