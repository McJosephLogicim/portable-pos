import { currencyDigits } from "./settings";
import type { PricingRules, Product, Settings, Shift, StockItem, StockPrep, StockPurchase, StockUse } from "./types";

export const units = ["piece", "pack", "box", "bottle", "cup", "tray", "kg", "g", "L", "mL"];
export const maxBatchServings = 100_000;

/** Counts can be fractions, like 1.5 kg, so keep three decimals and no float drift. */
export const round = (n: number) => Math.round(n * 1000) / 1000;

const unpluralized = new Set(["kg", "g", "mg", "l", "ml", "oz", "lb", "lbs", "pc", "pcs", "tsp", "tbsp", "dozen"]);

/** "1 piece", "2 pieces", "2 boxes", "0.5 kg": a unit read as a word after its amount. */
export function unitFor(amount: number | undefined, unit: string) {
  const u = unit.trim();
  if (amount === undefined || amount === 1 || !/[a-z]$/i.test(u)) return u;
  const last = u.split(" ").pop()!.toLowerCase();
  if (unpluralized.has(last) || last.length <= 2 || /s$/.test(last)) return u;
  if (/(x|z|ch|sh)$/.test(last)) return u + "es";
  if (/[^aeiou]y$/.test(last)) return u.slice(0, -1) + "ies";
  return u + "s";
}

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
  return { ...total, batchMaterialCost: materials.cost, materialPerServing, costRatio: price ? total.cost / price : undefined };
}

export function batchStockUses(batch: NonNullable<Product["costing"]>["batch"]): StockUse[] {
  if (!batch?.deductFromStock) return [];
  return batch.uses.map(({ stockId, amount }) => ({ stockId, amount: amount / batch.servings }));
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
  return menu.map((product) => {
    const hasNotes = product.uses?.some((use) => use.notes !== undefined);
    if (!product.costing && !hasNotes) return product;
    const { costing: _, ...tillItem } = product;
    if (hasNotes) tillItem.uses = product.uses!.map(({ notes: _notes, ...use }) => use);
    return tillItem;
  });
}

export function catalogSku(kind: "stock" | "product", id: string) {
  const code = id.replace(/[^a-z0-9]/gi, "").slice(0, 12) || id.slice(0, 12);
  return `${kind === "stock" ? "STK" : "PRD"}-${code.toUpperCase()}`;
}

export function duplicateSku(skus: (string | undefined)[]) {
  const seen = new Set<string>();
  for (const sku of skus) {
    if (!sku) continue;
    const key = sku.toUpperCase();
    if (seen.has(key)) return sku;
    seen.add(key);
  }
}

export function pricingRules(currency: string, saved?: PricingRules): PricingRules {
  return saved ?? { targetMargin: 70, roundingIncrement: (currency === "PHP" ? 5 : 1) * 10 ** currencyDigits(currency) };
}

export function readTargetMargin(value: string) {
  const target = Number(value);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) || target < 0 || target >= 100)
    throw Error("Enter a target margin from 0% to less than 100%.");
  return target;
}

export function pricingInCurrency(settings: Settings, previous: string, currency: string) {
  if (!settings.pricing || previous === currency) return settings;
  const difference = currencyDigits(currency) - currencyDigits(previous);
  if (!difference) return settings;
  const converted = Math.round(settings.pricing.roundingIncrement * 10 ** difference);
  return {
    ...settings,
    pricing: {
      ...settings.pricing,
      roundingIncrement: Math.max(1, converted <= 2_147_483_647 ? converted : pricingRules(currency).roundingIncrement),
    },
  };
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

export function menuCostingOverview(menu: Product[], stock: StockItem[], pricing: PricingRules) {
  const rates = stockCostRates(stock);
  const rows = menu.map((item) => {
    const batch = item.costing?.batch;
    const lines = (batch?.uses ?? item.uses ?? []).map(({ stockId, amount }) => {
      const rate = rates.get(stockId);
      return rate === undefined ? undefined : rate * amount;
    });
    const cost = menuRecipeCost(lines, batch?.servings ?? 1, item.costing?.laborPerServing ?? 0, item.costing?.otherPerServing ?? 0, item.price);
    const target = item.costing?.targetMargin ?? pricing.targetMargin;
    const suggested = cost && suggestedPrice(cost.cost, target, pricing.roundingIncrement);
    return { item, cost, suggested };
  });
  const complete = rows.flatMap(({ cost }) => cost ? [cost] : []);
  const priced = complete.filter((cost) => cost.costRatio !== undefined);
  const averageCost = complete.length ? complete.reduce((sum, cost) => sum + cost.cost, 0) / complete.length : undefined;
  const averageCostRatio = priced.length ? priced.reduce((sum, cost) => sum + cost.costRatio!, 0) / priced.length : undefined;
  const averageMargin = priced.length ? priced.reduce((sum, cost) => sum + cost.margin!, 0) / priced.length : undefined;
  return { rows, costed: complete.length, averageCost, averageCostRatio, averageMargin };
}

/** Cost sources belong to the owner and aren't needed to run the till. */
export function withoutStockCosts<T extends Settings>(settings: T): T {
  if (!settings.pricing && !settings.stockLists && !settings.stockItems?.some((item) => item.purchase || item.prep || item.details)) return settings;
  const till = { ...settings };
  delete till.pricing;
  delete till.stockLists;
  if (settings.stockItems)
    till.stockItems = settings.stockItems.map(({ purchase: _, prep: _prep, details: _details, ...item }) => item);
  return till;
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

/** Allow for floating-point arithmetic when comparing fractional deductions. */
export function stockAmountFits(amount: number, available: number) {
  return amount <= available + Math.max(1e-12, Math.abs(available) * Number.EPSILON * 8);
}

/** How many more of a menu item the stock left can make, or undefined if it uses none. */
export function canMake(model: StockModel, left: Record<string, number>, productId: string) {
  const uses = model.uses.get(productId);
  if (!uses) return undefined;
  let most = Infinity;
  for (const u of uses) {
    if (!(u.stockId in left)) continue;
    const available = Math.max(0, left[u.stockId]);
    const whole = Math.floor(available / u.amount);
    most = Math.min(most, stockAmountFits((whole + 1) * u.amount, available) ? whole + 1 : whole);
  }
  return most === Infinity ? undefined : most;
}
