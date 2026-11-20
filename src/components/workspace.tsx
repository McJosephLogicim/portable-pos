"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronDown, ReceiptText, ShoppingBag, UserRound, Wallet, X } from "lucide-react";
import { SellScreen } from "./sell";
import { SalesScreen, type SalesFocus } from "./sales";
import { ShiftScreen } from "./shift";
import { SettingsScreen, type SettingsPage } from "./settings";
import { RecipesScreen, type RecipesPage } from "./recipes";
import { ScheduleScreen, ScheduledShiftSheet } from "./schedule";
import { Account, Setup } from "./account";
import { BusinessMark, BusinessSwitcher, initialsOf } from "./businesses";
import { buzz, CelebrateProvider, ConfirmSheet, FacesProvider, facesOf, PhotoProvider, PinProvider, ProofProvider, Toast } from "./ui";
import { blobToDataUrl, compressPhoto, dataUrlToBlob } from "@/lib/photo";
import { api, authClient, parseKey, proofBlob, registerKey, RequestFailure, uploadImage } from "@/lib/client";
import { priceLines, updateShiftMenu } from "@/lib/domain";
import {
  beginClose,
  cancelClose,
  checkout,
  clearRegister,
  loadRegister,
  logExpense,
  mergeServer,
  removeExpense,
  saveCart,
  setAvailability,
  subscribeRegister,
  uploadProofs,
} from "@/lib/register-store";
import { applyTheme } from "@/lib/theme";
import { matchCode, readInviteCode, readJoinCode, SHIFT_CODE, TEAM_CODE } from "@/lib/join-link";
import { friendlyError } from "@/lib/errors";
import { demoAction, demoBootstrap, DEMO, type Opening, type OwnerAction } from "@/lib/demo";
import { prepareOffline } from "@/lib/service-worker";
import type { CartLine, RegisterResponse, RegisterState, Tender } from "@/lib/types";

const tabs = [
  { id: "sell", name: "Sell", icon: ShoppingBag },
  { id: "sales", name: "Sales", icon: ReceiptText },
  { id: "shift", name: "Till", icon: Wallet },
  { id: "schedule", name: "Shifts", icon: CalendarDays },
] as const;
type Tab = (typeof tabs)[number]["id"] | "settings" | "recipes";
type UndoNotice = {
  id: string;
  text: string;
  restoredText: string;
  restore: (pin: string) => Promise<void>;
};
type JoinTarget =
  | { businessId: string; bookingId: string | null }
  | { code: NonNullable<ReturnType<typeof readJoinCode>> };
