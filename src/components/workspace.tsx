"use client";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { Activity, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BookOpen, CalendarDays, ChevronDown, ReceiptText, ShoppingBag, UserRound, Wallet, X } from "lucide-react";
import { SellScreen } from "./sell";
import { SalesScreen, type SalesFocus } from "./sales";
import { ShiftScreen } from "./shift";
import { SettingsScreen, type SettingsPage, type EditorProps } from "./settings";
import { RecipesScreen, type RecipesPage } from "./recipes";
import { ScheduleScreen } from "./schedule";
import { LeaderboardPage } from "./leaderboard";
import { captureScreen, HistoryScreen, restoreScreen, useScreenHistory } from "./screen-history";
import { Account, AccountLinkError, AccountSwitcher, Setup, type AccountEntry } from "./account";
import { BusinessMark, BusinessSwitcher, initialsOf } from "./businesses";
import { LoadingScreen } from "./loading-screen";
import { Onboarding } from "./onboarding";
import { buzz, CelebrateProvider, ConfirmSheet, FacesProvider, facesOf, EmptyState, Notice, PhotoProvider, PinProvider, ProofProvider, Toast } from "./ui";
import { installRejects, onReject } from "@/lib/reject";
import { blobToDataUrl, compressPhoto, dataUrlToBlob } from "@/lib/photo";
import { accountsEnabled, api, authClient, authForUser, forgetAccount, parseKey, proofBlob, registerKey, rememberAccount, RequestFailure, savedAccounts, uploadImage, type SavedAccount } from "@/lib/client";
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
import type { CartLine, ExpenseInput, RegisterResponse, RegisterState, Tender } from "@/lib/types";

const tabs = [
  { id: "sell", name: "Sell", icon: ShoppingBag },
  { id: "sales", name: "Sales", icon: ReceiptText },
  { id: "shift", name: "Till", icon: Wallet },
  { id: "schedule", name: "Shifts", icon: CalendarDays },
  { id: "recipes", name: "Recipes", icon: BookOpen },
] as const;
type Tab = (typeof tabs)[number]["id"] | "settings";
type Screen =
  | { tab: "sell" | "add-business" }
  | { tab: "shift"; openingId?: string }
  | { tab: "sales"; focus?: SalesFocus }
  | { tab: "schedule"; leaderboard?: boolean; shared?: { bookingId: string | null } }
  | { tab: "settings"; page?: SettingsPage }
  | { tab: "recipes"; page?: RecipesPage };

const SELL: Screen = { tab: "sell" };

function isTabHome(screen: Screen) {
  switch (screen.tab) {
    case "recipes":
    case "settings":
      return !screen.page;
    case "shift":
      return !screen.openingId;
    case "schedule":
      return !screen.leaderboard && !screen.shared;
    case "sales":
      return !screen.focus;
    case "sell":
      return true;
    case "add-business":
      return false;
  }
}

function screenName(screen?: Screen) {
  if (!screen) return undefined;
  if (screen.tab === "settings" || screen.tab === "recipes") {
    const titles = {
      business: "business settings", checklist: "opening checklist", currency: "currency and time",
      discounts: "discounts", organizers: "organizers", payments: "payment methods", team: "team",
      menu: "menu items", categories: "categories", choices: "choices", stock: "stock items",
      prep: "prep", "stock-lists": "stock lists", costing: "menu costing", pricing: "pricing rules",
      preview: "menu preview",
    } as const;
    return screen.page ? titles[screen.page] : screen.tab;
  }
  if (screen.tab === "schedule") return screen.leaderboard ? "leaderboard" : "shifts";
  if (screen.tab === "shift") return screen.openingId ? "open till" : "till";
  if (screen.tab === "add-business") return "add a business";
  return screen.tab === "sell" ? "selling" : "sales";
}
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
const DEMO_SESSION = "portable-pos-demo";
const LEGACY_INVITE = "portable-pos-invite";
const REGISTER_ENTRY: AccountEntry = { kind: "register" };

function clearLinkParams(...params: string[]) {
  const url = new URL(location.href);
  for (const param of params) url.searchParams.delete(param);
  history.replaceState(history.state, "", url);
}

