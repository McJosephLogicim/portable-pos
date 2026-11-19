import type { Product, Settings, Shift, StockItem, StockPrep, StockPurchase, StockUse } from "./types";

export const units = ["piece", "pack", "box", "bottle", "cup", "tray", "kg", "g", "L", "mL"];
export const maxBatchServings = 100_000;

/** Counts can be fractions, like 1.5 kg, so keep three decimals and no float drift. */
export const round = (n: number) => Math.round(n * 1000) / 1000;

/** Keep fraction-of-a-cent precision until the full recipe is totaled. */
export function stockUnitCost(purchase: StockPurchase) {
  return purchase.price / (purchase.quantity * ((purchase.yieldPercent ?? 100) / 100));
}

export function menuCost(lines: (number | undefined)[], price?: number) {
  if (!lines.length) return undefined;
  let cost = 0;
  for (const line of lines) {
    if (line === undefined) return undefined;
    cost += line;
  }
  if (!Number.isSafeInteger(Math.round(cost))) return undefined;
  return {
    cost,
    profit: price === undefined ? undefined : price - cost,
    margin: price ? (price - cost) / price : undefined,
  };
}

export function menuRecipeCost(
  lines: (number | undefined)[],
  servings: number,
  laborPerServing: number,
  otherPerServing: number,
  price?: number,
) {
  const materials = menuCost(lines);
  if (!materials || !Number.isInteger(servings) || servings < 1 || servings > maxBatchServings) return undefined;
  const materialPerServing = materials.cost / servings;
  const total = menuCost([materialPerServing, laborPerServing, otherPerServing], price);
  if (!total) return undefined;
  return { ...total, batchMaterialCost: materials.cost, materialPerServing };
}

/** A batch recipe references current stock items even when the till counts finished servings. */
export function batchIngredientProblem(menu: Product[], items: StockItem[] = []) {
  const known = new Set(items.map((item) => item.id));
  for (const product of menu) {
    if (product.costing?.batch?.uses.some((use) => !known.has(use.stockId)))
      return `${product.name} has a batch recipe that uses a stock item that is missing. Edit the recipe first.`;
  }
}

export function withoutMenuCosts(menu: Product[]) {
  if (!menu.some((product) => product.costing)) return menu;
  return menu.map(({ costing: _, ...product }) => product);
}

export function prepCost(prep: StockPrep, items: ReadonlyMap<string, StockItem>) {
  const ingredients = menuCost(prep.uses.map((use) => {
    const item = items.get(use.stockId);
    return item?.purchase && !item.prep ? stockUnitCost(item.purchase) * use.amount : undefined;
  }));
  if (!ingredients) return undefined;
  const batch = ingredients.cost + (prep.extraBatchCost ?? 0);
  const unit = batch / prep.yieldQuantity;
  if (!Number.isSafeInteger(Math.round(batch)) || !Number.isSafeInteger(Math.round(unit))) return undefined;
  return { batch, unit };
}

export function stockCostRates(items: StockItem[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rates = new Map<string, number>();
  for (const item of items) {
    const cost = item.prep
      ? prepCost(item.prep, byId)?.unit
      : item.purchase && stockUnitCost(item.purchase);
    if (cost !== undefined) rates.set(item.id, cost);
  }
  return rates;
}

export function checkPrepRecipes(items: StockItem[] = []) {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length && items.some((item) => item.prep))
    throw Error("Each stock item needs a unique ID before it can be used in prep recipes.");
  for (const item of items) {
    if (!item.prep) continue;
    if (item.purchase) throw Error(`Choose one cost source for ${item.name}.`);
    const stockIds = item.prep.uses.map((use) => use.stockId);
    if (new Set(stockIds).size !== stockIds.length) throw Error(`${item.name} lists an ingredient twice.`);
    for (const id of stockIds) {
      const ingredient = byId.get(id);
      if (!ingredient) throw Error(`${item.name} uses a stock item that is missing. Edit the prep recipe first.`);
      if (ingredient.prep) throw Error(`${item.name} can only use purchased stock items. Edit the prep recipe first.`);
    }
  }
}

export function suggestedPrice(cost: number, targetPercent: number, increment: number) {
  if (targetPercent < 0 || targetPercent >= 100 || increment <= 0) return undefined;
  const steps = cost / (1 - targetPercent / 100) / increment;
  // Avoid rounding up an extra step when a floating-point result is just over an integer.
  const rounded = Math.ceil(steps - Number.EPSILON * steps) * increment;
  return rounded <= 2_147_483_647 ? rounded : undefined;
}

/** Cost sources belong to the owner and aren't needed to run the till. */
export function withoutStockCosts<T extends Settings>(settings: T): T {
  if (!settings.stockItems?.some((item) => item.purchase || item.prep)) return settings;
  return {
    ...settings,
    stockItems: settings.stockItems.map(({ purchase: _, prep: _prep, ...item }) => item),
  };
}

export function hasStockCostAmounts(settings: Settings) {
  return settings.stockItems?.some((item) => item.purchase || item.prep?.extraBatchCost !== undefined) ?? false;
}

export function unitText(amount: number, unit: string) {
  const n = round(amount);
  const plural = n !== 1 && !["kg", "g", "L", "mL"].includes(unit);
  return `${n.toLocaleString("en", { maximumFractionDigits: 3 })} ${unit}${plural ? (unit.endsWith("x") ? "es" : "s") : ""}`;
}

export interface StockModel {
  items: StockItem[];
  uses: Map<string, StockUse[]>;
}

/**
 * The stock items a till counts and what each menu item uses. A menu item from before
 * stock items existed, marked as counted, becomes a stock item of its own.
 */
export function stockModel(items: StockItem[] | undefined, menu: Product[]): StockModel {
  const all = [...(items ?? [])];
  const uses = new Map<string, StockUse[]>();
  for (const p of menu) {
    if (p.uses?.length) uses.set(p.id, p.uses);
    else if (p.stock) {
      if (!all.some((i) => i.id === p.id)) all.push({ id: p.id, name: p.name, unit: "piece" });
      uses.set(p.id, [{ stockId: p.id, amount: 1 }]);
    }
  }
  const known = new Set(all.map((i) => i.id));
  for (const [id, list] of uses) {
    const kept = list.filter((u) => known.has(u.stockId) && u.amount > 0);
    if (kept.length) uses.set(id, kept);
    else uses.delete(id);
  }
  return { items: all, uses };
}

export function shiftStock(shift: Pick<Shift, "menu" | "settings">) {
  return stockModel(shift.settings.stockItems, shift.menu);
}

/** How many more of a menu item the stock left can make, or undefined if it uses none. */
export function canMake(model: StockModel, left: Record<string, number>, productId: string) {
  const uses = model.uses.get(productId);
  if (!uses) return undefined;
  let most = Infinity;
  for (const u of uses) {
    if (!(u.stockId in left)) continue;
    most = Math.min(most, Math.floor(round(Math.max(0, left[u.stockId]) / u.amount)));
  }
  return most === Infinity ? undefined : most;
}
