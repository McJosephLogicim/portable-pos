import { currencyDigits, discountAmount } from "./settings";
import { canMake, round, shiftStock, stockAmountFits, stockModel, withoutMenuCosts } from "./stock";
import type {
  CartLine,
  Expense,
  Product,
  ReceiptLine,
  Sale,
  Shift,
  StockItem,
  Tender,
} from "./types";

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

/** How much of each stock item is still on hand this shift. */
export function stockLeft(shift: Shift, sales: Sale[]): Record<string, number> {
  const left = { ...(shift.stock ?? {}) };
  const model = shiftStock(shift);
  const sold = new Map<string, number>();
  for (const sale of sales) {
    if (sale.shiftId !== shift.id || sale.reversedAt) continue;
    for (const line of sale.lines) sold.set(line.productId, (sold.get(line.productId) ?? 0) + line.quantity);
  }
  const used = new Map<string, number>();
  for (const [productId, quantity] of sold) {
    for (const { stockId, amount } of model.uses.get(productId) ?? []) {
      if (stockId in left) used.set(stockId, (used.get(stockId) ?? 0) + quantity * amount);
    }
  }
  for (const [stockId, amount] of used) {
    const start = left[stockId];
    const remaining = start - amount;
    // Keep the precision of a per-serving fraction, snapping away floating-point drift.
    const rounded = round(remaining);
    left[stockId] = stockAmountFits(Math.abs(remaining - rounded), 0) ? rounded : remaining;
  }
  return left;
}

/**
 * Apply menu edits on the open till. Keep the opening stock rules and any removed
 * items until closing so stock used by earlier sales can still be reconciled.
 */
export function updateShiftMenu(
  shift: Shift,
  menu: Product[],
  counts: Record<string, number> = {},
  /** The business's stock items, for ones the till starts counting mid-shift. */
  stockItems: StockItem[] = [],
): Shift {
  const byId = new Map(withoutMenuCosts(menu).map((item) => [item.id, item]));
  const current = shift.menu.map((item) => {
    const updated = byId.get(item.id);
    byId.delete(item.id);
    if (!updated) return item;
    const { stock, uses, ...details } = updated;
    return {
      ...details,
      ...(item.stock !== undefined ? { stock: item.stock } : {}),
      ...(item.uses !== undefined ? { uses: item.uses } : {}),
    };
  });
  const fresh = [...byId.values()];
  if (!fresh.length) return { ...shift, menu: current };
  const stock = { ...(shift.stock ?? {}) };
  const tracked = [...(shift.settings.stockItems ?? [])];
  // A new item counted on its own needs a count now. One that uses stock items the
  // till already counts just draws on them. A stock item the till didn't count at
  // opening, like one added with this item, is counted from now so sales draw it down
  // and closing asks for what's left.
  for (const p of fresh) {
    if (p.uses?.length) {
      for (const use of p.uses) {
        if (use.stockId in stock || !validCount(counts[use.stockId])) continue;
        const item = stockItems.find((i) => i.id === use.stockId);
        if (!item) continue;
        stock[use.stockId] = counts[use.stockId];
        if (!tracked.some((i) => i.id === item.id)) tracked.push({ id: item.id, name: item.name, unit: item.unit });
      }
    } else if (p.stock && !(p.id in stock)) stock[p.id] = validCount(counts[p.id]) ? counts[p.id] : 0;
  }
  const settings = tracked.length === (shift.settings.stockItems?.length ?? 0)
    ? shift.settings
    : { ...shift.settings, stockItems: tracked };
  return { ...shift, menu: [...current, ...fresh], stock, settings };
}

function validCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1_000_000 && round(n) === n;
}

/** Check what the opening screen sends: a count for every stock item and every checklist line ticked. */
export function checkOpening(
  menu: Product[],
  stockItems: StockItem[] | undefined,
  checklist: { id: string }[],
  stock: Record<string, number>,
  checked: string[],
) {
  const { items } = stockModel(stockItems, menu);
  for (const item of items)
    if (!validCount(stock[item.id])) throw Error(`Count the ${item.name} before opening.`);
  if (checklist.some((c) => !checked.includes(c.id)))
    throw Error("Tick every line of the opening checklist.");
  return Object.fromEntries(items.map((i) => [i.id, stock[i.id]]));
}

/** Check the closing count: a number for every stock item the shift opened with. */
export function checkClosing(shift: Shift, counted: Record<string, number> | undefined) {
  const opened = Object.keys(shift.stock ?? {});
  if (!opened.length) return undefined;
  const { items } = shiftStock(shift);
  for (const id of opened)
    if (!validCount(counted?.[id]))
      throw Error(`Count the ${items.find((i) => i.id === id)?.name ?? "stock"} left before closing.`);
  return Object.fromEntries(opened.map((id) => [id, counted![id]]));
}

/** Refuse an order that needs more of a stock item than is left. */
export function checkStock(
  shift: Pick<Shift, "menu" | "settings">,
  cart: { productId: string; quantity: number }[],
  left: Record<string, number>,
) {
  const model = shiftStock(shift);
  const wanted = new Map<string, { amount: number; productId: string }>();
  for (const line of cart)
    for (const use of model.uses.get(line.productId) ?? [])
      if (use.stockId in left) {
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
  const lines = priceLines(input.shift.menu, input.cart, input.recorded ? [] : input.soldOut);
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
    payment: { id: method.id, name: method.name, kind: method.kind },
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

export interface MethodTotal {
  id: string;
  name: string;
  kind: string;
  amount: number;
  count: number;
}

export function shiftTotals(shift: Shift, sales: Sale[], expenses: Expense[] = []) {
  const methods = new Map<string, MethodTotal>(
    shift.settings.payments
      .filter((p) => p.on)
      .map((p) => [p.id, { ...p, amount: 0, count: 0 }]),
  );
  const result = {
    cash: 0,
    total: 0,
    discounts: 0,
    expectedCash: shift.openingCash,
    count: 0,
    reversed: 0,
    methods: [] as MethodTotal[],
    /** Paid with cash from the till. */
    tillExpenses: 0,
    /** Paid by someone out of pocket, owed back to them. */
    pocketExpenses: 0,
  };
  for (const e of expenses) {
    if (e.shiftId !== shift.id || e.voidedAt) continue;
    if (e.source === "till") result.tillExpenses += e.amount;
    else result.pocketExpenses += e.amount;
  }
  for (const sale of sales) {
    if (sale.shiftId !== shift.id) continue;
    if (sale.reversedAt) {
      result.reversed++;
      continue;
    }
    const row = methods.get(sale.payment.id) ?? {
      ...sale.payment,
      amount: 0,
      count: 0,
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
  result.expectedCash += result.cash - result.tillExpenses;
  return result;
}
