import type { Settings, StockItem, StockListField } from "./types";

export const stockListFields = {
  category: { title: "Prep categories", noun: "prep category", maxLength: 60, placeholder: "e.g. Syrups" },
  kind: { title: "Stock types", noun: "stock type", maxLength: 60, placeholder: "e.g. Ingredient" },
  supplier: { title: "Suppliers", noun: "supplier", maxLength: 120, placeholder: "e.g. Local dairy" },
} satisfies Record<StockListField, { title: string; noun: string; maxLength: number; placeholder: string }>;

const defaultStockTypes = ["Ingredient", "Packaging", "Consumable"];

export function stockListKey(name?: string) {
  return (name ?? "").trim().toLowerCase();
}

export function stockListNames(settings: Settings, field: StockListField) {
  const names = new Map<string, string>();
  const saved = settings.stockLists?.[field] ?? (field === "kind" ? defaultStockTypes : []);
  const remember = (value?: string) => {
    const key = stockListKey(value);
    if (value && key && !names.has(key)) names.set(key, value.trim());
  };
  saved.forEach(remember);
  // Items saved before stock lists existed supply their existing choices.
  settings.stockItems?.forEach((item) => remember(item.details?.[field]));
  return [...names.values()];
}

export function stockListsOf(settings: Settings): Record<StockListField, string[]> {
  return {
    category: stockListNames(settings, "category"),
    kind: stockListNames(settings, "kind"),
    supplier: stockListNames(settings, "supplier"),
  };
}

export function editStockList(settings: Settings, field: StockListField, previous: string | undefined, next: string) {
  const name = next.trim();
  const before = stockListKey(previous);
  const key = stockListKey(name);
  const stockLists = stockListsOf(settings);
  const names = stockLists[field];
  const index = names.findIndex((value) => stockListKey(value) === before);
  if (key !== before && names.some((value) => stockListKey(value) === key))
    throw Error(`That ${stockListFields[field].noun} already exists.`);

  const usedBy = (item: StockItem) => Boolean(before) && stockListKey(item.details?.[field]) === before;
  if (!name && settings.stockItems?.some(usedBy))
    throw Error(`Change the items using this ${stockListFields[field].noun} before removing it.`);

  const replacement = name ? [name] : [];
  names.splice(index < 0 ? names.length : index, index < 0 ? 0 : 1, ...replacement);
  return {
    stockLists,
    ...(before && name && settings.stockItems && {
      stockItems: settings.stockItems.map((item) =>
        usedBy(item) ? { ...item, details: { ...item.details, [field]: name } } : item,
      ),
    }),
  };
}
