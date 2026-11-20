/** The id of a payment method in the shift's settings. Legacy shifts use "cash", "qr" and "card". */
export type Tender = string;
export type PaymentKind = "cash" | "wallet" | "card" | "bank" | "other";
export interface PaymentMethod {
  id: string;
  name: string;
  kind: PaymentKind;
  on: boolean;
  /** A photo of the payment, like a wallet screenshot, must be taken at checkout. */
  proof?: boolean;
}
export interface Discount {
  id: string;
  name: string;
  /** percent: whole percent from 1 to 100. fixed: an amount in minor units. */
  type: "percent" | "fixed";
  value: number;
  on: boolean;
  /** A photo, like a senior or PWD ID, must be taken before the discount applies. */
  proof?: boolean;
}
export interface ChecklistItem {
  id: string;
  text: string;
  /** A photo of how it should look. */
  image?: string;
}
export type RegisterMode = "simple" | "advanced";
export type StockListField = "category" | "kind" | "supplier";

export interface Settings {
  /** Business-wide display mode. Registers without a saved mode use Advanced. */
  mode?: RegisterMode;
  receiptNote: string;
  payments: PaymentMethod[];
  discounts: Discount[];
  /** Ticked off before a shift opens. Missing on registers saved before checklists existed. */
  checklist?: ChecklistItem[];
  /** Things counted at opening and closing. */
  stockItems?: StockItem[];
  /** Reusable names, including choices that are not assigned to an item yet. */
  stockLists?: Partial<Record<StockListField, string[]>>;
  pricing?: PricingRules;
  /** The business logo, an image address. */
  logo?: string;
  /** Brand color as #rrggbb. Buttons, highlights and dark cards take it. */
  brand?: string;
  /** The app's font, by id from the theme list. */
  font?: string;
  /** How round cards and buttons are. */
  radius?: "square" | "soft" | "round";
  /** Text color as #rrggbb. */
  ink?: string;
}
/** What a shift sells with. Copied when the shift opens, like its menu. */
export interface ShiftSettings extends Omit<Settings, "mode"> {
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
  /**
   * Older registers: the item itself is counted. Read as a stock item with the
   * item's id and name, used once per sale.
   */
  stock?: boolean;
  /** Stock items one of this uses up, like 1 pack of strawberries or 0.2 kg. */
  uses?: StockUse[];
  costing?: ProductCosting;
}
export interface ProductCosting {
  /** A costing recipe for the whole batch. The till uses Product.uses for stock deductions. */
  batch?: { servings: number; uses: StockUse[]; deductFromStock?: boolean };
  /** Minor currency units for one serving. */
  laborPerServing?: number;
  otherPerServing?: number;
  targetMargin?: number;
  sku?: string;
  notes?: string;
}
export interface PricingRules {
  targetMargin: number;
  /** Minor currency units. */
  roundingIncrement: number;
}
/** Something counted at opening and closing, like a strawberry pack or a kilo of ice. */
export interface StockItem {
  id: string;
  name: string;
  /** piece, pack, kg… */
  unit: string;
  /**
   * What each shift starts with, in the item's unit, unless it's counted at opening.
   * Shifts never change it, so booths and shifts don't overwrite each other.
   */
  onHand?: number;
  purchase?: StockPurchase;
  prep?: StockPrep;
  details?: StockItemDetails;
}
export interface StockItemDetails {
  sku?: string;
  category?: string;
  kind?: string;
  packDescription?: string;
  supplier?: string;
  costUpdatedOn?: string;
  notes?: string;
}
export interface StockPurchase {
  /** Cost of the whole pack, in minor currency units. */
  price: number;
  /** Quantity in the item's stock unit before losses. */
  quantity: number;
  /** Percentage of the pack that can be used. Defaults to 100. */
  yieldPercent?: number;
}
export interface StockPrep {
  /** Finished quantity in the stock item's unit. */
  yieldQuantity: number;
  uses: StockUse[];
  /** Optional additional cost for the entire batch in minor currency units. */
  extraBatchCost?: number;
}
export interface StockSet {
  stockId: string;
  amount: number;
  /** ISO time it was set. */
  at: string;
}
export interface StockUse {
  stockId: string;
  amount: number;
  notes?: string;
}
export interface Expense {
  id: string;
  shiftId: string;
  createdAt: string;
  label: string;
  amount: number;
  /** Paid with cash from the till, or by the person out of their own pocket. */
  source: "till" | "pocket";
  /** Who logged it. */
  by?: string;
  voidedAt?: string;
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
  /** Absent on shifts and device snapshots from before the first menu edit. */
  menuVersion?: string;
  settings: ShiftSettings;
  countedCash?: number;
  difference?: number;
  /** Opening count of each stock item, by stock item id. */
  stock?: Record<string, number>;
  /** What was counted at closing, by stock item id. */
  closingStock?: Record<string, number>;
  /** Amounts on hand set during the shift, in the order they were set. Sales after each one take from it. */
  stockSets?: StockSet[];
  /** Coins and bills in the float, by denomination in minor units, like { "500": 15 }. */
  openingCount?: Record<string, number>;
  /** Coins and bills counted at closing, the same way. */
  closingCount?: Record<string, number>;
  /** How much of each stock item the shift's sales used, saved at closing. */
  usedStock?: Record<string, number>;
  /** What each stock item had left when the shift closed: the count, or what the sales left. */
  leftStock?: Record<string, number>;
  /** When this shift's leftovers were merged into the stock items' starting amounts. */
  mergedAt?: string;
  /** Who opened the till. */
  openedBy?: string;
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
  /** Photos of the payment or discount ID. Data URLs until they sync. */
  proofs?: string[];
}
export type RegisterEvent =
  | { id: string; shiftId: string; type: "sale"; sale: Sale; menuVersion?: string }
  | { id: string; shiftId: string; type: "expense"; expense: Expense }
  | { id: string; shiftId: string; type: "unexpense"; targetId: string }
  | {
      id: string;
      shiftId: string;
      type: "availability";
      targetId: string;
      soldOut: boolean;
    };
