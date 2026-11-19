export type Tender = "cash" | "qr" | "card";
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
  total: number;
  tender: Tender;
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