const ACTIVE = "portable-pos-account";
// An invite link waits here through sign-up and email confirmation.
const INVITE = "portable-pos-invite";
let openedInvite: string | null = null;
function pendingInvite() {
  try {
    return openedInvite ?? readInviteCode(localStorage.getItem(INVITE));
  } catch {
    return openedInvite;
  }
}
function forgetInvite() {
  openedInvite = null;
  try {
    localStorage.removeItem(INVITE);
  } catch {
    /* storage is blocked */
  }
}
async function locked<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("portable-pos:" + name, action);
  throw Error(
    "Use a current browser with register locking support to operate this till.",
  );
}
function message(e: unknown) {
  return friendlyError(e, "The register couldn't finish that. Try again.");
}
async function syncRegister(
  key: string,
  force = false,
): Promise<RegisterState> {
  return locked("sync-" + key, async () => {
    let current = await loadRegister(key);
    if (!navigator.onLine) return current;
    if (key === DEMO) {
      if (current.pending.length)
        return mergeServer(
          key,
          current,
          current.pending.map((p) => p.id),
        );
      return current;
    }
    if (!current.pending.length && force)
      return mergeServer(key, await api(key, { action: "bootstrap" }));
    if (current.pending.length) {
      await uploadProofs(key, (url) => uploadImage(key, dataUrlToBlob(url), true));
      current = await loadRegister(key);
    }
    while (current.pending.length) {
      const events = [];
      let bytes = 0;
      // The server takes one shift per batch. Work for a shift another phone closed goes first.
      const shiftId = current.pending[0].shiftId;
      for (const event of current.pending.slice(0, 25)) {
        if (event.shiftId !== shiftId) break;
        const size = new TextEncoder().encode(JSON.stringify(event)).length;
        if (events.length && bytes + size > 1_500_000) break;
        events.push(event);
        bytes += size;
      }
      const data = await api(key, {
        action: "sync",
        deviceId: current.deviceId,
        events,
      });
      current = await mergeServer(
        key,
        data,
        events.map((p) => p.id),
      );
    }
    return current;
  });
}
export function Workspace() {
  const [key, setKey] = useState<string | null>(null),
    [state, setState] = useState<RegisterState | null>(null),
    [tab, setTab] = useState<Tab>("sell");
  const [online, setOnline] = useState(true),
    [notice, setNotice] = useState(""),
    [syncErr, setSyncErr] = useState(""),
    [ready, setReady] = useState(false);
  const [account, setAccount] = useState(false),
    [tillBooking, setTillBooking] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [bootError, setBootError] = useState(""),
    [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null),
    [recipesPage, setRecipesPage] = useState<RecipesPage | null>(null),
    [sharedSchedule, setSharedSchedule] = useState<{ bookingId: string | null } | null>(null),
    [salesFocus, setSalesFocus] = useState<SalesFocus | null>(null),
    [toast, setToast] = useState(""),
    [undoNotices, setUndoNotices] = useState<UndoNotice[]>([]),
    [confirmSignOut, setConfirmSignOut] = useState(false),
    [adding, setAdding] = useState(false),
    [switching, setSwitching] = useState(false);
  const active = useRef<string | null>(null),
    syncBusy = useRef(false),
    joinTarget = useRef<JoinTarget | null>(null),
    joinAsked = useRef(false);
  const show = useCallback((id: string, s: RegisterState) => {
    if (active.current === id) setState(s);
  }, []);
  const connect = useCallback(
    async (id: string) => {
      active.current = id;
      setKey(id);
      setState(null);
      setSyncErr("");
      setBootError("");
      setUndoNotices([]);
      setTillBooking(null);
      setSharedSchedule(null);
      setTab("sell");
      try {
        const invite = id !== DEMO && navigator.onLine ? pendingInvite() : null;
        if (invite) {
          // Join the team first, then open its register: their first, or one more on this phone.
          const { userId } = parseKey(id);
          let data;
          try {
            data = await api(userId, { action: "acceptInvite", code: invite });
            forgetInvite();
          } catch (e) {
            if (e instanceof RequestFailure && e.status >= 400 && e.status < 500) {
              forgetInvite();
              setNotice(message(e));
            } else throw e;
          }
          const joined = data?.business;
          if (data && joined) {
            const first = await loadRegister(userId);
            const target = !first.business || first.business.id === joined.id ? userId : registerKey(userId, joined.id);
            await locked("write-" + target, () => mergeServer(target, data));
            joinTarget.current = { businessId: joined.id, bookingId: null };
            setToast("You joined " + joined.name);
            id = target;
            active.current = id;
            setKey(id);
          }
        }
        localStorage.setItem(ACTIVE, id);
        let local = await loadRegister(id);
        if (id === DEMO && !local.business)
          local = await locked("write-" + id, async () => {
            const current = await loadRegister(id);
            return current.business
              ? current
              : mergeServer(id, demoBootstrap(current.deviceId));
          });
        // An invitation may have arrived after this device last cached the team list.
        if (local.business && !joinTarget.current) show(id, local);
        if (id !== DEMO && navigator.onLine) {
          try {
            local = await syncRegister(id, true);
          } catch (e) {
            if (!local.business) throw e;
            setSyncErr(message(e));
          }
        } else if (id !== DEMO && !local.business)
          throw Error(
            "Connect to the internet to open this account for the first time.",
          );
        show(id, local);
      } catch (e) {
        if (active.current === id) setBootError(message(e));
      }
    },
    [show],
  );
  useEffect(() => {
    let alive = true;
    async function start() {
      const params = new URLSearchParams(location.search);
      const invite = readInviteCode(params.get("invite"));
      if (params.has("invite")) {
        const url = new URL(location.href);
        url.searchParams.delete("invite");
        history.replaceState(null, "", url);
      }
      openedInvite = invite;
      if (invite)
        try {
          localStorage.setItem(INVITE, invite);
        } catch {
          /* storage is blocked; the link still works if they are signed in */
        }
      const businessId = params.get("shifts"),
        code = readJoinCode(params.get("j") ?? "");
      joinTarget.current = code
        ? { code }
        : businessId
          ? { businessId, bookingId: params.get("shift") }
          : null;
      let id = localStorage.getItem(ACTIVE) || DEMO;
      // Supabase processes the confirmation callback on the application origin.
      if (
        id === DEMO &&
        (location.hash.includes("access_token=") ||
          location.search.includes("code="))
      ) {
        try {
          const { data } = await authClient().auth.getSession();
          if (data.session) id = data.session.user.id;
        } catch (e) {
          if (alive) setNotice(message(e));
        }
      }
      if (alive && id === DEMO && invite) {
        setNotice("Sign in or create an account to join the team.");
        setAccount(true);
      }
      if (alive) await connect(id);
    }
    void start().catch((e) => setBootError(message(e)));
    return () => {
      alive = false;
    };
  }, [connect]);
  useEffect(() => {
    if (!key) return;
    const refresh = () => {
      void loadRegister(key)
        .then((s) => show(key, s))
        .catch((e) => setNotice(message(e)));
    };
    return subscribeRegister(key, refresh);
  }, [key, show]);
  const flush = useCallback(
    async (force = false) => {
      const id = active.current;
      if (!id || !navigator.onLine || syncBusy.current) return;
      syncBusy.current = true;
      try {
        await syncRegister(id, force);
        show(id, await loadRegister(id));
        if (active.current === id) setSyncErr("");
      } catch (e) {
        if (active.current === id) setSyncErr(message(e));
      } finally {
        syncBusy.current = false;
      }
    },
    [show],
  );
  useEffect(() => {
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void flush(true);
    };
    const visible = () => {
      if (document.visibilityState === "visible") network();
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", visible);
    // Every 15 seconds send what this phone did. Every 30, also pull in what the other
    // phones on the shift did, so sales, expenses and a close show up everywhere.
    let tick = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void flush(++tick % 2 === 0);
    }, 15000);
    return () => {
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(timer);
    };
  }, [flush]);
  useEffect(() => {
    if (!state?.business) return;
    let alive = true;
    void prepareOffline().then((value) => {
      if (alive) setReady(value);
    });
    return () => {
      alive = false;
    };
  }, [state?.business?.id, state?.shift?.id, online]);

  // Another phone can close the shift this one is selling on. Say so instead of
  // silently swapping the till for the opening screen.
  const openShift = useRef<{ id: string; number: number; business?: string } | null>(null),
    closingHere = useRef(false);
  const live = state?.shift && !state.shift.closedAt ? state.shift : null;
  useEffect(() => {
    const before = openShift.current;
    if (!state) return;
    openShift.current = live ? { id: live.id, number: live.number, business: state.business?.id } : null;
    if (before && before.business === state.business?.id && before.id !== live?.id && !closingHere.current)
      setNotice(`Shift ${before.number} was closed on another phone. Anything sold here still counts toward it.`);
    closingHere.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.id, state?.business?.id]);

  // The business's branding themes the whole app: buttons, text, font and corners.
  const brandSettings = state?.business?.settings;
  const theme = JSON.stringify([brandSettings?.brand, brandSettings?.font, brandSettings?.radius, brandSettings?.ink]);
  useEffect(() => {
    applyTheme(brandSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  async function owner(input: OwnerAction) {
    if (!key) throw Error("Register unavailable.");
    if (!navigator.onLine)
      throw Error("Connect to the internet to complete this action.");
    if (input.action === "open" && !(await prepareOffline()))
      throw Error(
        "Could not prepare offline storage. Reload while online and try again.",
      );
    await locked("write-" + key, async () => {
      await syncRegister(key);
      await locked("sync-" + key, async () => {
        const s = await loadRegister(key);
        if (input.action === "menu" && s.shift && s.cart.length) {
          const nextMenu = updateShiftMenu(s.shift, input.menu, input.stock).menu;
          const cartError = "Finish or clear the current order before changing its prices or options.";
          let current: ReturnType<typeof priceLines>;
          let next: ReturnType<typeof priceLines>;
          try {
            current = priceLines(s.shift.menu, s.cart);
            next = priceLines(nextMenu, s.cart);
          } catch {
            throw Error(cartError);
          }
          if (next.some((line, index) => line.unitPrice !== current[index].unitPrice))
            throw Error(cartError);
        }
        const closingId = input.action === "close" ? s.shift?.id : undefined;
        if (closingId) closingHere.current = true;
        if (closingId) show(key, await beginClose(key, closingId));
        try {
          const data: RegisterResponse =
            key === DEMO
              ? demoAction(s, input)
              : await api(key, {
                  ...input,
                  deviceId: s.deviceId,
                  ...(closingId ? { shiftId: closingId } : {}),
                });
          const { inviteDelivery, deletedRecord, ...snapshot } = data;
          show(key, await mergeServer(key, snapshot));
          setSyncErr("");
          if (deletedRecord && active.current === key) {
            const item = deletedRecord.kind === "menuItem";
            const undoNotice: UndoNotice = {
              id: crypto.randomUUID(),
              text: item ? "Removed " + deletedRecord.item.name : "Shift deleted",
              restoredText: item ? "Item restored" : "Shift restored",
              restore: async (pin) => {
                if (active.current !== key) throw Error("This business is no longer open.");
                await owner(deletedRecord.kind === "menuItem"
                  ? { action: "restoreMenuItem", item: deletedRecord.item, index: deletedRecord.index, pin }
                  : { action: "restoreBooking", booking: deletedRecord.booking, pin });
              },
            };
            setUndoNotices((current) => [...current, undoNotice]);
          }
          if (input.action === "invite") {
            if (key === DEMO) setToast("Invitation saved in demo");
            else if (!input.email.trim()) setToast("Invite link ready");
            else if (inviteDelivery === "sent") {
              setNotice("");
              setToast("Invitation email sent");
            }
            else setNotice(
              inviteDelivery === "unavailable"
                ? "Invitation saved. Email sending is unavailable. Open the pending invite to share its link."
                : "Invitation saved. Email delivery could not be confirmed. Open the pending invite to retry or share its link.",
            );
          }
        } catch (error) {
          closingHere.current = false;
          // A timeout can follow a successful commit. Keep the till locked until a retry confirms the close.
          if (
            closingId &&
            !s.closingShiftId &&
            (key === DEMO ||
              (error instanceof RequestFailure &&
                error.status >= 400 &&
                error.status < 500))
          ) {
            show(key, await cancelClose(key, closingId));
          }
          throw error;
        }
      });
    });
    if (input.action === "open") setTab("sell");
    if (input.action === "setup") openMenu();
  }
  async function cart(next: CartLine[]) {
    if (!state || !key) throw Error("Register unavailable.");
    await locked("write-" + key, async () =>
      show(key, await saveCart(key, next, state.cart)),
    );
  }
  async function sell(tender: Tender, received: number, discountId?: string, proofs?: string[]) {
    if (!state || !key) throw Error("Register unavailable.");
    setPending(true);
    try {
      const result = await locked("write-" + key, () =>
        checkout(key, tender, received, state.cart, discountId, proofs, state.shift?.menuVersion ?? "opening"),
      );
      show(key, result.state);
      void flush();
      return result.sale;
    } finally {
      setPending(false);
    }
  }
  async function expense(input: { label: string; amount: number; source: "till" | "pocket" }) {
    if (!key) throw Error("Register unavailable.");
    await locked("write-" + key, async () =>
      show(key, await logExpense(key, { ...input, by: state?.me?.name || undefined })),
    );
    void flush();
  }
  async function unexpense(id: string) {
    if (!key) throw Error("Register unavailable.");
    await locked("write-" + key, async () => show(key, await removeExpense(key, id)));
    void flush();
  }
  async function available(id: string, out: boolean) {
    if (!key) throw Error("Register unavailable.");
    await locked("write-" + key, async () =>
      show(key, await setAvailability(key, id, out)),
    );
    void flush();
  }
  async function signOut() {
    if (!key || key === DEMO) return;
    await locked("write-" + key, async () => {
      await syncRegister(key);
      const s = await loadRegister(key);
      if (s.pending.length)
        throw Error("Sync this device before signing out.");
      const { error } = await authClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      await clearRegister(key);
    });
    setSettingsPage(null);
    setRecipesPage(null);
    await connect(DEMO);
  }
  const demo = key === DEMO;
  const faces = state ? facesOf(state) : { byId: {}, byName: {} };
  const business = state?.business;
  const status = state?.pending.length
    ? `${state.pending.length} waiting to sync`
    : syncErr
      ? "Sync paused"
      : online
        ? "Online"
        : "Offline";
  const canManageRecipes = !state?.me || state.me.owner;
  const view: Tab = tab === "recipes" && !canManageRecipes ? "sell" : tab;
  const activeTabIndex = tabs.findIndex((item) => item.id === view);
  const sellable = Boolean(state?.shift && !state.shift.closedAt && !state.closingShiftId);
  const go = (t: Tab) => {
    if (t !== tab) buzz.tap();
    setTab(t);
    if (t !== "schedule") setSharedSchedule(null);
    if (t === "settings") setSettingsPage(null);
    if (t === "recipes") setRecipesPage(null);
    window.scrollTo(0, 0);
  };
  function openMenu() {
    go("recipes");
    setRecipesPage("menu");
  }
  async function upload(file: File, face = false) {
    const photo = await compressPhoto(file);
    if (!key || key === DEMO) return blobToDataUrl(photo);
    if (!navigator.onLine) throw Error("Connect to add photos.");
    return uploadImage(key, photo, false, face);
  }
  // Shared schedules open a specific shift. Team invitations open the team's open seats.
  useEffect(() => {
    const target = joinTarget.current;
    if (!target || !state || !key) return;
    const done = () => {
      joinTarget.current = null;
      const url = new URL(location.href);
      url.searchParams.delete("shifts");
      url.searchParams.delete("shift");
      url.searchParams.delete("j");
      history.replaceState(null, "", url);
    };
    // Short links carry codes cut from the ids. Match them against this person's teams.
    const businessId =
      "code" in target
        ? (matchCode(state.business ? [state.business] : [], target.code.team, TEAM_CODE) ??
            matchCode(state.businesses, target.code.team, TEAM_CODE))?.id
        : target.businessId;
    const asked = "code" in target ? target.code.shift : target.bookingId;
    if (!businessId || state.business?.id !== businessId) {
      if (key === DEMO) {
        if (!joinAsked.current) {
          joinAsked.current = true;
          setNotice(asked ? "Sign in to see this shift." : "Sign in to see the open shifts.");
          setAccount(true);
        }
        return;
      }
      if (!online || syncErr) return;
      if (businessId && state.businesses?.some((b) => b.id === businessId))
        void switchBusiness(businessId).catch((e) => setNotice(message(e)));
      else {
        done();
        setNotice("You're not on that team yet. Ask the owner for an invite link.");
      }
      return;
    }
    done();
    const bookingId =
      ("code" in target
        ? target.code.shift ? matchCode(state.bookings, target.code.shift, SHIFT_CODE) : undefined
        : state.bookings?.find((b) => b.id === target.bookingId)
      )?.id ?? null;
    if (asked && !bookingId) setNotice("This shift is no longer available.");
    setSharedSchedule({ bookingId });
    setTab("schedule");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.business?.id, state?.businesses, key, online, syncErr]);
  /** Open another business on this phone. Each keeps its own till and sync queue. */
  async function switchBusiness(businessId: string) {
    if (!key || key === DEMO || state?.business?.id === businessId) return;
    const { userId } = parseKey(key);
    if (navigator.onLine) await flush();
    const first = await loadRegister(userId);
    buzz.tick();
    setSettingsPage(null);
    setRecipesPage(null);
    await connect(first.business?.id === businessId ? userId : registerKey(userId, businessId));
  }
  async function addBusiness(input: OwnerAction) {
    if (!key || key === DEMO) throw Error("Sign in to add a business.");
    if (input.action !== "setup") return;
    if (!navigator.onLine) throw Error("Connect to the internet to add a business.");
    const id = crypto.randomUUID();
    const next = registerKey(parseKey(key).userId, id);
    await locked("write-" + next, async () => {
      const data = await api(next, { ...input, id });
      await mergeServer(next, data);
    });
    setAdding(false);
    await connect(next);
    openMenu();
    setToast("Added " + input.name);
  }
  const loadProof = useCallback(
    (url: string) => (!key || key === DEMO || url.startsWith("data:") ? Promise.resolve(url) : proofBlob(key, url)),
    [key],
  );
  const reverse = (saleId: string, reason: string, pin: string) =>
    owner({ action: "reverse", saleId, reason, pin });

  let screen: React.ReactNode;
  if (bootError)
    screen = (
      <div className="page narrow">
        <h1 className="headline" style={{ paddingTop: 24 }}>
          Can't open the register. <span className="g">{bootError}</span>
        </h1>
        <button className="btn" onClick={() => key && void connect(key)}>
          Retry
        </button>
        <button className="link" onClick={() => setAccount(true)}>
          Sign in
        </button>
      </div>
    );
  else if (adding)
    screen = <Setup adding onSave={addBusiness} onSignOut={() => setAdding(false)} />;
  else if (!state) screen = <div className="loading" role="status">Opening register…</div>;
  else if (!business)
    screen = <Setup onSave={owner} onSignOut={() => setConfirmSignOut(true)} />;
  else if (view === "schedule")
    screen = (
      <ScheduleScreen
        key={sharedSchedule?.bookingId ?? (sharedSchedule ? "open-seats" : "schedule")}
        state={state}
        online={online}
        demo={demo}
        sharedSchedule={sharedSchedule}
        onAction={owner}
        onSaved={setToast}
        onSales={(focus: SalesFocus) => {
          setSalesFocus(focus);
          go("sales");
        }}
      />
    );
  else if (view === "settings")
    screen = (
      <SettingsScreen
        state={state}
        online={online}
        demo={demo}
        status={status}
        offlineReady={ready}
        page={settingsPage}
        onPage={setSettingsPage}
        onSaved={setToast}
        onSave={(input, pin) => owner({ action: "settings", ...input, pin })}
        onMenu={(menu, pin, stock) => owner({ action: "menu", menu, pin, stock })}
        onAction={owner}
        onSignIn={() => setAccount(true)}
        onSignOut={() => setConfirmSignOut(true)}
        onBusinesses={() => setSwitching(true)}
        onRecipes={() => go("recipes")}
      />
    );
  else if (view === "recipes")
    screen = (
      <RecipesScreen
        state={state}
        online={online}
        page={recipesPage}
        onPage={setRecipesPage}
        onBack={() => go("settings")}
        onSaved={setToast}
        onSave={(input, pin) => owner({ action: "settings", ...input, pin })}
        onMenu={(menu, pin, stock) => owner({ action: "menu", menu, pin, stock })}
        onRemoveMenuItem={(productId, pin) => owner({ action: "removeMenuItem", productId, pin })}
      />
    );
  else if (view === "sales")
    screen = (
      <SalesScreen
        key={salesFocus ? JSON.stringify(salesFocus.filter) : "sales"}
        state={state}
        online={online}
        onReverse={reverse}
        onSell={() => go("sell")}
        focus={salesFocus}
      />
    );
  else if (view === "shift" || !sellable)
    screen = (
        <ShiftScreen
          key={view}
          compact={view === "sell"}
          state={state}
          online={online}
          onOpen={(opening: Opening) => owner({ action: "open", ...opening })}
          onSchedule={() => go("schedule")}
          onShift={setTillBooking}
          demo={demo}
          onSales={(focus: SalesFocus) => {
            setSalesFocus(focus);
            go("sales");
          }}
          onClose={(closing, pin) => owner({ action: "close", ...closing, pin })}
          onExpense={expense}
          onUnexpense={unexpense}
          onLink={(newShift) => owner({ action: "link", newShift })}
          onSell={() => go("sell")}
          onGoMenu={canManageRecipes ? openMenu : undefined}
        />
      );
  else
    screen = (
      <div className="page">
        <SellScreen
          state={state}
          status={status}
          online={online}
          pending={pending}
          onCart={cart}
          onCheckout={sell}
          onAvailability={available}
          onReverse={reverse}
          onMenu={(menu, pin, stock) => owner({ action: "menu", menu, pin, stock })}
          onSaved={setToast}
          onTill={() => go("shift")}
        />
      </div>
    );

  return (
    <CelebrateProvider>
    <PhotoProvider value={upload}>
      <FacesProvider value={faces}>
    <ProofProvider value={loadProof}>
    <PinProvider hint={demo ? "The demo PIN is 1234." : undefined}>
      {business && (
        <header className={"account-bar" + (view === "sell" && sellable ? "" : " narrow")}>
          <button type="button" className="grow sell-brand" onClick={() => setSwitching(true)} aria-label={"Switch business, now " + business.name}>
            <BusinessMark name={business.name} logo={business.settings.logo} brand={business.settings.brand} size={36} />
            <span className="strong ellipsis">{business.name}</span>
            <ChevronDown size={16} className="chev-down" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="account-button"
            aria-label="Account and settings"
            aria-current={view === "settings" || view === "recipes" ? "page" : undefined}
            aria-description={syncErr ? "Sync paused" : !online ? "Offline" : undefined}
            onClick={() => go("settings")}
          >
            <span className={"avatar" + (state?.me?.photo ? " has-photo" : "")} aria-hidden="true">
              {state?.me?.photo ? <img src={state.me.photo} alt="" /> : state?.me?.name ? initialsOf(state.me.name) : <UserRound size={20} strokeWidth={1.8} />}
            </span>
            {(syncErr || !online) && <span className="account-dot" aria-hidden="true" />}
          </button>
        </header>
      )}
      {(notice || (syncErr && !bootError)) && (
        <div className="page narrow" style={{ paddingBottom: 0, marginBottom: -14 }}>
          {notice && (
            <div className="notice" role="alert">
              <span className="grow">{notice}</span>
              <button className="round flat" aria-label="Dismiss" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {syncErr && !bootError && (
            <div className="notice" role="alert">
              <span className="dot danger" />
              <span className="grow">{syncErr}</span>
              <button className="btn small secondary" onClick={() => void flush(true)}>
                Retry
              </button>
              {!demo && (
                <button className="btn small" onClick={() => setAccount(true)}>
                  Sign in
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <main>{screen}</main>
      {business && (
        <nav
          className="tabbar"
          aria-label="Main"
          style={{
            "--tab-count": tabs.length,
            "--tab-offset": `${Math.max(0, activeTabIndex) * 100}%`,
          } as CSSProperties}
        >
          {activeTabIndex >= 0 && <span className="tab-selection" aria-hidden="true" />}
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={view === t.id ? "page" : undefined}
              onClick={() => {
                setSalesFocus(null);
                go(t.id);
              }}
            >
              <t.icon size={20} strokeWidth={view === t.id ? 2.1 : 1.7} aria-hidden="true" />
              <span>{t.name}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="sr-only" role="status" aria-atomic="true">
        {toast || undoNotices.at(-1)?.text}
      </div>
      {(toast || undoNotices.length > 0) && (
        <div className="toast-viewport">
          {toast && <Toast text={toast} onDone={() => setToast("")} />}
          {undoNotices.map((entry) => (
            <Toast
              key={entry.id}
              text={entry.text}
              undo={entry.restore}
              onDone={(restored) => {
                setUndoNotices((current) => current.filter((notice) => notice.id !== entry.id));
                if (restored) setToast(entry.restoredText);
              }}
            />
          ))}
        </div>
      )}
      {confirmSignOut && (
        <ConfirmSheet
          title="Sign out?"
          detail="You’ll need to sign in again to access this business on this device."
          confirmLabel="Sign out"
          onConfirm={signOut}
          onClose={() => setConfirmSignOut(false)}
        />
      )}
      {switching && state?.business && (
        <BusinessSwitcher
          state={state}
          demo={demo}
          online={online}
          onClose={() => setSwitching(false)}
          onAdd={() => {
            setSwitching(false);
            setAdding(true);
          }}
          onSwitch={(id) => {
            setSwitching(false);
            void switchBusiness(id).catch((e) => setNotice(message(e)));
          }}
        />
      )}
      {tillBooking && state?.business && (
        <ScheduledShiftSheet
          key={state.business.id + ":" + tillBooking}
          bookingId={tillBooking}
          state={state}
          online={online}
          demo={demo}
          onAction={owner}
          onSaved={setToast}
          onClose={() => setTillBooking(null)}
          onSales={(focus) => {
            setTillBooking(null);
            setSalesFocus(focus);
            go("sales");
          }}
        />
      )}
      {account && (
        <Account
          onDismiss={() => setAccount(false)}
          requiredUser={key && key !== DEMO ? parseKey(key).userId : undefined}
          onSignedIn={async (id) => {
            setAccount(false);
            await connect(id);
          }}
        />
      )}
    </PinProvider>
    </ProofProvider>
      </FacesProvider>
    </PhotoProvider>
    </CelebrateProvider>
  );
}
