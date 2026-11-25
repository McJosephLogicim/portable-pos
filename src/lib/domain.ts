import { currencyDigits, discountAmount, legacyPayment } from "./settings";
import { canMake, round, shiftStock, stockAmountFits, stockModel, withoutMenuCosts } from "./stock";
import type {
  CartLine,
  Expense,
  PaymentMethod,
  Product,
  ReceiptLine,
  ReceiptStockUse,
  Sale,
  Shift,
  StockItem,
  StockSet,
  Tender,
} from "./types";

export type MenuItemChange =
  | { action: "removeMenuItem"; productId: string }
  | { action: "restoreMenuItem"; item: Product; index: number };

export function changeMenuItem(menu: Product[], change: MenuItemChange) {
  const id = change.action === "removeMenuItem" ? change.productId : change.item.id;
  const index = menu.findIndex((item) => item.id === id);
  if (change.action === "removeMenuItem") {
    if (index < 0) throw Error("That item is already off the menu.");
    return {
      menu: menu.filter((item) => item.id !== id),
      deletedRecord: { kind: "menuItem" as const, item: menu[index], index },
    };
  }
  if (index >= 0) throw Error("That item is already on the menu.");
  return { menu: [...menu.slice(0, change.index), change.item, ...menu.slice(change.index)] };
}

/** Replace an item by id, including when a previous save already reached the server. */
export function saveMenuItem(menu: Product[], item: Product): Product[] {
  return menu.some((product) => product.id === item.id)
    ? menu.map((product) => (product.id === item.id ? item : product))
    : [...menu, item];
}

function scale(currency: string) {
  return 10 ** currencyDigits(currency);
}

/** A minor-unit amount as the plain text a seller would type, such as "120.00". */
export function amountText(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(minor / scale(currency));
}

/** Parse a display amount without rounding away a fractional minor unit. */
export function parseMoney(value: string, currency: string) {
  const input = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input))
    throw Error("Enter a valid amount.");
  const [whole, fraction = ""] = input.split(".");
  const unit = scale(currency);
  const places = Math.round(Math.log10(unit));
  if (fraction.length > places)
    throw Error(`Use up to ${places} decimal places.`);
  const result =
    Number(whole || "0") * unit + Number(fraction.padEnd(places, "0"));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647)
    throw Error("Amount is too large.");
  return result;
}

export function priceLines(
  menu: Product[],
  cart: CartLine[],
  soldOut: string[] = [],
): ReceiptLine[] {
  if (cart.length > 500) throw Error("One order can contain up to 500 lines.");
  const unavailable = new Set(soldOut);
  return cart.map((line) => {
    const product = menu.find((item) => item.id === line.productId);
    if (!product || unavailable.has(product.id))
      throw Error("An item in this order is unavailable.");
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 999
    )
      throw Error("Quantity must be between 1 and 999.");
    if (line.optionIds.length > 256)
      throw Error("An item can have up to 256 selected options.");
    const choices = new Set(line.optionIds);
    if (choices.size !== line.optionIds.length)
      throw Error("An option was added twice.");
    const selected = product.groups.flatMap((group) => {
      const picked = group.options.filter((option) => choices.has(option.id));
      if (group.required && picked.length !== 1)
        throw Error(`Choose one option for ${group.name}.`);
      return picked;
    });
    if (
      selected.length !== choices.size ||
      selected.some((option) => unavailable.has(option.id))
    )
      throw Error("An option in this order is unavailable.");
    const unitPrice = selected.reduce(
      (sum, option) => sum + option.price,
      product.price,
    );
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0)
      throw Error("An item in this order has a price that isn't right. Check the menu.");
    return {
      productId: product.id,
      quantity: line.quantity,
      optionIds: selected.map((option) => option.id),
      name: product.name,
      options: selected.map((option) => option.name),
      unitPrice,
    };
  });
}

export function totalLines(lines: ReceiptLine[]) {
  const total = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  if (!Number.isSafeInteger(total) || total < 0 || total > 2_147_483_647)
    throw Error("Order total is too large.");
  return total;
}

function productStockUses(item: Product): ReceiptStockUse[] {
  if (item.uses?.length) return item.uses.map(({ stockId, amount }) => ({ stockId, amount }));
  return item.stock ? [{ stockId: item.id, amount: 1, counted: true }] : [];
}

