import type { Product, Shift, StockItem, StockUse } from "./types";

export const units = ["piece", "pack", "box", "bottle", "cup", "tray", "kg", "g", "L", "mL"];

/** Counts can be fractions, like 1.5 kg, so keep three decimals and no float drift. */
export const round = (n: number) => Math.round(n * 1000) / 1000;

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
