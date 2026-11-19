"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ReceiptText, Settings as SettingsIcon, ShoppingBag, Wallet, X } from "lucide-react";
import { SellScreen } from "./sell";
import { SalesScreen } from "./sales";
import { ShiftScreen } from "./shift";
import { SettingsScreen, type SettingsPage } from "./settings";
import { ScheduleScreen } from "./schedule";
import { Account, Setup } from "./account";
import { PinProvider, Toast } from "./ui";
import { api, authClient, RequestFailure } from "@/lib/client";
import {
  beginClose,
  cancelClose,
  checkout,
  clearRegister,
  loadRegister,
  mergeServer,
  saveCart,
  setAvailability,
  subscribeRegister,
} from "@/lib/register-store";
import { demoAction, demoBootstrap, DEMO, type Opening, type OwnerAction } from "@/lib/demo";
import { prepareOffline } from "@/lib/service-worker";
import type { CartLine, RegisterState, Tender } from "@/lib/types";

const tabs = [
  { id: "sell", name: "Sell", icon: ShoppingBag },
  { id: "sales", name: "Sales", icon: ReceiptText },
  { id: "shift", name: "Till", icon: Wallet },
  { id: "schedule", name: "Schedule", icon: CalendarDays },
  { id: "settings", name: "Settings", icon: SettingsIcon },
] as const;
type Tab = (typeof tabs)[number]["id"];
const ACTIVE = "portable-pos-account";
async function locked<T>(name: string, action: () => Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("portable-pos:" + name, action);
  throw Error(
    "Use a current browser with register locking support to operate this till.",
  );
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : "The register could not finish this action.";
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
    while (current.pending.length) {
      const events = [];
      let bytes = 0;
      for (const event of current.pending.slice(0, 25)) {
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
    [pending, setPending] = useState(false),
    [bootError, setBootError] = useState(""),
    [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null),
    [toast, setToast] = useState("");
  const active = useRef<string | null>(null),
    syncBusy = useRef(false);
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
      setTab("sell");
      localStorage.setItem(ACTIVE, id);
      try {
        let local = await loadRegister(id);
        if (id === DEMO && !local.business)
          local = await locked("write-" + id, async () => {
            const current = await loadRegister(id);
            return current.business
              ? current
              : mergeServer(id, demoBootstrap(current.deviceId));
          });
        if (local.business) show(id, local);
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void flush();
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
        const closingId = input.action === "close" ? s.shift?.id : undefined;
        if (closingId) show(key, await beginClose(key, closingId));
        try {
          const data =
            key === DEMO
              ? demoAction(s, input)
              : await api(key, {
                  ...input,
                  deviceId: s.deviceId,
                  ...(closingId ? { shiftId: closingId } : {}),
                });
          show(key, await mergeServer(key, data));
          setSyncErr("");
        } catch (error) {
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
    if (input.action === "setup") {
      setTab("settings");
      setSettingsPage("menu");
    }
  }
  async function cart(next: CartLine[]) {
    if (!state || !key) throw Error("Register unavailable.");
    await locked("write-" + key, async () =>
      show(key, await saveCart(key, next, state.cart)),
    );
  }
  async function sell(tender: Tender, received: number, discountId?: string) {
    if (!state || !key) throw Error("Register unavailable.");
    setPending(true);
    try {
      const result = await locked("write-" + key, () =>
        checkout(key, tender, received, state.cart, discountId),
      );
      show(key, result.state);
      void flush();
      return result.sale;
    } finally {
      setPending(false);
    }
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
    try {
      await locked("write-" + key, async () => {
        await syncRegister(key);
        const s = await loadRegister(key);
        if (s.shift?.deviceId === s.deviceId)
          throw Error("Close this till before signing out.");
        if (s.pending.length)
          throw Error("Sync this device before signing out.");
        const { error } = await authClient().auth.signOut({ scope: "local" });
        if (error) throw error;
        await clearRegister(key);
      });
      setSettingsPage(null);
      await connect(DEMO);
    } catch (e) {
      setNotice(message(e));
    }
  }
  const demo = key === DEMO;
  const business = state?.business;
  const status = state?.pending.length
    ? `${state.pending.length} waiting to sync`
    : syncErr
      ? "Sync paused"
      : online
        ? "Online"
        : "Offline";
  const me = state?.me;
  // Servers who don't run the till only need the schedule.
  const till = !me || me.owner || me.roles.includes("cashier");
  const shown = tabs.filter((t) => till || t.id === "schedule" || t.id === "settings");
  const view: Tab = till || tab === "settings" ? tab : "schedule";
  const sellable = Boolean(
    state?.shift &&
      !state.shift.closedAt &&
      !state.closingShiftId &&
      state.shift.deviceId === state.deviceId,
  );
  const go = (t: Tab) => {
    setTab(t);
    if (t === "settings") setSettingsPage(null);
    window.scrollTo(0, 0);
  };
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
          Try again
        </button>
        <button className="link" onClick={() => setAccount(true)}>
          Sign in
        </button>
      </div>
    );
  else if (!state) screen = <div className="loading" role="status">Opening register…</div>;
  else if (!business)
    screen = <Setup onSave={owner} onSignOut={() => void signOut()} />;
  else if (view === "schedule")
    screen = (
      <ScheduleScreen
        state={state}
        online={online}
        demo={demo}
        onAction={owner}
        onSaved={setToast}
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
        onSignOut={() => void signOut()}
      />
    );
  else if (tab === "sales")
    screen = (
      <SalesScreen state={state} online={online} onReverse={reverse} onSell={() => go("sell")} />
    );
  else if (tab === "shift" || !sellable) {
    const elsewhere = state.shift && !state.shift.closedAt && state.shift.deviceId !== state.deviceId;
    screen =
      tab === "sell" && elsewhere ? (
        <div className="page narrow">
          <h1 className="headline" style={{ paddingTop: 24 }}>
            Shift {state.shift!.number} is open <span className="g">on another phone. Keep selling there.</span>
          </h1>
        </div>
      ) : (
        <ShiftScreen
          state={state}
          online={online}
          onOpen={(opening: Opening) => owner({ action: "open", ...opening })}
          onSchedule={() => go("schedule")}
          onClose={(countedCash, pin) => owner({ action: "close", countedCash, pin })}
          onSell={() => go("sell")}
          onGoMenu={() => {
            setTab("settings");
            setSettingsPage("menu");
          }}
        />
      );
  } else
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
        />
      </div>
    );

  return (
    <PinProvider hint={demo ? "The demo PIN is 1234." : undefined}>
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
        <nav className="tabbar" aria-label="Main">
          {shown.map((t) => (
            <button
              key={t.id}
              aria-current={view === t.id ? "page" : undefined}
              onClick={() => go(t.id)}
            >
              <t.icon size={21} strokeWidth={view === t.id ? 2 : 1.7} />
              {t.name}
              {t.id === "settings" && (syncErr || !online) && <span className="tab-dot" />}
            </button>
          ))}
        </nav>
      )}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
      {account && (
        <Account
          onDismiss={() => setAccount(false)}
          requiredUser={key && key !== DEMO ? key : undefined}
          onSignedIn={async (id) => {
            setAccount(false);
            await connect(id);
          }}
        />
      )}
    </PinProvider>
  );
}