/** Older receipts used the first stock recipe the product had on the shift. */
export function legacyStockUses(
  menu: Product[],
  earlierMenus: Product[][],
  previous: Shift["legacyStockUses"] = {},
): Shift["legacyStockUses"] {
  const original = new Map(Object.entries(previous));
  for (const earlier of earlierMenus) {
    for (const item of earlier) {
      if (!original.has(item.id)) original.set(item.id, productStockUses(item));
    }
  }
  const current = new Map(menu.map((item) => [item.id, JSON.stringify(productStockUses(item))]));
  const changed = [...original].filter(([id, uses]) => current.get(id) !== JSON.stringify(uses));
  return changed.length ? Object.fromEntries(changed) : undefined;
}

/**
 * Replay the shift's sales in order. A "Count it" menu item always comes off its count.
 * A stock or prep item only comes off when there's enough of it: at zero, or too little
 * for the sale, the sale goes ahead and nothing is taken. Setting a new amount mid-shift
 * starts the item again from there.
 */
export function stockReplay(shift: Shift, sales: Sale[]) {
  const left: Record<string, number> = { ...(shift.stock ?? {}) };
  const used: Record<string, number> = Object.fromEntries(Object.keys(left).map((id) => [id, 0]));
  /** What each item started from: the opening amount, or the first amount set mid-shift. */
  const start: Record<string, number> = { ...left };
  /** Stock items a sale found too little of since they were last set. */
  const short = new Set<string>();
  const recipes = new Map(shift.menu.map((item) => [item.id, productStockUses(item)]));
  const original = new Map(Object.entries(shift.legacyStockUses ?? {}));
  const sold = sales
    .filter((sale) => sale.shiftId === shift.id && !sale.reversedAt)
    .map((sale) => ({ at: Date.parse(sale.createdAt), order: sale.sequence, sale }));
  const sets = (shift.stockSets ?? []).map((set) => ({ at: Date.parse(set.at), order: -1, set }));
  const events: ({ at: number; order: number } & ({ sale: Sale } | { set: StockSet }))[] = [...sold, ...sets];
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  const snap = (n: number) => {
    const rounded = round(n);
    // Keep the precision of a per-serving fraction, snapping away floating-point drift.
    return stockAmountFits(Math.abs(n - rounded), 0) ? rounded : n;
  };
  for (const event of events) {
    if ("set" in event) {
      left[event.set.stockId] = event.set.addition ? snap((left[event.set.stockId] ?? 0) + event.set.amount) : event.set.amount;
      used[event.set.stockId] ??= 0;
      start[event.set.stockId] ??= event.set.amount;
      short.delete(event.set.stockId);
      continue;
    }
    for (const line of event.sale.lines)
      for (const { stockId, amount, counted } of line.stockUses ??
        original.get(line.productId) ?? recipes.get(line.productId) ?? []) {
        if (!(stockId in left)) continue;
        const need = line.quantity * amount;
        if (!counted && !stockAmountFits(need, left[stockId])) {
          short.add(stockId);
          continue;
        }
        left[stockId] = snap(left[stockId] - need);
        used[stockId] = snap(used[stockId] + need);
      }
  }
  return { left, used, start, short };
}

/** How much of each stock item is still on hand this shift. */
export function stockLeft(shift: Shift, sales: Sale[]): Record<string, number> {
  return stockReplay(shift, sales).left;
}

/** Apply the full recipe to new orders while retaining the shift's stock counts. */
export function updateShiftMenu(
  shift: Shift,
  menu: Product[],
  counts: Record<string, number> = {},
  stockItems: StockItem[] = [],
  at = new Date().toISOString(),
): Shift {
  const current = withoutMenuCosts(menu);
  const stockSets = [...(shift.stockSets ?? [])];
  const counted = new Set([...Object.keys(shift.stock ?? {}), ...stockSets.map((set) => set.stockId)]);
  // Keep the labels of any counted products that are taken off sale.
  const tracked = new Map(shiftStock(shift).items.map((item) => [item.id, item]));
  const catalog = new Map(stockItems.map((item) => [item.id, item]));
  for (const item of current) {
    for (const use of productStockUses(item)) {
      if (counted.has(use.stockId)) continue;
      const ingredient = catalog.get(use.stockId);
      const startingCount = validCount(counts[use.stockId])
        ? counts[use.stockId]
        : use.counted ? 0 : ingredient?.onHand;
      if (!validCount(startingCount)) continue;
      counted.add(use.stockId);
      stockSets.push({ stockId: use.stockId, amount: startingCount, at });
      if (ingredient) tracked.set(ingredient.id, { id: ingredient.id, name: ingredient.name, unit: ingredient.unit });
      else if (use.counted) tracked.set(item.id, { id: item.id, name: item.name, unit: "piece" });
    }
  }

  return {
    ...shift,
    menu: current,
    legacyStockUses: legacyStockUses(current, [shift.menu], shift.legacyStockUses),
    stockSets: stockSets.length ? stockSets : undefined,
    settings: tracked.size ? { ...shift.settings, stockItems: [...tracked.values()] } : shift.settings,
  };
}

