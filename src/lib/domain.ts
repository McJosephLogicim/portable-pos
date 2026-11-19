import type {
  CartLine,
  Product,
  ReceiptLine,
  Sale,
  Shift,
  Tender,
} from "./types";

function scale(currency: string) {
  return (
    10 **
    (new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2)
  );
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

interface SaleInput {
  id: string;
  shift: Shift;
  sequence: number;
  cart: CartLine[];
  soldOut: string[];
  tender: Tender;
  received: number;
  createdAt: string;
}
export function makeSale(input: SaleInput): Sale {
  if (input.shift.closedAt || !input.cart.length)
    throw Error("An open shift and at least one item are required.");
  if (!["cash", "qr", "card"].includes(input.tender))
    throw Error("Invalid payment method.");
  const lines = priceLines(input.shift.menu, input.cart, input.soldOut);
  const total = totalLines(lines);
  if (
    !Number.isSafeInteger(input.received) ||
    input.received < total ||
    input.received > 2_147_483_647
  )
    throw Error("Enter cash that covers the order total.");
  if (input.tender !== "cash" && input.received !== total)
    throw Error("Confirm the exact amount received.");
  const sale = {
    id: input.id,
    shiftId: input.shift.id,
    sequence: input.sequence,
    createdAt: input.createdAt,
    lines,
    total,
    tender: input.tender,
    received: input.received,
    change: input.received - total,
  };
  if (new TextEncoder().encode(JSON.stringify(sale)).length > 1_000_000)
    throw Error("This order is too large for a single receipt.");
  return sale;
}

export function shiftTotals(shift: Shift, sales: Sale[]) {
  const result = {
    cash: 0,
    qr: 0,
    card: 0,
    total: 0,
    expectedCash: shift.openingCash,
    count: 0,
  };
  for (const sale of sales) {
    if (sale.shiftId !== shift.id || sale.reversedAt) continue;
    result[sale.tender] += sale.total;
    result.total += sale.total;
    result.count++;
  }
  result.expectedCash += result.cash;
  return result;
}
