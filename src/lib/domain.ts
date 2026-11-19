import { currencyDigits, discountAmount } from "./settings";
import type {
  CartLine,
  Product,
  ReceiptLine,
  Sale,
  Shift,
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
      throw Error("Invalid item price.");
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

/** Units of each stock-tracked item still on hand this shift. */
export function stockLeft(shift: Shift, sales: Sale[]): Record<string, number> {
  const left = { ...(shift.stock ?? {}) };
  for (const sale of sales) {
    if (sale.shiftId !== shift.id || sale.reversedAt) continue;
    for (const line of sale.lines)
      if (line.productId in left) left[line.productId] -= line.quantity;
  }
  return left;
}

/**
 * Items added to the menu during a shift go on sale at once. Edits to items already
 * on the till wait for the next shift so receipts keep their prices.
 */
export function withNewItems(
  shift: Shift,
  menu: Product[],
  counts: Record<string, number> = {},
): Shift {
  const fresh = menu.filter((p) => !shift.menu.some((m) => m.id === p.id));
  if (!fresh.length) return shift;
  const stock = { ...(shift.stock ?? {}) };
  for (const p of fresh) if (p.stock) stock[p.id] = counts[p.id] ?? 0;
  return { ...shift, menu: [...shift.menu, ...fresh], stock };
}

/** Check what the opening screen sends: a count for every tracked item and every checklist line ticked. */
export function checkOpening(
  menu: Product[],
  checklist: { id: string }[],
  stock: Record<string, number>,
  checked: string[],
) {
  for (const p of menu)
    if (p.stock && !(Number.isInteger(stock[p.id]) && stock[p.id] >= 0))
      throw Error(`Count the ${p.name} before opening.`);
  if (checklist.some((c) => !checked.includes(c.id)))
    throw Error("Tick every line of the opening checklist.");
  return Object.fromEntries(menu.filter((p) => p.stock).map((p) => [p.id, stock[p.id]]));
}

/** Refuse an order that asks for more of a counted item than is left. */
export function checkStock(
  menu: Product[],
  cart: { productId: string; quantity: number }[],
  left: Record<string, number>,
) {
  const wanted = new Map<string, number>();
  for (const line of cart)
    if (line.productId in left)
      wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  for (const [id, quantity] of wanted) {
    const have = Math.max(0, left[id]);
    if (quantity > have) {
      const name = menu.find((p) => p.id === id)?.name ?? "that item";
      throw Error(have ? `Only ${have} ${name} left.` : `${name} is sold out.`);
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
  if (input.shift.closedAt || !input.cart.length)
    throw Error("An open shift and at least one item are required.");
  // Methods switched off later stay in the shift snapshot so pending receipts still sync.
  const method = input.shift.settings.payments.find(
    (p) => p.id === input.tender,
  );
  if (!method) throw Error("Invalid payment method.");
  const lines = priceLines(input.shift.menu, input.cart, input.soldOut);
  if (input.stock) checkStock(input.shift.menu, lines, input.stock);
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
  if (proofs.length < proofsNeeded(input.shift, input.tender, input.discountId))
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

export function shiftTotals(shift: Shift, sales: Sale[]) {
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
  };
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
  result.expectedCash += result.cash;
  return result;
}