export function validCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1_000_000 && round(n) === n;
}

/**
 * Check what the opening screen sends. Menu items set to "Count it" must be counted.
 * Counting stock and prep items is optional: one left uncounted starts from the amount
 * saved on it, and one with neither isn't tracked. Every checklist line must be ticked.
 */
export function checkOpening(
  menu: Product[],
  stockItems: StockItem[] | undefined,
  checklist: { id: string }[],
  stock: Record<string, number>,
  checked: string[],
) {
  const { items } = stockModel(stockItems, menu);
  const opening: Record<string, number> = {};
  const { limits } = stockModel(stockItems, menu);
  for (const item of items) {
    const counted = stock[item.id];
    if (limits.has(item.id) && !validCount(counted)) throw Error(`Count the ${item.name} before opening.`);
    if (counted !== undefined && !validCount(counted)) throw Error(`Check the count for ${item.name}.`);
    const start = counted ?? item.onHand;
    if (validCount(start)) opening[item.id] = start;
  }
  if (checklist.some((c) => !checked.includes(c.id)))
    throw Error("Tick every line of the opening checklist.");
  return opening;
}

/**
 * Check the closing count. Menu items set to "Count it" must be counted. Stock and
 * prep items are optional: only the ones counted are kept.
 */
export function checkClosing(shift: Shift, counted: Record<string, number> | undefined) {
  // Everything tracked: counted at opening, or set during the shift.
  const opened = Object.keys(stockLeft(shift, []));
  const { items, limits } = shiftStock(shift);
  const kept: Record<string, number> = {};
  for (const id of opened) {
    const n = counted?.[id];
    const name = items.find((i) => i.id === id)?.name ?? "stock";
    if (n === undefined && limits.has(id)) throw Error(`Count the ${name} left before closing.`);
    if (n === undefined) continue;
    if (!validCount(n)) throw Error(`Check the count for ${name}.`);
    kept[id] = n;
  }
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * Set how much of a stock item is on hand during a shift. Sales from now take from the
 * new amount; earlier sales stay as they were. A stock item the shift wasn't tracking is
 * tracked from now.
 */
/**
 * What a closed shift had left of each stock item. Shifts closed before this was saved
 * fall back to the closing count, or the opening amount less what the sales used.
 */
export function shiftLeftovers(shift: Shift): Record<string, number> {
  if (shift.leftStock) return shift.leftStock;
  const left: Record<string, number> = {};
  for (const [id, n] of Object.entries(shift.stock ?? {}))
    if (!shift.stockSets?.some((set) => set.stockId === id)) left[id] = Math.max(0, round(n - (shift.usedStock?.[id] ?? 0)));
  return { ...left, ...shift.closingStock };
}

/**
 * Add up what finished booths had left of each stock and prep item. Items none of them
 * tracked are left out, so their starting amount stays as it is.
 */
export function mergeLeftovers(shifts: Shift[], stockItems: StockItem[] | undefined) {
  const ids = new Set((stockItems ?? []).map((item) => item.id));
  const total: Record<string, number> = {};
  for (const shift of shifts)
    for (const [id, n] of Object.entries(shiftLeftovers(shift)))
      if (ids.has(id) && Number.isFinite(n)) total[id] = round((total[id] ?? 0) + Math.max(0, n));
  return total;
}

/** Shifts whose leftovers can still be merged: closed, not merged yet, with something tracked. */
export function mergeableShifts(shifts: Shift[], stockItems: StockItem[] | undefined) {
  return shifts.filter((s) => s.closedAt && !s.mergedAt && Object.keys(mergeLeftovers([s], stockItems)).length);
}

export function setShiftStock(
  shift: Shift,
  stockItems: StockItem[] | undefined,
  now: Record<string, number>,
  at = new Date().toISOString(),
) {
  const ids = Object.keys(now).filter((id) => validCount(now[id]));
  if (!ids.length) return shift;
  const tracked = [...(shift.settings.stockItems ?? [])];
  const sets: StockSet[] = [...(shift.stockSets ?? [])];
  for (const id of ids) {
    const item = stockItems?.find((i) => i.id === id);
    if (!item) continue;
    if (!tracked.some((i) => i.id === id)) tracked.push({ id: item.id, name: item.name, unit: item.unit });
    sets.push({ stockId: id, amount: now[id], at });
  }
  return {
    ...shift,
    stockSets: sets,
    settings: tracked.length === (shift.settings.stockItems?.length ?? 0) ? shift.settings : { ...shift.settings, stockItems: tracked },
  };
}

/** Refuse an order that needs more of a "Count it" menu item than is left. Stock items never refuse one. */
export function checkStock(
  shift: Pick<Shift, "menu" | "settings">,
  cart: { productId: string; quantity: number }[],
  left: Record<string, number>,
) {
  const model = shiftStock(shift);
  const wanted = new Map<string, { amount: number; productId: string }>();
  for (const line of cart)
    for (const use of model.uses.get(line.productId) ?? [])
      if (use.stockId in left && model.limits.has(use.stockId)) {
        const now = wanted.get(use.stockId);
        wanted.set(use.stockId, {
          amount: (now?.amount ?? 0) + line.quantity * use.amount,
          productId: now?.productId ?? line.productId,
        });
      }
  for (const [id, need] of wanted) {
    const have = Math.max(0, left[id]);
    if (!stockAmountFits(need.amount, have)) {
      const name = shift.menu.find((p) => p.id === need.productId)?.name ?? "That item";
      const most = canMake(model, left, need.productId) ?? 0;
      throw Error(most ? `Only ${most} more ${name} can be made.` : `${name} is sold out.`);
    }
  }
}

interface SaleInput {
  id: string;
  shift: Shift;
  sequence: number;
  cart: CartLine[];
  soldOut: string[];
  tender: Tender;
  discountId?: string;
  received: number;
  createdAt: string;
  /** Units left of stock-tracked items before this sale. */
  stock?: Record<string, number>;
  /** Photos of the payment or discount ID. */
  proofs?: string[];
  /**
   * A sale another phone already took, arriving to be recorded. The money changed hands,
   * so sold-out marks, stock counts, photos and a closed shift don't turn it away.
   */
  recorded?: boolean;
}

/** How many proof photos a sale needs: one for the payment, one for the discount. */
export function proofsNeeded(shift: Shift, tender: Tender, discountId?: string) {
  const method = shift.settings.payments.find((p) => p.id === tender);
  const discount = discountId ? shift.settings.discounts.find((d) => d.id === discountId) : undefined;
  return (method?.proof ? 1 : 0) + (discount?.proof ? 1 : 0);
}

/** Subtotal, discount and total for a cart, using the shift's own discount list. */
export function priceOrder(
  shift: Shift,
  lines: ReceiptLine[],
  discountId?: string,
) {
  const subtotal = totalLines(lines);
  if (!discountId) return { subtotal, total: subtotal };
  const found = shift.settings.discounts.find((d) => d.id === discountId);
  if (!found) throw Error("That discount is not available this shift.");
  const amount = discountAmount(found, subtotal);
  return {
    subtotal,
    discount: { id: found.id, name: found.name, amount },
    total: subtotal - amount,
  };
}

export function makeSale(input: SaleInput): Sale {
  if ((input.shift.closedAt && !input.recorded) || !input.cart.length)
    throw Error("An open shift and at least one item are required.");
  // Methods switched off later stay in the shift snapshot so pending receipts still sync.
  const method = input.shift.settings.payments.find(
    (p) => p.id === input.tender,
  );
  if (!method) throw Error("That payment method isn't on this shift.");
  const recipes = new Map(input.shift.menu.map((item) => [item.id, productStockUses(item)]));
  const lines = priceLines(input.shift.menu, input.cart, input.recorded ? [] : input.soldOut).map((line) => ({
    ...line,
    stockUses: recipes.get(line.productId) ?? [],
  }));
  if (input.stock && !input.recorded) checkStock(input.shift, lines, input.stock);
  const { subtotal, discount, total } = priceOrder(
    input.shift,
    lines,
    input.discountId,
  );
  if (
    !Number.isSafeInteger(input.received) ||
    input.received < total ||
    input.received > 2_147_483_647
  )
    throw Error("Enter cash that covers the order total.");
  if (method.kind !== "cash" && input.received !== total)
    throw Error("Confirm the exact amount received.");
  const sale: Sale = {
    id: input.id,
    shiftId: input.shift.id,
    sequence: input.sequence,
    createdAt: input.createdAt,
    lines,
    subtotal,
    ...(discount ? { discount } : {}),
    total,
    tender: method.id,
    payment: {
      id: method.id,
      name: method.name,
      kind: method.kind,
      ...(method.icon && { icon: method.icon }),
      ...(method.presetId !== undefined && { presetId: method.presetId }),
    },
    received: input.received,
    change: input.received - total,
  };
  if (new TextEncoder().encode(JSON.stringify(sale)).length > 1_000_000)
    throw Error("This order is too large for a single receipt.");
  const proofs = input.proofs ?? [];
  if (!input.recorded && proofs.length < proofsNeeded(input.shift, input.tender, input.discountId))
    throw Error(
      discount && input.shift.settings.discounts.find((d) => d.id === discount.id)?.proof
        ? `Take a photo of the ${discount.name} ID first.`
        : `Take a photo of the ${method.name} payment first.`,
    );
  if (proofs.length) sale.proofs = proofs.slice(0, 4);
  return sale;
}

export interface MethodTotal extends Pick<PaymentMethod, "id" | "name" | "kind" | "icon" | "presetId"> {
  amount: number;
  count: number;
  expenses: number;
}

export function shiftTotals(shift: Shift, sales: Sale[], expenses: Expense[] = []) {
  const totals = totalsForRecords(shift.settings.payments, sales, expenses, shift.id);
  return { ...totals, expectedCash: shift.openingCash + totals.cash - totals.cashExpenses };
}

/** Booking history is already scoped. Register snapshots contain records from other tills. */
export function totalsForRecords(payments: PaymentMethod[], sales: Sale[], expenses: Expense[], shiftId?: string) {
  const methods = new Map<string, MethodTotal>(
    payments
      .filter((p) => p.on)
      .map((p) => [p.id, { ...p, amount: 0, count: 0, expenses: 0 }]),
  );
  const result = {
    cash: 0,
    total: 0,
    discounts: 0,
    count: 0,
    reversed: 0,
    methods: [] as MethodTotal[],
    /** Paid from any till payment method. */
    tillExpenses: 0,
    cashExpenses: 0,
    /** Paid by someone out of pocket, owed back to them. */
    pocketExpenses: 0,
  };
  for (const e of expenses) {
    if ((shiftId !== undefined && e.shiftId !== shiftId) || e.voidedAt) continue;
    if (e.source === "pocket") {
      result.pocketExpenses += e.amount;
      continue;
    }
    result.tillExpenses += e.amount;
    const deduction = e.deduction;
    if (!deduction || deduction.kind === "cash") result.cashExpenses += e.amount;
    if (deduction?.kind === "member") continue;
    const saved = payments.find((method) => deduction
      ? method.id === deduction.id
      : method.id === "cash" && method.kind === "cash")
      ?? (!deduction ? payments.find((method) => method.kind === "cash") : undefined);
    const payment = saved ?? (deduction ? { ...deduction, kind: deduction.kind } : legacyPayment("cash"));
    const row = methods.get(payment.id) ?? { ...payment, amount: 0, count: 0, expenses: 0 };
    row.expenses += e.amount;
    methods.set(row.id, row);
  }
  for (const sale of sales) {
    if (shiftId !== undefined && sale.shiftId !== shiftId) continue;
    if (sale.reversedAt) {
      result.reversed++;
      continue;
    }
    const row = methods.get(sale.payment.id) ?? {
      ...sale.payment,
      amount: 0,
      count: 0,
      expenses: 0,
    };
    row.amount += sale.total;
    row.count++;
    methods.set(row.id, row);
    if (sale.payment.kind === "cash") result.cash += sale.total;
    result.total += sale.total;
    result.discounts += sale.discount?.amount ?? 0;
    result.count++;
  }
  result.methods = [...methods.values()];
  return result;
}
