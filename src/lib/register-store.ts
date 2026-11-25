import { checkStock, makeSale, priceLines, stockLeft, totalLines } from "./domain";
import { defaultSettings, legacyPayment, legacyShiftSettings } from "./settings";
import { demoPlan } from "./demo-plan";
import { demoAction, isPracticeKey, practiceBootstrap, practiceMenu, type OwnerAction } from "./demo";
import { parseKey } from "./client";
import type {
  Bootstrap,
  BusinessSummary,
  CartLine,
  RegisterEvent,
  RegisterState,
  Sale,
  Shift,
  Tender,
  Expense,
  ExpenseInput,
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
      // Safari closes idle connections when the app is backgrounded. Reopen on next use.
      db.onclose = () => {
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

/**
 * Start a transaction, reopening the database once if the browser closed the
 * connection behind our back ("The database connection is closing" in Safari).
 */
async function begin(
  stores: string | string[],
  mode: IDBTransactionMode = "readonly",
  options?: IDBTransactionOptions,
): Promise<IDBTransaction> {
  for (let attempt = 0; ; attempt++) {
    const db = await openDatabase();
    try {
      return db.transaction(stores, mode, options);
    } catch (error) {
      if (attempt > 0 || !(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      opening = undefined;
      try {
        db.close();
      } catch {}
    }
  }
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
  thisDevice = begin(SETTINGS, "readwrite")
    .then(
      (tx) =>
        new Promise<string>((resolve, reject) => {
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

function directoryKey(key: string) {
  return "businesses:" + parseKey(key).userId;
}

// Membership is account-wide. An older register may predate another business being added or removed.
function readStoredRegister(tx: IDBTransaction, key: string, id: string, read: (state: RegisterState) => void) {
  const directory = tx.objectStore(SETTINGS).get(directoryKey(key));
  const register = tx.objectStore(REGISTERS).get(key);
  register.onsuccess = () => {
    const state = register.result ? upgrade(register.result) : emptyRegister(id);
    if (directory.result) state.businesses = directory.result;
    else if (state.businesses && tx.mode === "readwrite")
      tx.objectStore(SETTINGS).put(state.businesses, directoryKey(key));
    read(state);
  };
}

export async function loadRegister(key: string, { opening = false } = {}): Promise<RegisterState> {
  const id = await deviceId();
  const tx = await begin([REGISTERS, SETTINGS], opening ? "readwrite" : "readonly");
  return new Promise((resolve, reject) => {
    readStoredRegister(tx, key, id, resolve);
    tx.onabort = () => reject(tx.error);
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
  businesses?: BusinessSummary[],
): Promise<RegisterState> {
  const id = await deviceId();
  const tx = await begin([REGISTERS, SETTINGS], "readwrite", { durability: "strict" });
  return new Promise((resolve, reject) => {
    const store = tx.objectStore(REGISTERS);
    let result: RegisterState;
    let failure: unknown;
    readStoredRegister(tx, key, id, (current) => {
      try {
        const next = update(current);
        result = next ?? emptyRegister(id);
        if (next === null) store.delete(key);
        else store.put(next, key);
        if (businesses) tx.objectStore(SETTINGS).put(businesses, directoryKey(key));
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
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

/** This key is dedicated to the walkthrough and never enters the account sync path. */
export function openPracticeRegister(key: string, live: RegisterState): Promise<RegisterState> {
  if (!isPracticeKey(key) || !live.business) throw Error("Open a business to start practice.");
  return updateRegister(key, (current) => {
    if (!current.business) return { ...current, ...practiceBootstrap(current.deviceId, live) };
    const menu = practiceMenu(live.menu);
    const changed = JSON.stringify(menu) !== JSON.stringify(current.menu);
    const shift = current.shift && changed ? { ...current.shift, menu } : current.shift;
    return {
      ...current, menu, shift, bookings: live.bookings,
      cart: changed ? [] : current.cart,
      shifts: current.shifts.map((record) => record.id === shift?.id ? shift : record),
    };
  });
}

export function savePracticeAction(key: string, input: OwnerAction): Promise<RegisterState> {
  if (!isPracticeKey(key)) throw Error("Open a practice register first.");
  return updateRegister(key, (current) => {
    if (!current.business) throw Error("Open the practice register first.");
    if (input.action === "close" && current.cart.length) throw Error("Finish or clear the current order before closing.");
    const { deletedRecord: _deletedRecord, inviteDelivery: _inviteDelivery, ...snapshot } = demoAction(current, input);
    return { ...current, ...snapshot, cart: input.action === "close" ? [] : current.cart };
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
    // Work for a shift another phone has since closed stays queued. It syncs into that
    // shift, which works its closing figures out again.
    if (pending.length && !sameBusiness)
      throw new Error("This phone has unsynced sales for another business. They're still saved here.");
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
    const expenses = new Map<string, Expense>();
    for (const e of sameBusiness ? current.expenses ?? [] : []) expenses.set(e.id, e);
    for (const e of data.expenses ?? []) expenses.set(e.id, e);
    for (const event of pending) {
      if (event.type === "sale") sales.set(event.sale.id, event.sale);
      else if (event.type === "expense") expenses.set(event.expense.id, event.expense);
      else if (event.type === "editExpense") {
        const e = expenses.get(event.targetId);
        if (e && e.shiftId === event.shiftId && !e.voidedAt)
          expenses.set(e.id, applyExpenseChanges(e, event.changes));
      } else if (event.type === "unexpense") {
        const e = expenses.get(event.targetId);
        if (e) expenses.set(e.id, { ...e, voidedAt: e.voidedAt ?? new Date().toISOString() });
      } else soldOut = withAvailability(soldOut, event.targetId, event.soldOut);
    }
    const shifts = new Map(
      (sameBusiness ? current.shifts : []).map((shift) => [shift.id, shift]),
    );
    for (const shift of data.shifts) shifts.set(shift.id, shift);
    const sameTill = sameBusiness && current.shift?.id === data.shift?.id;
    const unlinked = data.shift && data.bookings && !data.bookings.some((booking) => booking.id === data.shift?.bookingId);
    return {
      ...data,
      deviceId: current.deviceId,
      cart: sameTill ? current.cart : [],
      closingShiftId:
        sameTill && !data.shift?.closedAt && !unlinked ? current.closingShiftId : undefined,
      pending,
      soldOut,
      sales: [...sales.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      shifts: [...shifts.values()].sort((a, b) =>
        b.openedAt.localeCompare(a.openedAt),
      ),
      expenses: [...expenses.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }, data.businesses);
}

/** Save an unopened register without replacing newer account membership or touching its queue. */
export function cacheBusinessRegister(key: string, data: Bootstrap) {
  return updateRegister(key, (current) => {
    if (current.business) return current;
    if (!data.business || (current.businesses && !current.businesses.some((b) => b.id === data.business!.id)))
      throw Error("This business is no longer available to your account.");
    return { ...current, ...data, businesses: current.businesses ?? data.businesses };
  });
}

function activeShift(current: RegisterState) {
  const shift = current.shift;
  if (!shift || shift.closedAt)
    throw new Error("Open a shift before taking sales.");
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
    if (grew) checkStock(shift, cart, stockLeft(shift, current.sales));
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
      pending: isPracticeKey(key) ? current.pending : [
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
  proofs?: string[],
  expectedMenuVersion?: string,
) {
  let sale!: Sale;
  const state = await updateRegister(key, (current) => {
    const shift = writableShift(current);
    checkCart(current, expectedCart);
    const menuVersion = shift.menuVersion ?? "opening";
    if (expectedMenuVersion && menuVersion !== expectedMenuVersion)
      throw new Error("The menu changed. Review the order before charging.");
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
      proofs,
    });
    return {
      ...current,
      cart: [],
      sales: [sale, ...current.sales],
      pending: isPracticeKey(key) ? current.pending : [
        ...current.pending,
        { id: sale.id, shiftId: shift.id, type: "sale", sale, menuVersion },
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

/**
 * Proof photos are kept on the phone until they upload. Before a sale syncs for the first
 * time, swap each photo for the private address it was uploaded to.
 */
export async function uploadProofs(
  key: string,
  upload: (dataUrl: string) => Promise<string>,
): Promise<void> {
  const current = await loadRegister(key);
  for (const event of current.pending) {
    if (event.type !== "sale" || !event.sale.proofs?.some((p) => p.startsWith("data:"))) continue;
    const proofs: string[] = [];
    for (const p of event.sale.proofs) proofs.push(p.startsWith("data:") ? await upload(p) : p);
    await updateRegister(key, (state) => {
      const swap = (sale: Sale) => (sale.id === event.sale.id ? { ...sale, proofs } : sale);
      return {
        ...state,
        sales: state.sales.map(swap),
        pending: state.pending.map((e) => (e.type === "sale" && e.id === event.id ? { ...e, sale: swap(e.sale) } : e)),
      };
    });
  }
}

function expenseChanges({ label, amount, source, deduction }: ExpenseInput): ExpenseInput {
  const cleanLabel = label.trim().slice(0, 80);
  if (!cleanLabel) throw new Error("Say what the money was for.");
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_147_483_647)
    throw new Error("Enter how much was spent.");
  if (deduction && (deduction.kind === "member") !== (source === "pocket"))
    throw new Error("Choose where the expense was paid from.");
  return { label: cleanLabel, amount, source, ...(deduction !== undefined ? { deduction } : {}) };
}

function applyExpenseChanges(expense: Expense, changes: ExpenseInput): Expense {
  const next = { ...expense, ...changes };
  if (changes.deduction === undefined && changes.source !== expense.source) delete next.deduction;
  return next;
}

/** Log money spent during the shift. It syncs like a sale. */
export function logExpense(
  key: string,
  input: ExpenseInput & Pick<Expense, "by">,
) {
  return updateRegister(key, (current) => {
    const shift = writableShift(current);
    const expense: Expense = {
      id: crypto.randomUUID(),
      shiftId: shift.id,
      createdAt: new Date().toISOString(),
      ...expenseChanges(input),
      ...(input.by ? { by: input.by.slice(0, 80) } : {}),
    };
    return {
      ...current,
      expenses: [expense, ...(current.expenses ?? [])],
      pending: isPracticeKey(key) ? current.pending : [...current.pending, { id: expense.id, shiftId: shift.id, type: "expense", expense }],
    };
  });
}

export function editExpense(key: string, expenseId: string, input: ExpenseInput) {
  return updateRegister(key, (current) => {
    const shift = writableShift(current);
    const expense = current.expenses?.find((e) => e.id === expenseId && e.shiftId === shift.id);
    if (!expense || expense.voidedAt) throw new Error("This expense is no longer on the open shift.");
    const changes = expenseChanges(input);
    const event: RegisterEvent = {
      id: crypto.randomUUID(),
      shiftId: shift.id,
      type: "editExpense",
      targetId: expenseId,
      changes,
    };
    return {
      ...current,
      expenses: (current.expenses ?? []).map((e) => e.id === expenseId ? applyExpenseChanges(e, changes) : e),
      pending: isPracticeKey(key) ? current.pending : [...current.pending, event],
    };
  });
}

/** Take back an expense logged by mistake. It stays on record as removed. */
export function removeExpense(key: string, expenseId: string) {
  return updateRegister(key, (current) => {
    const shift = writableShift(current);
    const found = current.expenses?.find((e) => e.id === expenseId && e.shiftId === shift.id);
    if (!found || found.voidedAt) return current;
    const id = crypto.randomUUID();
    return {
      ...current,
      expenses: (current.expenses ?? []).map((e) =>
        e.id === expenseId ? { ...e, voidedAt: new Date().toISOString() } : e,
      ),
      pending: isPracticeKey(key) ? current.pending : [...current.pending, { id, shiftId: shift.id, type: "unexpense", targetId: expenseId }],
    };
  });
}
