"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CloudOff,
  Grid2X2,
  Layers2,
  LogIn,
  ReceiptText,
  Store,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { RegisterScreen } from "./register";
import { MenuScreen, SalesScreen, ShiftScreen } from "./operations";
import { Account, Overlay, Setup } from "./account";
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
import { demoAction, demoBootstrap, DEMO, type OwnerAction } from "@/lib/demo";
import { prepareOffline } from "@/lib/service-worker";
import type { CartLine, RegisterState, Tender } from "@/lib/types";

const tabs = [
  { id: "sell", name: "Register", icon: Grid2X2 },
  { id: "sales", name: "Sales", icon: ReceiptText },
  { id: "menu", name: "Menu", icon: Layers2 },
  { id: "shift", name: "Shift", icon: Clock3 },
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
function Mark() {
  return (
    <span className="wordmark">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      PORTABLE<span className="pos-tag">POS</span>
    </span>
  );
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
    [details, setDetails] = useState(false),
    [pending, setPending] = useState(false),
    [bootError, setBootError] = useState("");
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
    if (input.action === "setup") setTab("menu");
  }
  async function cart(next: CartLine[]) {
    if (!state || !key) throw Error("Register unavailable.");
    await locked("write-" + key, async () =>
      show(key, await saveCart(key, next, state.cart)),
    );
  }
  async function sell(tender: Tender, received: number) {
    if (!state || !key) throw Error("Register unavailable.");
    setPending(true);
    try {
      const result = await locked("write-" + key, () =>
        checkout(key, tender, received, state.cart),
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
      setDetails(false);
      await connect(DEMO);
    } catch (e) {
      setNotice(message(e));
    }
  }
  const demo = key === DEMO;
  const current = tabs.find((t) => t.id === tab)!;
  const business = state?.business;
  const storeName = business?.name || "Your business";
  const initials = storeName
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
  const date = state
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: business?.timeZone,
      }).format(new Date())
    : "";
  const status = state?.pending.length
    ? `${state.pending.length} pending`
    : syncErr
      ? "Sync paused"
      : online
        ? "Online"
        : "Offline";
  const props = state
    ? {
        state,
        online,
        onMenu: (menu: RegisterState["menu"], pin: string) =>
          owner({ action: "menu", menu, pin }),
        onOpen: (openingCash: number) => owner({ action: "open", openingCash }),
        onClose: (countedCash: number, pin: string) =>
          owner({ action: "close", countedCash, pin }),
        onReverse: (saleId: string, reason: string, pin: string) =>
          owner({ action: "reverse", saleId, reason, pin }),
        onAvailability: available,
        onSell: () => setTab("sell"),
        onGoMenu: () => setTab("menu"),
      }
    : null;
  const nav = tabs.map((t) => (
    <button
      key={t.id}
      aria-current={tab === t.id ? "page" : undefined}
      className={tab === t.id ? "selected" : ""}
      onClick={() => setTab(t.id)}
    >
      <t.icon size={19} strokeWidth={1.8} />
      <span>{t.name}</span>
    </button>
  ));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark />
        </div>
        <button className="business-switch" onClick={() => setDetails(true)}>
          <span className="store-icon">
            <Store size={20} />
          </span>
          <span>
            <strong>{storeName}</strong>
            <small>{demo ? "Demo workspace" : "Business workspace"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          {nav}
        </nav>
        <div className="side-bottom">
          {state?.shift && (
            <button className="shift-info" onClick={() => setTab("shift")}>
              <span className="status-dot" />
              <span>
                Shift {String(state.shift.number).padStart(2, "0")} open
              </span>
              <ChevronRight size={15} />
            </button>
          )}
          <button
            className="account-switch"
            onClick={() => (demo ? setAccount(true) : setDetails(true))}
          >
            <span className="avatar">
              {demo ? <LogIn size={18} /> : initials}
            </span>
            <span>
              <strong>{demo ? "Owner sign in" : "Owner account"}</strong>
              <small>{demo ? "Open your workspace" : storeName}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="toolbar">
          <div className="breadcrumbs">
            <Store size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{current.name}</strong>
          </div>
          <div className="mobile-brand">
            <Mark />
          </div>
          <div className="toolbar-end">
            <span className="date">
              <CalendarDays size={15} />
              {date}
            </span>
            <button className="connection" onClick={() => setDetails(true)}>
              <span
                className={
                  online && !syncErr ? "status-dot" : "status-dot paused"
                }
              />
              {status}
            </button>
            <button
              className="mobile-store icon-btn"
              aria-label="Workspace details"
              onClick={() => setDetails(true)}
            >
              {demo && <span>Demo</span>}
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <main className="content">
          {state?.closingShiftId && (
            <div className="inline-notice" role="status">
              Shift closing is awaiting confirmation. Reconnect and retry
              closing to reconcile the till.
            </div>
          )}
          {notice && (
            <div className="inline-notice" role="alert">
              {notice}
              <button
                aria-label="Dismiss message"
                className="icon-btn"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {syncErr && !bootError && (
            <div className="inline-notice" role="alert">
              {syncErr}
              <button className="text-button" onClick={() => setAccount(true)}>
                Sign in
              </button>
              <button className="text-button" onClick={() => void flush(true)}>
                Retry sync
              </button>
            </div>
          )}
          {bootError ? (
            <section className="setup-card">
              <h1>Register unavailable</h1>
              <p>{bootError}</p>
              <button
                className="black-button"
                onClick={() => key && void connect(key)}
              >
                Try again
              </button>
              <button className="text-button" onClick={() => setAccount(true)}>
                Owner sign in
              </button>
            </section>
          ) : !state || !props ? (
            <div className="loading" role="status">
              Opening register…
            </div>
          ) : !business ? (
            <Setup onSave={owner} onSignOut={() => void signOut()} />
          ) : tab === "menu" ? (
            <MenuScreen {...props} />
          ) : tab === "sales" ? (
            <SalesScreen {...props} />
          ) : tab === "shift" || !state.shift || state.closingShiftId ? (
            <ShiftScreen {...props} />
          ) : state.deviceId !== state.shift.deviceId ? (
            <section className="setup-card">
              <h1>Till in use</h1>
              <p>
                This shift is open on another device. Continue taking sales on
                that till.
              </p>
            </section>
          ) : (
            <RegisterScreen
              state={state}
              onCart={cart}
              onCheckout={sell}
              onAvailability={available}
              pending={pending}
            />
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav}
      </nav>
      {details && (
        <Overlay title={storeName} onDismiss={() => setDetails(false)}>
          <p className="dialog-intro">
            {demo
              ? "Demo workspace · Sales are saved on this device."
              : "Business workspace"}
          </p>
          <div className="workspace-facts">
            <div>
              <span>Connection</span>
              <strong>
                {online ? <Wifi size={16} /> : <WifiOff size={16} />} {status}
              </strong>
            </div>
            <div>
              <span>Offline register</span>
              <strong>
                {ready ? <Check size={16} /> : <CloudOff size={16} />}{" "}
                {ready ? "Ready" : "Preparing"}
              </strong>
            </div>
            {business && (
              <div>
                <span>Currency</span>
                <strong>{business.currency}</strong>
              </div>
            )}
            {state?.pending.length ? (
              <div>
                <span>Saved on this device</span>
                <strong>{state.pending.length} pending</strong>
              </div>
            ) : null}
            {demo && (
              <div>
                <span>Demo owner PIN</span>
                <strong>1234</strong>
              </div>
            )}
          </div>
          {demo ? (
            <button
              className="black-button"
              onClick={() => {
                setDetails(false);
                setAccount(true);
              }}
            >
              Sign in to your business
              <ArrowRight size={16} />
            </button>
          ) : (
            <button className="text-button" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </Overlay>
      )}
      {account && (
        <Account
          onDismiss={() => setAccount(false)}
          requiredUser={key && key !== DEMO ? key : undefined}
          onSignedIn={async (id) => {
            setAccount(false);
            setDetails(false);
            await connect(id);
          }}
        />
      )}
    </div>
  );
}