export type Role = "cashier" | "server";
/** What someone does on one shift. One person can run the till and serve. */
export type ShiftRole = Role | "both";
export interface Member {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  /** Default pay for one shift, in minor units. */
  rate: number;
  owner: boolean;
  /** The account that created the business. */
  primaryOwner?: boolean;
  /** True once they signed in with the invited email or opened their invite link. */
  joined: boolean;
  /** Pending invites only, for the owner: the code in their /i/ link. */
  inviteCode?: string;
  photo?: string;
}
/** Who is using this register. */
export interface Me {
  memberId: string;
  name: string;
  roles: Role[];
  owner: boolean;
  photo?: string;
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
  role: ShiftRole;
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
/** A business this person can switch to. */
export interface BusinessSummary {
  id: string;
  name: string;
  owner: boolean;
  logo?: string;
  brand?: string;
}
export interface Bootstrap {
  businesses?: BusinessSummary[];
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
  /** Expenses logged on the shifts above. */
  expenses?: Expense[];
  /** Profile photos of everyone on the team, by member id. */
  faces?: Record<string, string>;
}
export type DeletedRecord =
  | { kind: "menuItem"; item: Product; index: number }
  | { kind: "booking"; booking: Booking };

export type RegisterResponse = Bootstrap & {
  inviteDelivery?: "sent" | "failed" | "unavailable";
  deletedRecord?: DeletedRecord;
};

export interface RegisterState extends Bootstrap {
  closingShiftId?: string;
  cart: CartLine[];
  pending: RegisterEvent[];
  deviceId: string;
}

/** What an /i/ or /j/ link shows before sign-in. */
export interface LinkPreview {
  business: { name: string; logo?: string; brand?: string };
  invite?: { name: string; owner: boolean; invitedBy?: string };
  shift?: {
    startsAt: string;
    endsAt: string;
    timeZone: string;
    place?: string;
    event?: string;
    seats: number;
    taken: number;
  };
}
