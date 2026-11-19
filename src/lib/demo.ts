import { demoMenu, demoStockItems } from "./demo-menu";
import { checkCount, type CashCount } from "./cash";
import { checkClosing, checkOpening, shiftTotals, stockLeft, updateShiftMenu } from "./domain";
import { batchIngredientProblem, checkPrepRecipes, hasStockCostAmounts, round, withoutMenuCosts, withoutStockCosts } from "./stock";
import { demoPlan } from "./demo-plan";
import { applyPlan, PlanError, startProblem, walkInBooking, type PlanCommand } from "./team";
import { RequestFailure } from "./client";
import { currencyDigits, defaultSettings, mergeShiftSettings } from "./settings";
import type {
  Bootstrap,
  Product,
  RegisterState,
  Settings,
  Shift,
  ShiftSettings,
} from "./types";

export const DEMO = "demo-register-v2";
export const DEMO_PIN = "1234";
export function newShift(
  deviceId: string,
  businessId: string,
  number: number,
  openingCash: number,
  menu: Product[],
  settings: ShiftSettings,
): Shift {
  return {
    id: crypto.randomUUID(),
    number,
    businessId,
    deviceId,
    openedAt: new Date().toISOString(),
    closedAt: null,
    openingCash,
    menu: structuredClone(withoutMenuCosts(menu)),
    settings: structuredClone(withoutStockCosts(settings)),
  };
}
export function demoBootstrap(deviceId: string): Bootstrap {
  const currency = "PHP";
  const business = {
    id: "demo",
    name: "Sunday Supply",
    currency,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    settings: defaultSettings(currency),
  };
  business.settings.stockItems = demoStockItems;
  business.settings.checklist = [
    { id: "float", text: "Count the cash float" },
    { id: "gcash", text: "GCash QR is printed and on the counter" },
    { id: "ice", text: "Ice and milk are in the cooler" },
  ];
  const plan = demoPlan({ business });
  const today = plan.bookings.find((b) => b.id.startsWith("demo-0-"));
  const shift = {
    ...newShift(deviceId, business.id, 1, 250000, demoMenu, {
      ...business.settings,
      currency,
    }),
    stock: { croissant: 18, roll: 12, cookie: 24, milk: 6, ice: 5 },
    openingCount: { "2000": 20, "1000": 30, "500": 40, "100": 100, "5000": 10, "10000": 10 },
    openedBy: "Ana Cruz",
    bookingId: today?.id,
    checklist: business.settings.checklist.map((c) => c.text),
  };
  return {
    ...plan,
    business,
    menu: demoMenu,
    shift,
    shifts: [shift],
    sales: [],
    soldOut: [],
  };
}
export interface Opening {
  openingCash: number;
  openingCount?: CashCount;
  stock: Record<string, number>;
  checked: string[];
  bookingId?: string;
  /** Start a shift now when none is scheduled. */
  newShift?: WalkIn;
}
export interface WalkIn {
  place?: string;
  hours: number;
}
export interface Closing {
  action: "close";
  countedCash: number;
  closingCount?: CashCount;
  closingStock?: Record<string, number>;
  pin: string;
}
export type OwnerAction =
  | ({ action: "open" } & Opening)
  | { action: "link"; newShift: WalkIn }
  | { action: "profile"; memberId?: string; name?: string; photo?: string | null; pin?: string }
  | { action: "menu"; menu: Product[]; pin: string; stock?: Record<string, number> }
  | (PlanCommand & { pin?: string })
  | { action: "reverse"; saleId: string; reason: string; pin: string }
  | Closing
  | {
      action: "settings";
      name: string;
      currency: string;
      timeZone: string;
      settings: Settings;
      pin: string;
    }
  | {
      action: "setup";
      name: string;
      currency: string;
      timeZone: string;
      pin: string;
    };
