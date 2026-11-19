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
export interface ChecklistItem {
  id: string;
  text: string;
  /** A photo of how it should look. */
  image?: string;
}
export interface Settings {
  receiptNote: string;
  payments: PaymentMethod[];
  discounts: Discount[];
  /** Ticked off before a shift opens. Missing on registers saved before checklists existed. */
  checklist?: ChecklistItem[];
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
  /** Counted when a shift opens and sold down to zero, like bread or pastries. */
  stock?: boolean;
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
  /** Opening count of each stock-tracked item, by product id. */
  stock?: Record<string, number>;
  /** The scheduled shift this till ran for. */
  bookingId?: string;
  /** Checklist lines ticked when the shift opened. */
  checklist?: string[];
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
export type Role = "cashier" | "server";
export interface Member {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /** Default pay for one shift, in minor units. */
  rate: number;
  owner: boolean;
  /** True once they signed in with the invited email. */
  joined: boolean;
}
/** Who is using this register. */
export interface Me {
  memberId: string;
  name: string;
  roles: Role[];
  owner: boolean;
}
export interface Place {
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
}
export interface Tag {
  id: string;
  name: string;
}
export interface Organizer extends Tag {
  events: Tag[];
}
export interface StaffSlot {
  memberId: string;
  name: string;
  role: Role;
  /** Hidden from teammates other than the owner. */
  salary?: number;
}
/** A scheduled shift: a pop-up slot that people work and that should pay for itself. */
export interface Booking {
  id: string;
  startsAt: string;
  endsAt: string;
  place: Place | null;
  organizer: Tag | null;
  event: Tag | null;
  /** People needed. */
  seats: number;
  staff: StaffSlot[];
  /** Hidden from everyone but the owner. */
  rent?: number;
  /** Sales that earn the incentive. 0 means no quota. */
  quota: number;
  /** Paid to each person on the shift when sales reach the quota. */
  incentive: number;
  /** Owner only: net sales rung up on tills opened for this shift. */
  sales?: number;
  /** Whether sales reached the quota. Shared with the team, unlike the sales figure. */
  hit?: boolean;
}
export interface Bootstrap {
  business: Business | null;
  me?: Me | null;
  team?: Member[];
  organizers?: Organizer[];
  bookings?: Booking[];
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
