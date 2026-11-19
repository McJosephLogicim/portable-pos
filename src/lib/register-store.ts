import { checkStock, makeSale, priceLines, stockLeft, totalLines } from "./domain";
import { defaultSettings, legacyPayment, legacyShiftSettings } from "./settings";
import { demoPlan } from "./demo-plan";
import type {
  Bootstrap,
  CartLine,
  RegisterState,
  Sale,
  Shift,
  Tender,
} from "./types";

/** Fill fields that registers saved by an earlier version of the app don't have. */
function upgrade(state: RegisterState): RegisterState {
  const currency = state.business?.currency ?? "USD";
  const shift = (s: Shift): Shift =>
    s.settings ? s : { ...s, settings: legacyShiftSettings(currency) };
  return {
    ...state,
    business: state.business && {
      ...state.business,
      settings: state.business.settings ?? defaultSettings(currency),
    },
    shift: state.shift && shift(state.shift),
    shifts: state.shifts.map(shift),
    sales: state.sales.map((s) =>
      s.payment
        ? s
        : { ...s, subtotal: s.subtotal ?? s.total, payment: legacyPayment(s.tender) },
    ),
    ...(state.business?.id === "demo" && !state.bookings ? demoPlan(state) : {}),
  };
}

const DB_NAME = "portable-pos-register";
const REGISTERS = "registers";
const SETTINGS = "settings";
let opening: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(REGISTERS);
      request.result.createObjectStore(SETTINGS);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

function emptyRegister(deviceId: string): RegisterState {
  return {
    deviceId,
    business: null,
    menu: [],
    shift: null,
    soldOut: [],
    sales: [],
    shifts: [],
    cart: [],
    pending: [],
  };
}

let thisDevice: Promise<string> | undefined;
function deviceId(): Promise<string> {
  if (thisDevice) return thisDevice;
  thisDevice = openDatabase()
    .then(
      (db) =>
        new Promise<string>((resolve, reject) => {
          const tx = db.transaction(SETTINGS, "readwrite");
          const store = tx.objectStore(SETTINGS);
          const request = store.get("device");
          let id: string;
          request.onsuccess = () => {
            id = request.result ?? crypto.randomUUID();
            if (!request.result) store.put(id, "device");
          };
          tx.oncomplete = () => resolve(id);
          tx.onabort = () =>
            reject(
              tx.error ??
                new Error("This device could not save its register ID."),
            );
        }),
    )
    .catch((error) => {
      thisDevice = undefined;
      throw error;
    });
  return thisDevice;
}

export async function loadRegister(key: string): Promise<RegisterState> {
  const [db, id] = await Promise.all([openDatabase(), deviceId()]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(REGISTERS).objectStore(REGISTERS).get(key);
    request.onsuccess = () =>
      resolve(request.result ? upgrade(request.result) : emptyRegister(id));
    request.onerror = () => reject(request.error);
  });
}

let tabChannel: BroadcastChannel | undefined;
function registerChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined")
    return;
  return (tabChannel ??= new BroadcastChannel(DB_NAME));
}

export function subscribeRegister(
  key: string,
  onChange: () => void,
): () => void {
  const channel = registerChannel();
  const listener = (event: MessageEvent) => {
    if (event.data === key) onChange();
  };
  channel?.addEventListener("message", listener);
  return () => channel?.removeEventListener("message", listener);
}

// All local mutations read the latest committed state and write under the same lock.
// Resolve only on transaction completion. A successful put alone is not a durable sale.
async function updateRegister(
  key: string,
  update: (current: RegisterState) => RegisterState | null,
): Promise<RegisterState> {
  const [db, id] = await Promise.all([openDatabase(), deviceId()]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REGISTERS, "readwrite", { durability: "strict" });
    const store = tx.objectStore(REGISTERS);
    const request = store.get(key);
    let result: RegisterState;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const next = update(
          request.result ? upgrade(request.result) : emptyRegister(id),
        );
        result = next ?? emptyRegister(id);
        if (next === null) store.delete(key);
        else store.put(next, key);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      resolve(result);
      registerChannel()?.postMessage(key);
    };
    tx.onabort = () =>
      reject(
        failure ||
          new Error(
            "The register could not save this change on this device. Free up storage and retry.",
            { cause: tx.error },
          ),
      );
  });
}

function withAvailability(
  values: string[],
  target: string,
  soldOut: boolean,
): string[] {
  const next = new Set(values);
  if (soldOut) next.add(target);
  else next.delete(target);
  return [...next];
}

