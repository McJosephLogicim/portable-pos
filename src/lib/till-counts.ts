import { checkCount, type CashCount } from "./cash";
import { setShiftStock, stockLeft, validCount } from "./domain";
import { shiftStock } from "./stock";
import type { Sale, Shift, StockItem } from "./types";

export type TillCount =
  | { kind: "float"; previous: number; previousCount?: CashCount; amount: number; count?: CashCount }
  | { kind: "stock"; stockId: string; previous: number | null; amount: number; newItem?: { name: string; unit: string } };

export function tillStockItems(shift: Shift, catalog: StockItem[] = []) {
  const items = shiftStock(shift).items;
  const known = new Set(items.map((item) => item.id));
  return [...items, ...catalog.filter((item) => !known.has(item.id))];
}

/** Only change the count the seller saw. Another device may have sold or recounted meanwhile. */
export function adjustTillCount(shift: Shift, sales: Sale[], catalog: StockItem[] | undefined, change: TillCount) {
  if (shift.closedAt) throw Error("This till has closed.");
  if (change.kind === "float") {
    if (shift.openingCash !== change.previous || JSON.stringify(shift.openingCount ?? {}) !== JSON.stringify(change.previousCount ?? {})) throw Error("The float changed. Reopen the editor for the latest amount.");
    if (!Number.isSafeInteger(change.amount) || change.amount < 0 || change.amount > 2147483647)
      throw Error("Enter a valid cash float.");
    return { ...shift, openingCash: change.amount, openingCount: checkCount(change.count, change.amount) };
  }
  if (!validCount(change.amount)) throw Error("Enter a stock count from 0 to 1,000,000.");
  const items = tillStockItems(shift, catalog);
  let item = items.find((entry) => entry.id === change.stockId);
  if (change.newItem) {
    const name = change.newItem.name.trim().toLowerCase();
    if (item || items.some((entry) => entry.name.toLowerCase() === name))
      throw Error("This stock item already exists. Select it from the list.");
    item = { id: change.stockId, ...change.newItem };
  }
  if (!item) throw Error("This item is no longer available.");
  const current = stockLeft(shift, sales)[item.id] ?? null;
  if (current !== change.previous) throw Error("Stock changed. Reopen the editor for the latest count.");
  return setShiftStock(shift, [item], { [item.id]: change.amount });
}