export function demoAction(
  state: RegisterState,
  input: OwnerAction,
): Bootstrap {
  if ("pin" in input && input.pin !== undefined && input.pin !== DEMO_PIN)
    throw new RequestFailure(403, "Wrong PIN. The demo PIN is 1234.");
  switch (input.action) {
    case "open": {
      if (state.shift) throw Error("A shift is already open.");
      const business = state.business!;
      const checklist = business.settings.checklist ?? [];
      const stock = checkOpening(state.menu, business.settings.stockItems, checklist, input.stock, input.checked);
      const openingCount = checkCount(input.openingCount, input.openingCash);
      const booking = state.bookings?.find((b) => b.id === input.bookingId);
      if (!input.bookingId) throw Error("Pick a scheduled shift to start. Add one on Shifts first.");
      if (!booking) throw Error("That scheduled shift was removed.");
      const problem = startProblem(booking, business.timeZone);
      if (problem) throw Error(problem);
      const shift: Shift = {
        ...newShift(
          state.deviceId,
          "demo",
          Math.max(0, ...state.shifts.map((s) => s.number)) + 1,
          input.openingCash,
          state.menu,
          { ...business.settings, currency: business.currency },
        ),
        ...(Object.keys(stock).length ? { stock } : {}),
        ...(openingCount ? { openingCount } : {}),
        openedBy: state.me?.name,
        bookingId: booking.id,
        checklist: checklist.map((c) => c.text),
      };
      return { ...state, shift, shifts: [shift, ...state.shifts], soldOut: [] };
    }
    case "profile": {
      const me = state.me!;
      const id = input.memberId ?? me.memberId;
      const faces = { ...(state.faces ?? {}) };
      const change: { photo?: string; name?: string } = {};
      if (input.photo !== undefined) {
        if (input.photo) faces[id] = input.photo;
        else delete faces[id];
        change.photo = input.photo ?? undefined;
      }
      if (input.name) change.name = input.name;
      return {
        ...state,
        faces,
        me: id === me.memberId ? { ...me, ...change } : me,
        team: state.team?.map((m) => (m.id === id ? { ...m, ...change } : m)),
      };
    }
    case "link": {
      const open = state.shift;
      if (!open) throw Error("Open the till first.");
      if (open.bookingId) return state;
      const b = walkInBooking(input.newShift, state.me!, Date.parse(open.openedAt));
      const shift = { ...open, bookingId: b.id };
      return {
        ...state,
        bookings: [...(state.bookings ?? []), b],
        shift,
        shifts: state.shifts.map((s) => (s.id === shift.id ? shift : s)),
      };
    }
    case "menu": {
      const problem = batchIngredientProblem(input.menu, state.business?.settings.stockItems);
      if (problem) throw Error(problem);
      const shift = state.shift && updateShiftMenu(state.shift, input.menu, input.stock);
      return {
        ...state,
        menu: input.menu,
        shift,
        shifts: state.shifts.map((s) => (shift && s.id === shift.id ? shift : s)),
      };
    }
    case "settings": {
      const business = state.business!;
      if (input.currency !== business.currency && state.shift)
        throw Error("Close the shift before changing currency.");
      if (hasStockCostAmounts(input.settings) && currencyDigits(input.currency) !== currencyDigits(business.currency))
        throw Error(`${input.currency} uses different decimals. Clear the stock and batch costs first or keep ${business.currency}.`);
      checkPrepRecipes(input.settings.stockItems);
      const problem = batchIngredientProblem(state.menu, input.settings.stockItems);
      if (problem) throw Error(problem);
      const shift = state.shift && {
        ...state.shift,
        settings: mergeShiftSettings(state.shift.settings, input.settings),
      };
      return {
        ...state,
        business: {
          ...business,
          name: input.name,
          currency: input.currency,
          timeZone: input.timeZone,
          settings: input.settings,
        },
        shift,
        shifts: state.shifts.map((s) => (shift && s.id === shift.id ? shift : s)),
      };
    }
    case "reverse": {
      const sale = state.sales.find((s) => s.id === input.saleId);
      if (
        !state.shift ||
        sale?.shiftId !== state.shift.id ||
        sale.reversedAt ||
        !input.reason.trim()
      )
        throw Error("Choose an active shift sale and enter a reason.");
      return {
        ...state,
        sales: state.sales.map((s) =>
          s.id === input.saleId
            ? {
                ...s,
                reason: input.reason,
                reversedAt: new Date().toISOString(),
              }
            : s,
        ),
      };
    }
    case "close": {
      if (!state.shift) throw Error("This shift has already closed.");
      const shift = state.shift;
      const closingStock = checkClosing(shift, input.closingStock);
      const closingCount = checkCount(input.closingCount, input.countedCash);
      const left = stockLeft(shift, state.sales);
      const closed: Shift = {
        ...shift,
        countedCash: input.countedCash,
        difference:
          input.countedCash -
          shiftTotals(shift, state.sales, state.expenses).expectedCash,
        closedAt: new Date().toISOString(),
        ...(closingStock ? { closingStock } : {}),
        ...(closingCount ? { closingCount } : {}),
        ...(shift.stock
          ? { usedStock: Object.fromEntries(Object.entries(shift.stock).map(([id, n]) => [id, round(n - left[id])])) }
          : {}),
      };
      return {
        ...state,
        shift: null,
        shifts: state.shifts.map((s) => (s.id === closed.id ? closed : s)),
        soldOut: [],
      };
    }
    case "setup":
      throw Error("Create a live account to set up a business.");
    default: {
      const me = state.me!;
      try {
        const plan = applyPlan(
          {
            members: state.team ?? [],
            organizers: state.organizers ?? [],
            bookings: state.bookings ?? [],
          },
          me,
          input,
        );
        return {
          ...state,
          team: plan.members,
          organizers: plan.organizers,
          bookings: plan.bookings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
        };
      } catch (error) {
        if (error instanceof PlanError) throw new RequestFailure(error.status, error.message);
        throw error;
      }
    }
  }
}
