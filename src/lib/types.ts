/** The id of a payment method in the shift's settings. Legacy shifts use "cash", "qr" and "card". */
export type Tender = string;
export type PaymentKind = "cash" | "wallet" | "card" | "bank" | "other";
export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  on: boolean;
}
export interface Discount {
  id: string;
  name: string;
  /** percent: whole percent from 1 to 100. fixed: an amount in minor units. */
  type: "percent" | "fixed";
  value: number;
  on: boolean;
}
export interface Settings {
  receiptNote: string;
  payments: PaymentMethod[];
  discounts: Discount[];
}
/** What a shift sells with. Copied when the shift opens, like its menu. */
export interface ShiftSettings extends Settings {
  currency: string;
}
export interface Option {
  id: string;
  name: string;
  price: number;
}
export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  options: Option[];
}
export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  groups: OptionGroup[];
  image?: string;
}
export interface Business {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
  settings: Settings;
}
export interface Shift {
  id: string;
  number: number;
  businessId: string;
  deviceId: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  menu: Product[];
  settings: ShiftSettings;
  countedCash?: number;
  difference?: number;
}
export interface CartLine {
  productId: string;
  optionIds: string[];
  quantity: number;
}
export interface ReceiptLine extends CartLine {
  name: string;
  options: string[];
  unitPrice: number;
}
export interface Sale {
  id: string;
  shiftId: string;
  sequence: number;
  createdAt: string;
  lines: ReceiptLine[];
  subtotal: number;
  discount?: { id: string; name: string; amount: number };
  total: number;
  tender: Tender;
  payment: { id: string; name: string; kind: PaymentKind };
  received: number;
  change: number;
  reversedAt?: string;
  reason?: string;
}
export type RegisterEvent =
  | { id: string; shiftId: string; type: "sale"; sale: Sale }
  | {
      id: string;
      shiftId: string;
      type: "availability";
      targetId: string;
      soldOut: boolean;
    };
export interface Bootstrap {
  business: Business | null;
  menu: Product[];
  shift: Shift | null;
  soldOut: string[];
  sales: Sale[];
  shifts: Shift[];
}
export interface RegisterState extends Bootstrap {
  closingShiftId?: string;
  cart: CartLine[];
  pending: RegisterEvent[];
  deviceId: string;
}
