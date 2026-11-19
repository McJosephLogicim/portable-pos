import { demoMenu } from "./demo-menu";
import { shiftTotals } from "./domain";
import { RequestFailure } from "./client";
import { defaultSettings, mergeShiftSettings } from "./settings";
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
    menu: structuredClone(menu),
    settings: structuredClone(settings),
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
  const shift = newShift(deviceId, business.id, 1, 200000, demoMenu, {
    ...business.settings,
    currency,
  });
  return {
    business,
    menu: demoMenu,
    shift,
    shifts: [shift],
    sales: [],
    soldOut: [],
  };
}
export type OwnerAction =
  | { action: "open"; openingCash: number }
  | { action: "menu"; menu: Product[]; pin: string }
  | { action: "reverse"; saleId: string; reason: string; pin: string }
  | { action: "close"; countedCash: number; pin: string }
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
  if ("pin" in input && input.pin !== DEMO_PIN)
    throw new RequestFailure(403, "Wrong PIN. The demo PIN is 1234.");
  switch (input.action) {
    case "open": {
      if (state.shift) throw Error("A shift is already open.");
      const business = state.business!;
      const shift = newShift(
        state.deviceId,
        "demo",
        Math.max(0, ...state.shifts.map((s) => s.number)) + 1,
        input.openingCash,
        state.menu,
        { ...business.settings, currency: business.currency },
      );
      return { ...state, shift, shifts: [shift, ...state.shifts], soldOut: [] };
    }
    case "menu":
      return { ...state, menu: input.menu };
    case "settings": {
      const business = state.business!;
      if (input.currency !== business.currency && state.shift)
        throw Error("Close the shift before changing currency.");
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
      const closed = {
        ...state.shift,
        countedCash: input.countedCash,
        difference:
          input.countedCash -
          shiftTotals(state.shift, state.sales).expectedCash,
        closedAt: new Date().toISOString(),
      };
      return {
        ...state,
        shift: null,
        shifts: state.shifts.map((s) => (s.id === closed.id ? closed : s)),
        soldOut: [],
      };
    }
    default:
      throw Error("Create a live account to set up a business.");
  }
}
