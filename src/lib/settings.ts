import type {
  Discount,
  PaymentKind,
  PaymentMethod,
  Settings,
  ShiftSettings,
} from "./types";

export const paymentKinds: { kind: PaymentKind; name: string }[] = [
  { kind: "cash", name: "Cash" },
  { kind: "wallet", name: "E-wallet" },
  { kind: "card", name: "Card" },
  { kind: "bank", name: "Bank transfer" },
  { kind: "other", name: "Other" },
];

/** Methods a new register starts with. Philippine sellers get the wallets their customers carry. */
export function defaultPayments(currency: string): PaymentMethod[] {
  const wallets: PaymentMethod[] =
    currency === "PHP"
      ? [
          { id: "gcash", name: "GCash", kind: "wallet", on: true },
          { id: "maya", name: "Maya", kind: "wallet", on: true },
        ]
      : [{ id: "qr", name: "E-wallet", kind: "wallet", on: true }];
  return [
    { id: "cash", name: "Cash", kind: "cash", on: true },
    ...wallets,
    { id: "card", name: "Card", kind: "card", on: true },
  ];
}

export function defaultDiscounts(currency: string): Discount[] {
  return currency === "PHP"
    ? [
        {
          id: "senior-pwd",
          name: "Senior / PWD",
          type: "percent",
          value: 20,
          on: true,
          proof: true,
        },
      ]
    : [];
}

export function defaultSettings(currency: string): Settings {
  return {
    receiptNote: "",
    payments: defaultPayments(currency),
    discounts: defaultDiscounts(currency),
  };
}

/** Shifts opened before settings existed accepted these three tenders. */
export function legacyShiftSettings(currency: string): ShiftSettings {
  return {
    currency,
    receiptNote: "",
    payments: [
      { id: "cash", name: "Cash", kind: "cash", on: true },
      { id: "qr", name: "QR payment", kind: "wallet", on: true },
      { id: "card", name: "Card", kind: "card", on: true },
    ],
    discounts: [],
  };
}

export function legacyPayment(tender: string): PaymentMethod {
  return (
    legacyShiftSettings("USD").payments.find((p) => p.id === tender) ?? {
      id: tender,
      name: tender,
      kind: "other",
      on: true,
    }
  );
}

export function currencyDigits(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Amount taken off a subtotal. Percentages round to the nearest minor unit. */
export function discountAmount(discount: Discount, subtotal: number) {
  const raw =
    discount.type === "percent"
      ? Math.round((subtotal * discount.value) / 100)
      : discount.value;
  return Math.max(0, Math.min(subtotal, raw));
}

export function checkSettings(settings: Settings) {
  const ids = (list: { id: string }[]) =>
    new Set(list.map((item) => item.id)).size === list.length;
  if (!ids(settings.payments) || !ids(settings.discounts))
    throw Error("Each payment method and discount needs its own name.");
  if (!settings.payments.some((method) => method.on))
    throw Error("Keep at least one payment method on.");
  for (const discount of settings.discounts) {
    if (
      discount.type === "percent" &&
      (discount.value < 1 || discount.value > 100)
    )
      throw Error("Percent discounts go from 1 to 100.");
    if (discount.type === "fixed" && discount.value < 1)
      throw Error("Enter an amount for " + discount.name + ".");
  }
}

/** A readable, stable id for a new method or discount. */
export function slugId(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "item";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = base + "-" + n;
  return id;
}

/**
 * New settings for an open shift. A method or discount that was removed stays in the
 * snapshot, switched off, so receipts that already used it keep validating.
 */
export function mergeShiftSettings(
  current: ShiftSettings,
  next: Settings,
): ShiftSettings {
  const keep = <T extends { id: string; on: boolean }>(old: T[], now: T[]) => [
    ...now,
    ...old
      .filter((item) => !now.some((n) => n.id === item.id))
      .map((item) => ({ ...item, on: false })),
  ];
  return {
    currency: current.currency,
    receiptNote: next.receiptNote,
    payments: keep(current.payments, next.payments),
    discounts: keep(current.discounts, next.discounts),
    // The till counts what it opened with; new stock items start next shift.
    ...(current.stockItems ? { stockItems: current.stockItems } : {}),
  };
}