/** Keep the account's usual cache key when a link opens its primary business. */
async function keyForBusiness(userId: string, businessId: string) {
  const first = await loadRegister(userId);
  return first.business?.id === businessId ? userId : registerKey(userId, businessId);
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
      return mergeServer(key, await api(key, { action: "bootstrap", deviceId: current.deviceId, till: current.shift?.id ?? null }));
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
        till: current.shift?.id ?? null,
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
    [state, setState] = useState<RegisterState | null>(null);
  const navigation = useScreenHistory<Screen>(SELL);
  const resetNavigation = navigation.reset;
  const [online, setOnline] = useState(true),
    [notice, setNotice] = useState(""),
    [syncErr, setSyncErr] = useState(""),
    [ready, setReady] = useState(false);
  const [account, setAccount] = useState(false),
    [pending, setPending] = useState(false),
    [bootError, setBootError] = useState(""),
    [toast, setToast] = useState(""),
    [toastStamp, setToastStamp] = useState(0),
    [undoNotices, setUndoNotices] = useState<UndoNotice[]>([]),
    [confirmSignOut, setConfirmSignOut] = useState(false),
    [switching, setSwitching] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [deferredOnboarding, setDeferredOnboarding] = useState<string | null>(null);
  const [signingInto, setSigningInto] = useState<SavedAccount | "new" | null>(null);
  const [entry, setEntry] = useState<AccountEntry | null>(null);
  const [resolvingLink, setResolvingLink] = useState(false);
  const [linkProblem, setLinkProblem] = useState<{ title: string; detail: string; switchAccount?: boolean } | null>(null);
  const active = useRef<string | null>(null),
    syncBusy = useRef(false),
    joinTarget = useRef<JoinTarget | null>(null),
    inviteTarget = useRef<string | null>(null);
  const demoEntry = useRef<ReturnType<typeof captureScreen>>(undefined);
  useLayoutEffect(() => {
    if (key || !entry || !demoEntry.current) return;
    restoreScreen(demoEntry.current);
    demoEntry.current = undefined;
  }, [key, entry]);
  // Toasts sit in the top layer, above any open sheet, so a refused tap inside a sheet still
  // shows its reason. Re-raised on each new toast, in case a sheet opened since the last one.
  const toastLayer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = toastLayer.current;
    if (!node || typeof node.showPopover !== "function") return;
    node.popover = "manual";
    if (node.matches(":popover-open")) node.hidePopover();
    node.showPopover();
  }, [toast, toastStamp, undoNotices.length]);
  // A tap on something blocked (a future shift, a sold-out item) says why in the toast.
  useEffect(() => {
    const uninstall = installRejects();
    const unlisten = onReject((reason) => {
      setToast(reason);
      setToastStamp((n) => n + 1);
    });
    return () => {
      uninstall();
      unlisten();
    };
  }, []);
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
      resetNavigation(SELL);
      setSwitching(null);
      const { userId } = parseKey(id);
      const invite = id !== DEMO ? inviteTarget.current : null;
      const linked = id !== DEMO && (invite || joinTarget.current);
      setLinkProblem(null);
      setResolvingLink(Boolean(linked));
      try {
        if (linked && !navigator.onLine)
          throw Error("Connect to the internet to open this link.");
        if (invite) {
          let data: RegisterResponse | undefined;
          try {
            data = await api(userId, { action: "acceptInvite", code: invite });
          } catch (e) {
            if (!(e instanceof RequestFailure) || e.status !== 404) throw e;
            setLinkProblem({ title: "Invitation unavailable", detail: message(e) });
          }
          if (data?.business) {
            const joined = data.business;
            const next = await keyForBusiness(userId, joined.id);
            await locked("write-" + next, () => mergeServer(next, data));
            id = next;
            joinTarget.current ??= { businessId: joined.id, bookingId: null };
            setToast("You joined " + joined.name);
            active.current = id;
            setKey(id);
          }
          inviteTarget.current = null;
          localStorage.removeItem(LEGACY_INVITE);
          clearLinkParams("invite");
        }
        if (id !== DEMO) localStorage.setItem(ACTIVE, id);
        let local = await loadRegister(id);
        if (id === DEMO && !local.business)
          local = await locked("write-" + id, async () => {
            const current = await loadRegister(id);
            return current.business
              ? current
              : mergeServer(id, demoBootstrap(current.deviceId));
          });
        // Wait for current membership before opening a shared destination.
        if (local.business && !linked) show(id, local);
        if (id !== DEMO && navigator.onLine) {
          try {
            local = await syncRegister(id, true);
          } catch (e) {
            if (!local.business || linked) throw e;
            setSyncErr(message(e));
          }
        } else if (id !== DEMO && !local.business)
          throw Error(
            "Connect to the internet to open this account for the first time.",
          );
        const target = id !== DEMO ? joinTarget.current : null;
        if (target) {
          const businessId = "code" in target
            ? (matchCode(local.business ? [local.business] : [], target.code.team, TEAM_CODE) ??
                matchCode(local.businesses, target.code.team, TEAM_CODE))?.id
            : target.businessId;
          const asked = "code" in target ? target.code.shift : target.bookingId;
          if (businessId && local.business?.id !== businessId && local.businesses?.some((b) => b.id === businessId)) {
            const next = await keyForBusiness(userId, businessId);
            local = await syncRegister(next, true);
            id = next;
            active.current = id;
            setKey(id);
            localStorage.setItem(ACTIVE, id);
          }
          if (!businessId || local.business?.id !== businessId) {
            setLinkProblem({
              title: asked ? "You can’t open this shift" : "You can’t open this schedule",
              detail: "Sign in with an account on this team, or ask the business owner for an invitation.",
              switchAccount: true,
            });
          } else {
            const booking = "code" in target
              ? target.code.shift ? matchCode(local.bookings, target.code.shift, SHIFT_CODE) : undefined
              : local.bookings?.find((b) => b.id === target.bookingId);
            if (asked && !booking) {
              setLinkProblem({ title: "Shift unavailable", detail: "Ask your team for a current shift link." });
            } else {
              joinTarget.current = null;
              clearLinkParams("shifts", "shift", "j");
              setEntry(REGISTER_ENTRY);
              setLinkProblem(null);
              resetNavigation({ tab: "schedule", shared: { bookingId: booking?.id ?? null } });
            }
          }
        }
        show(id, local);
      } catch (e) {
        if (active.current === id) setBootError(message(e));
      } finally {
        if (active.current === id) setResolvingLink(false);
      }
    },
    [show, resetNavigation],
  );
  useEffect(() => {
    let alive = true;
    async function start() {
      const params = new URLSearchParams(location.search);
      const authParams = new URLSearchParams(location.hash.slice(1));
      const confirmation = authParams.has("access_token") || params.has("code");
      const invite = readInviteCode(params.get("invite")) ??
        (confirmation ? readInviteCode(localStorage.getItem(LEGACY_INVITE)) : null);
      const shortLink = params.get("j") ?? "";
      const code = readJoinCode(shortLink);
      const businessId = params.get("shifts");
      const bookingId = params.get("shift");
      inviteTarget.current = invite;
      joinTarget.current = code
        ? { code }
        : businessId
          ? { businessId, bookingId }
          : null;
      const kind = code?.shift || (businessId && bookingId) ? "shift"
        : invite ? "invite" : code || businessId ? "business" : "register";
      const returnTo = new URL("/", location.origin);
      if (invite) returnTo.searchParams.set("invite", invite);
      if (code) returnTo.searchParams.set("j", shortLink);
      else if (businessId) {
        returnTo.searchParams.set("shifts", businessId);
        if (bookingId) returnTo.searchParams.set("shift", bookingId);
      }
      const loginEntry: AccountEntry = kind === "register" ? REGISTER_ENTRY : { kind, returnTo: returnTo.href, code: invite ?? (code ? shortLink : undefined) };
      let id: string | null = null;
      if (accountsEnabled) {
        const previous = localStorage.getItem(ACTIVE);
        // Supabase finishes a confirmation URL before returning the session.
        const auth = confirmation ? authClient() : authForUser(previous ? parseKey(previous).userId : undefined);
        const { data: { session }, error } = await auth.auth.getSession();
        if (!alive) return;
        if (session && !session.user.is_anonymous) {
          const userId = session.user.id;
          rememberAccount({ id: userId, email: session.user.email, ...(confirmation ? { slot: undefined } : {}) });
          id = previous && parseKey(previous).userId === userId ? previous : userId;
        } else if (!navigator.onLine && previous && previous !== DEMO && isAuthRetryableFetchError(error))
          id = previous; // A cached session can be unable to refresh offline.
        else if (authParams.has("error_code") || params.has("error_code"))
          setNotice("This confirmation link is no longer valid. Try signing in or creating an account again.");
        else if (error) {
          setNotice(message(error));
        }
      }
      if (!alive) return;
      if (!id && kind === "register" && sessionStorage.getItem(DEMO_SESSION)) id = DEMO;
      if (id) void connect(id);
      setEntry(loginEntry);
    }
    void start().catch((e) => {
      if (alive) {
        setNotice(message(e));
        setEntry(REGISTER_ENTRY);
      }
    });
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
  const accountName = state?.me?.name;
  const accountBusiness = state?.business?.name;
  useEffect(() => {
    if (key && key !== DEMO && accountBusiness) {
      rememberAccount({ id: parseKey(key).userId, register: key, name: accountName, business: accountBusiness });
    }
  }, [key, accountName, accountBusiness]);
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
    const exitsBusiness = input.action === "leaveTeam" || input.action === "deleteBusiness";
    const remainingBusinesses = await locked("write-" + key, async () => {
      await syncRegister(key);
      return locked("sync-" + key, async () => {
        const s = await loadRegister(key);
        if (exitsBusiness) {
          if (s.business?.id !== input.businessId) throw Error("This business is no longer open.");
          if (s.cart.length)
            throw Error("Finish or clear the current order before continuing.");
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
                  till: s.shift?.id ?? null,
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
          if (exitsBusiness) return snapshot.businesses;
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
    if (exitsBusiness && active.current === key) {
      const { userId } = parseKey(key);
      const nextBusiness = remainingBusinesses?.[0];
      const next = nextBusiness ? await keyForBusiness(userId, nextBusiness.id) : userId;
      if (active.current !== key) return;
      rememberAccount({ id: userId, register: next, business: nextBusiness?.name });
      await connect(next);
      setToast(input.action === "leaveTeam" ? "You left the team" : "Business deleted");
    }
    if (input.action === "setup" && active.current === key) {
      resetNavigation({ tab: "recipes" });
      navigation.open({ tab: "recipes", page: "menu" });
    }
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
  async function expense(input: ExpenseInput) {
    if (!key) throw Error("Register unavailable.");
    const by = state?.me?.name || undefined;
    await locked("write-" + key, async () =>
      show(key, await logExpense(key, { ...input, by })),
    );
    void flush();
  }
  /** Sell on a booth another phone already opened. Each phone runs one shift at a time. */
  async function join(shiftId: string) {
    if (!key) throw Error("Register unavailable.");
    if (!navigator.onLine) throw Error("Connect to the internet to join this shift.");
    if (!(await prepareOffline()))
      throw Error("Could not prepare offline storage. Reload while online and try again.");
    await locked("write-" + key, async () => {
      await syncRegister(key);
      await locked("sync-" + key, async () => {
        const s = await loadRegister(key);
        if (s.shift && !s.shift.closedAt) throw Error(`Close shift ${s.shift.number} on this phone first.`);
        const data = await api(key, { action: "bootstrap", deviceId: s.deviceId, till: shiftId });
        show(key, await mergeServer(key, data));
        if (data.shift?.id !== shiftId) throw Error("That shift just closed.");
      });
    });
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
  function openLogin() {
    sessionStorage.removeItem(DEMO_SESSION);
    active.current = null;
    setKey(null);
    setState(null);
    setAccount(false);
    setBootError("");
    setNotice("");
    setSyncErr("");
    setLinkProblem(null);
    resetNavigation(SELL);
    window.scrollTo(0, 0);
  }
  async function signOut() {
    if (!key || key === DEMO) return;
    await locked("write-" + key, async () => {
      await syncRegister(key);
      const s = await loadRegister(key);
      if (s.pending.length)
        throw Error("Sync this device before signing out.");
      const userId = parseKey(key).userId;
      const { error } = await authForUser(userId).auth.signOut({ scope: "local" });
      if (error) throw error;
      await clearRegister(key);
      forgetAccount(userId);
    });
    localStorage.removeItem(ACTIVE);
    setDeferredOnboarding(null);
    openLogin();
  }
  const demo = key === DEMO;
  const userId = key && !demo ? parseKey(key).userId : null;
  const current = navigation.current.screen;
  const showOnboarding = Boolean(userId && state?.business && state.me?.owner && state.onboardingComplete === false &&
    deferredOnboarding !== userId && !(current.tab === "schedule" && current.shared) &&
    !bootError && current.tab !== "add-business");
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
  const view = current.tab === "recipes" && !canManageRecipes ? "sell" : current.tab;
  const navTabs = canManageRecipes ? tabs : tabs.filter((item) => item.id !== "recipes");
  const activeTabIndex = navTabs.findIndex((item) => item.id === view);
  const go = (tab: Tab) => {
    if (current.tab === tab && isTabHome(current)) return;
    if (view !== tab) buzz.tap();
    const previous = navigation.entries[navigation.index - 1]?.screen;
    if (previous?.tab === tab && isTabHome(previous)) {
      navigation.back(navigation.current.id);
    } else {
      navigation.open({ tab });
    }
  };
  async function upload(file: File, face = false) {
    const photo = await compressPhoto(file);
    if (!key || key === DEMO) return blobToDataUrl(photo);
    if (!navigator.onLine) throw Error("Connect to add photos.");
    return uploadImage(key, photo, false, face);
  }
  /** Open another business on this phone. Each keeps its own till and sync queue. */
  async function switchBusiness(businessId: string) {
    if (!key || key === DEMO || state?.business?.id === businessId) return;
    const { userId } = parseKey(key);
    if (navigator.onLine) await flush();
    buzz.tick();
    await connect(await keyForBusiness(userId, businessId));
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
    await connect(next);
    resetNavigation({ tab: "recipes" });
    navigation.open({ tab: "recipes", page: "menu" });
    setToast("Added " + input.name);
  }
  async function useSavedAccount(entry: SavedAccount) {
    const { data: { session } } = await authForUser(entry.id).auth.getSession();
    if (session?.user.id !== entry.id) {
      if (!navigator.onLine) throw Error("Connect to sign in to this account again.");
      setSigningInto(entry);
      return;
    }
    await openAccount(entry.id);
  }

  async function openAccount(id: string) {
    if (navigator.onLine) await flush();
    const destination = savedAccounts().find((entry) => entry.id === id)?.register;
    setPickingAccount(false);
    setSigningInto(null);
    setNotice("");
    sessionStorage.removeItem(DEMO_SESSION);
    await connect(destination && parseKey(destination).userId === id ? destination : id);
  }

  const accountSheets = (
    <>
      {pickingAccount && (
        <AccountSwitcher
          accounts={savedAccounts()}
          current={key ? parseKey(key).userId : undefined}
          online={online}
          onSelect={useSavedAccount}
          onAdd={() => setSigningInto("new")}
          onClose={() => setPickingAccount(false)}
        />
      )}
      {signingInto && (
        <Account
          signInOnly={signingInto !== "new"}
          initialEmail={signingInto === "new" ? undefined : signingInto.email}
          onDismiss={() => setSigningInto(null)}
          onSignedIn={openAccount}
        />
      )}
    </>
  );
  const loadProof = useCallback(
    (url: string) => (!key || key === DEMO || url.startsWith("data:") ? Promise.resolve(url) : proofBlob(key, url)),
    [key],
  );
  const reverse = (saleId: string, reason: string, pin: string) =>
    owner({ action: "reverse", saleId, reason, pin });

  if (!entry || resolvingLink)
    return (
      <main>
        <LoadingScreen message={resolvingLink ? "Opening your link…" : "Getting things ready…"} />
      </main>
    );
  if (!key)
    return (
      <>
        <Account
          entry={entry}
          notice={notice}
          onChooseAccount={entry.kind === "register" && savedAccounts().length ? () => setPickingAccount(true) : undefined}
          onSignedIn={openAccount}
          onDemo={() => {
            demoEntry.current = captureScreen();
            sessionStorage.setItem(DEMO_SESSION, "1");
            setNotice("");
            void connect(DEMO);
          }}
        />
        {accountSheets}
      </>
    );
  if (linkProblem && !bootError)
    return (
      <AccountLinkError
        title={linkProblem.title}
        detail={linkProblem.detail}
        onSwitch={linkProblem.switchAccount ? signOut : undefined}
        onContinue={() => {
          joinTarget.current = null;
          clearLinkParams("shifts", "shift", "j");
          setEntry(REGISTER_ENTRY);
          setLinkProblem(null);
        }}
      />
    );

  let content: React.ReactNode;
  if (bootError)
    content = (
      <main>
        <div className="page">
          <h1 className="headline" style={{ paddingTop: 24 }}>
            Can't open the register. <span className="g">{bootError}</span>
          </h1>
          <button className="btn" onClick={() => key && void connect(key)}>
            Retry
          </button>
          <button className="link" onClick={demo ? openLogin : () => setAccount(true)}>
            {demo ? "Back to sign in" : "Sign in"}
          </button>
        </div>
      </main>
    );
  else if (!state) content = <main><LoadingScreen message="Getting your register ready…" /></main>;
  else if (!business)
    content = <main><Setup onboarding={state.onboardingComplete === false} onSave={owner} onSignOut={() => setConfirmSignOut(true)} /></main>;
  else {
    const onMenu: EditorProps["onMenu"] = (menu, pin, stock) => owner({ action: "menu", menu, pin, stock });
    const editor: EditorProps = {
      state, online, onSaved: setToast, onMenu,
      onSave: (input, pin) => owner({ action: "settings", ...input, pin }),
    };
    content = navigation.entries.map((entry, index) => {
      const screen = entry.screen.tab === "recipes" && !canManageRecipes ? SELL : entry.screen;
      const previous = navigation.entries[index - 1]?.screen;
      const backLabel = "Back to " + (screenName(previous) ?? "register");
      const back = () => navigation.back(entry.id);
      const open = (next: Screen) => navigation.open(next, { from: entry.id });
      const onSales = (focus: SalesFocus) => open({ tab: "sales", focus });
      let page: React.ReactNode;
      switch (screen.tab) {
        case "add-business":
          page = <Setup adding onSave={addBusiness} onSignOut={back} />;
          break;
        case "schedule":
          page = screen.leaderboard ? <LeaderboardPage state={state} demo={demo} onBack={back} /> : (
            <ScheduleScreen
              state={state} online={online} demo={demo} sharedSchedule={screen.shared ?? null}
              onAction={owner} onSaved={setToast} onSales={onSales}
              onLeaderboard={() => open({ tab: "schedule", leaderboard: true })}
            />
          );
          break;
        case "settings":
          page = (
            <SettingsScreen
              {...editor}
              demo={demo}
              status={status} offlineReady={ready} page={screen.page ?? null}
              onPage={(page) => open({ tab: "settings", page })}
              onBack={back} backLabel={backLabel}
              onAction={owner} onSignIn={openLogin} onSignOut={() => setConfirmSignOut(true)}
              onBusinesses={() => setSwitching(entry.id)}
              onAccounts={!demo && accountsEnabled ? () => setPickingAccount(true) : undefined}
            />
          );
          break;
        case "recipes":
          page = (
            <RecipesScreen
              {...editor}
              page={screen.page ?? null} onPage={(page) => open({ tab: "recipes", page })}
              onBack={back} backLabel={backLabel}
              onRemoveMenuItem={(productId, pin) => owner({ action: "removeMenuItem", productId, pin })}
              onMergeStock={(shiftIds, pin) => owner({ action: "mergeStock", shiftIds, pin })}
            />
          );
          break;
        case "sales":
          page = (
            <SalesScreen state={state} online={online} onReverse={reverse} onSell={() => go("sell")}
              focus={screen.focus ?? null} onBack={screen.focus && previous ? back : undefined} backLabel={backLabel} />
          );
          break;
        case "shift":
          page = (
            <ShiftScreen
              state={state} online={online} demo={demo} openingId={screen.openingId}
              onStart={(openingId) => open({ tab: "shift", openingId })}
              onBack={back}
              onOpen={async (opening: Opening) => {
                await owner({ action: "open", ...opening });
                navigation.open(SELL, { from: entry.id, replace: true });
              }}
              onJoin={demo ? undefined : join}
              onSchedule={() => go("schedule")}
              onSales={onSales}
              onClose={(closing, pin) => owner({ action: "close", ...closing, pin })}
              onExpense={expense}
              onUnexpense={unexpense}
              onAction={owner}
              onSaved={setToast}
              onSell={previous?.tab === "sell" ? back : () => go("sell")}
              sellLabel={previous?.tab === "sell" ? "Back to selling" : "Go to Sell"}
              onGoMenu={canManageRecipes ? () => open({ tab: "recipes", page: "menu" }) : undefined}
            />
          );
          break;
        case "sell":
          page = (
            <div className="page">
              {state.shift && !state.shift.closedAt ? (
                <SellScreen
                  state={state} status={status} online={online} pending={pending} onCart={cart}
                  onCheckout={sell} onAvailability={available} onReverse={reverse}
                  onMenu={onMenu} onSaved={setToast} onTill={() => go("shift")}
                />
              ) : (
                <EmptyState heading="h1" pose="close" object="cashDrawer" title="Till closed" text="Open the till to start selling.">
                  <button type="button" className="btn compact" onClick={() => go("shift")}>Open till</button>
                </EmptyState>
              )}
            </div>
          );
          break;
      }
      return <HistoryScreen key={entry.id} entry={entry} active={index === navigation.index}>{page}</HistoryScreen>;
    });
  }

  return (
    <CelebrateProvider>
    <PhotoProvider value={upload}>
      <FacesProvider value={faces}>
    <ProofProvider value={loadProof}>
    <PinProvider key={key} hint={demo ? "The demo PIN is 1234." : undefined}>
      {business && !showOnboarding && (
        <header className="account-bar">
          <button type="button" className="grow sell-brand" onClick={() => setSwitching(navigation.current.id)} aria-label={"Switch business, now " + business.name}>
            <BusinessMark name={business.name} logo={business.settings.logo} brand={business.settings.brand} ink={business.settings.ink} size={36} />
            <span className="strong ellipsis">{business.name}</span>
            <ChevronDown size={16} className="chev-down" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="account-button"
            aria-label="Account and settings"
            aria-current={view === "settings" ? "page" : undefined}
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
        <div className="page-notices">
          {notice && <Notice onDismiss={() => setNotice("")}>{notice}</Notice>}
          {syncErr && !bootError && (
            <Notice
              tone="danger"
              action={
                <>
                  <button type="button" className="btn" onClick={() => void flush(true)}>
                    Retry
                  </button>
                  {!demo && (
                    <button type="button" className="btn" onClick={() => setAccount(true)}>
                      Sign in
                    </button>
                  )}
                </>
              }
            >
              {syncErr}
            </Notice>
          )}
        </div>
      )}
      {showOnboarding && state && userId ? (
        <Onboarding
          key={key + ":" + state.business?.id}
          userId={userId}
          live={state}
          online={online}
          onAction={owner}
          onSaved={setToast}
          onLater={() => { setDeferredOnboarding(userId); go("sell"); }}
          onFinish={async () => {
            await owner({ action: "completeOnboarding" });
            go("sell");
          }}
        />
      ) : content}
      {business && !showOnboarding && (
        <nav
          className="tabbar"
          aria-label="Main"
          style={{
            "--tab-count": navTabs.length,
            "--tab-offset": `${Math.max(0, activeTabIndex) * 100}%`,
          } as CSSProperties}
        >
          {activeTabIndex >= 0 && <span className="tab-selection" aria-hidden="true" />}
          {navTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={view === t.id ? "page" : undefined}
              onClick={() => go(t.id)}
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
        <div className="toast-viewport" ref={toastLayer}>
          {toast && <Toast text={toast} stamp={toastStamp} onDone={() => setToast("")} />}
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
        <Activity mode={switching === navigation.current.id ? "visible" : "hidden"}>
          <BusinessSwitcher
            state={state}
            demo={demo}
            online={online}
            onClose={() => setSwitching(null)}
            onAdd={() => navigation.open({ tab: "add-business" }, { from: navigation.current.id })}
            onSwitch={(id) => {
              setSwitching(null);
              void switchBusiness(id).catch((e) => setNotice(message(e)));
            }}
          />
        </Activity>
      )}
      {accountSheets}
      {account && !demo && (
        <Account
          onDismiss={() => setAccount(false)}
          signInOnly
          onSignedIn={async (id) => {
            setAccount(false);
            if (id === userId) await connect(key);
            else await openAccount(id);
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
