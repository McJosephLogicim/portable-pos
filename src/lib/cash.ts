import { currencyDigits } from "./settings";

/** Coins and bills by denomination in minor units, like { "500": 15 } for fifteen ₱5 coins. */
export type CashCount = Record<string, number>;

interface Denomination {
  value: number;
  kind: "coin" | "bill";
}

/** Major-unit coins and bills in common use. Others can be added by hand. */
const common: Record<string, { coins: number[]; bills: number[] }> = {
  PHP: { coins: [1, 5, 10, 20], bills: [50, 100, 200, 500, 1000] },
  USD: { coins: [0.01, 0.05, 0.1, 0.25], bills: [1, 5, 10, 20, 50, 100] },
  EUR: { coins: [0.1, 0.2, 0.5, 1, 2], bills: [5, 10, 20, 50, 100] },
  GBP: { coins: [0.1, 0.2, 0.5, 1, 2], bills: [5, 10, 20, 50] },
  SGD: { coins: [0.1, 0.2, 0.5, 1], bills: [2, 5, 10, 50, 100] },
  MYR: { coins: [0.1, 0.2, 0.5], bills: [1, 5, 10, 20, 50, 100] },
  IDR: { coins: [500, 1000], bills: [2000, 5000, 10000, 20000, 50000, 100000] },
  THB: { coins: [1, 2, 5, 10], bills: [20, 50, 100, 500, 1000] },
  VND: { coins: [], bills: [10000, 20000, 50000, 100000, 200000, 500000] },
  JPY: { coins: [1, 5, 10, 50, 100, 500], bills: [1000, 5000, 10000] },
  AUD: { coins: [0.1, 0.2, 0.5, 1, 2], bills: [5, 10, 20, 50, 100] },
  CAD: { coins: [0.05, 0.1, 0.25, 1, 2], bills: [5, 10, 20, 50, 100] },
  INR: { coins: [1, 2, 5, 10, 20], bills: [50, 100, 200, 500] },
};

export function denominations(currency: string): Denomination[] {
  const unit = 10 ** currencyDigits(currency);
  const set = common[currency] ?? { coins: [1, 5, 10], bills: [20, 50, 100, 500, 1000] };
  return [
    ...set.coins.map((v) => ({ value: Math.round(v * unit), kind: "coin" as const })),
    ...set.bills.map((v) => ({ value: Math.round(v * unit), kind: "bill" as const })),
  ];
}

/** Photos of the coins and bills, by major-unit value. Only for currencies we have them for. */
const photos: Record<string, Record<number, string>> = {
  PHP: Object.fromEntries(
    [
      ...[1, 5, 10, 20].map((v) => [v, `/cash/coin-${v}.webp`]),
      ...[50, 100, 200, 500, 1000].map((v) => [v, `/cash/bill-${v}.webp`]),
    ],
  ),
};

/** The photo for a denomination in minor units, if there is one. */
export function denominationPhoto(currency: string, value: number): string | undefined {
  return photos[currency]?.[value / 10 ** currencyDigits(currency)];
}

/** Every coin and bill photo, so the register can keep them for offline use. */
export const cashPhotos = Object.values(photos).flatMap((set) => Object.values(set));

export function countTotal(count: CashCount | undefined) {
  let total = 0;
  for (const [value, qty] of Object.entries(count ?? {})) total += Number(value) * qty;
  return total;
}

/** Only the denominations with something counted, highest first. */
export function countRows(count: CashCount | undefined) {
  return Object.entries(count ?? {})
    .map(([value, qty]) => ({ value: Number(value), qty }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.value - a.value);
}

/** Check a count sent with a cash amount: it must add up to the amount. */
export function checkCount(count: CashCount | undefined, amount: number) {
  if (!count) return undefined;
  const kept = Object.fromEntries(Object.entries(count).filter(([, q]) => q > 0));
  if (!Object.keys(kept).length) return undefined;
  if (countTotal(kept) !== amount) throw Error("The coins and bills don't add up to the amount.");
  return kept;
}