export function mergeServer(
  key: string,
  data: Bootstrap,
  ackIds: string[] = [],
): Promise<RegisterState> {
  return updateRegister(key, (current) => {
    const sameBusiness = data.business?.id === current.business?.id;
    const acknowledged = new Set(ackIds);
    const pending = current.pending.filter(
      (event) => !acknowledged.has(event.id),
    );
    if (
      pending.some((event) => !sameBusiness || event.shiftId !== data.shift?.id)
    ) {
      throw new Error(
        "This device has unsynced work from a different shift. Its records are still saved here.",
      );
    }
    const sales = new Map<string, Sale>();
    for (const sale of sameBusiness ? current.sales : [])
      sales.set(sale.id, sale);
    for (const sale of data.sales) {
      const stored = sales.get(sale.id);
      sales.set(
        sale.id,
        stored?.reversedAt && !sale.reversedAt ? stored : sale,
      );
    }
    let soldOut = data.soldOut;
    for (const event of pending) {
      if (event.type === "sale") sales.set(event.sale.id, event.sale);
      else soldOut = withAvailability(soldOut, event.targetId, event.soldOut);
    }
    const shifts = new Map(
      (sameBusiness ? current.shifts : []).map((shift) => [shift.id, shift]),
    );
    for (const shift of data.shifts) shifts.set(shift.id, shift);
    const sameTill =
      sameBusiness &&
      current.shift?.id === data.shift?.id &&
      data.shift?.deviceId === current.deviceId;
    return {
      ...data,
      deviceId: current.deviceId,
      cart: sameTill ? current.cart : [],
      closingShiftId:
        sameTill && !data.shift?.closedAt ? current.closingShiftId : undefined,
      pending,
      soldOut,
      sales: [...sales.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      shifts: [...shifts.values()].sort((a, b) =>
        b.openedAt.localeCompare(a.openedAt),
      ),
    };
  });
}

function activeShift(current: RegisterState) {
  const shift = current.shift;
  if (!shift || shift.closedAt)
    throw new Error("Open a shift before taking sales.");
  if (shift.deviceId !== current.deviceId)
    throw new Error("This shift is open on another device.");
  return shift;
}

function writableShift(current: RegisterState) {
  const shift = activeShift(current);
  if (current.closingShiftId === shift.id) {
    throw new Error(
      "Closing this shift. Reconnect to confirm its status before taking another sale.",
    );
  }
  return shift;
}

export function beginClose(
  key: string,
  shiftId: string,
): Promise<RegisterState> {
  return updateRegister(key, (current) => {
    const shift = activeShift(current);
    if (shift.id !== shiftId) throw new Error("This shift is no longer open.");
    if (current.cart.length)
      throw new Error("Finish or clear the current order before closing.");
    if (current.pending.length)
      throw new Error("Sync all pending records before closing.");
    return { ...current, closingShiftId: shiftId };
  });
}

export function cancelClose(
  key: string,
  shiftId: string,
): Promise<RegisterState> {
  return updateRegister(key, (current) =>
    current.closingShiftId === shiftId
      ? { ...current, closingShiftId: undefined }
      : current,
  );
}

function checkCart(current: RegisterState, expected?: CartLine[]) {
  if (expected && JSON.stringify(current.cart) !== JSON.stringify(expected)) {
    throw new Error(
      "The cart changed in another window. Reopen it and try again.",
    );
  }
}

export function saveCart(
  key: string,
  cart: CartLine[],
  expectedCart?: CartLine[],
): Promise<RegisterState> {
  return updateRegister(key, (current) => {
    const shift = writableShift(current);
    checkCart(current, expectedCart);
    totalLines(priceLines(shift.menu, cart));
    // Taking items out of an order is always allowed.
    const before = new Map<string, number>();
    for (const l of current.cart) before.set(l.productId, (before.get(l.productId) ?? 0) + l.quantity);
    const grew = cart.some(
      (l) => cart.filter((x) => x.productId === l.productId).reduce((s, x) => s + x.quantity, 0) > (before.get(l.productId) ?? 0),
    );
    if (grew) checkStock(shift.menu, cart, stockLeft(shift, current.sales));
    return { ...current, cart };
  });
}

export function setAvailability(
  key: string,
  targetId: string,
  soldOut: boolean,
): Promise<RegisterState> {
  return updateRegister(key, (current) => {
    const shift = writableShift(current);
    const exists = shift.menu.some(
      (item) =>
        item.id === targetId ||
        item.groups.some((group) =>
          group.options.some((option) => option.id === targetId),
        ),
    );
    if (!exists)
      throw new Error("That menu option does not belong to this shift.");
    if (current.soldOut.includes(targetId) === soldOut) return current;
    return {
      ...current,
      soldOut: withAvailability(current.soldOut, targetId, soldOut),
      pending: [
        ...current.pending,
        {
          type: "availability",
          id: crypto.randomUUID(),
          shiftId: shift.id,
          targetId,
          soldOut,
        },
      ],
    };
  });
}

export async function checkout(
  key: string,
  tender: Tender,
  received: number,
  expectedCart?: CartLine[],
  discountId?: string,
) {
  let sale!: Sale;
  const state = await updateRegister(key, (current) => {
    const shift = writableShift(current);
    checkCart(current, expectedCart);
    const sequence =
      current.sales.reduce(
        (max, previous) =>
          previous.shiftId === shift.id
            ? Math.max(max, previous.sequence)
            : max,
        0,
      ) + 1;
    sale = makeSale({
      id: crypto.randomUUID(),
      shift,
      sequence,
      cart: current.cart,
      soldOut: current.soldOut,
      tender,
      discountId,
      received,
      createdAt: new Date().toISOString(),
      stock: stockLeft(shift, current.sales),
    });
    return {
      ...current,
      cart: [],
      sales: [sale, ...current.sales],
      pending: [
        ...current.pending,
        { id: sale.id, shiftId: shift.id, type: "sale", sale },
      ],
    };
  });
  return { state, sale };
}

export function clearRegister(key: string): Promise<RegisterState> {
  return updateRegister(key, (current) => {
    if (current.pending.length)
      throw new Error("Sync pending records before signing out.");
    return null;
  });
}
