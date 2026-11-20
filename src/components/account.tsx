"use client";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { accountsEnabled, authClient } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";
import { onColor } from "@/lib/theme";
import type { LinkPreview } from "@/lib/types";
import { BusinessMark } from "./businesses";
import { LiquidSegments } from "./liquid-segments";
import { CurrencyOptions } from "./settings";
import { errorText, Explain, Sheet } from "./ui";
import styles from "./account.module.css";

export type AccountEntry = {
  kind: "register" | "invite" | "business" | "shift";
  returnTo?: string;
  /** The /i/ or /j/ code, for a preview of what the link opens. */
  code?: string;
};

type Mode = "signin" | "create";
type Preview = { state: "loading" } | { state: "none" } | { state: "gone" } | { state: "ready"; data: LinkPreview };

/** Ask the server what a link opens. Offline or slow, the page falls back to plain copy. */
function usePreview(entry?: AccountEntry): Preview {
  const path = entry?.code && (entry.kind === "invite" ? "invite" : entry.kind === "shift" ? "shift" : null);
  const [preview, setPreview] = useState<Preview>(path ? { state: "loading" } : { state: "none" });
  useEffect(() => {
    if (!path || !entry?.code) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    fetch(`/api/links/${path}/${encodeURIComponent(entry.code)}`, { signal: abort.signal, cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) return setPreview({ state: path === "invite" ? "gone" : "none" });
        if (!res.ok) throw Error(String(res.status));
        setPreview({ state: "ready", data: (await res.json()) as LinkPreview });
      })
      .catch(() => setPreview({ state: "none" }))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [path, entry?.code]);
  return preview;
}

/** The business's color on its own invite, so the link already looks like their till. */
function brandStyle(brand?: string): CSSProperties | undefined {
  if (!brand) return undefined;
  const on = onColor(brand);
  return {
    "--accent": brand,
    "--accent-ring": brand,
    "--on-accent": on,
  } as CSSProperties;
}

function AppMark() {
  return (
    <div className={styles.app}>
      <Image src="/icon-192.png" alt="" width={28} height={28} loading="eager" unoptimized />
      <span>Portable POS</span>
    </div>
  );
}

function AccountPage({ children, brand, credit }: { children: ReactNode; brand?: string; credit?: boolean }) {
  return (
    <main className={styles.page} style={brandStyle(brand)}>
      <div className={styles.column}>
        {children}
        {credit && <div className={styles.credit}><AppMark /></div>}
      </div>
    </main>
  );
}

function formatShift(shift: NonNullable<LinkPreview["shift"]>) {
  const zone = { timeZone: shift.timeZone };
  const start = new Date(shift.startsAt);
  const end = new Date(shift.endsAt);
  const day = new Intl.DateTimeFormat(undefined, { ...zone, weekday: "long" }).format(start);
  const date = new Intl.DateTimeFormat(undefined, { ...zone, month: "long", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { ...zone, hour: "numeric", minute: "2-digit" });
  return { day, date, hours: `${time.format(start)} – ${time.format(end)}` };
}

/** The invitation itself: whose business, from whom, and for whom. */
function InviteCard({ data }: { data: LinkPreview }) {
  const { business, invite } = data;
  return (
    <section className={styles.ticket} aria-labelledby="account-title">
      <BusinessMark name={business.name} logo={business.logo} brand={business.brand} size={56} />
      <h1 id="account-title" className={styles.business}>{business.name}</h1>
      {invite && (
        <p className={styles.sentence}>
          {invite.invitedBy ? <strong>{invite.invitedBy}</strong> : "The owner"} invited you to join
          as <strong>{invite.name}</strong>{invite.owner ? ", with owner access" : ""}.
        </p>
      )}
    </section>
  );
}

/** A shared shift: the day is the answer, then the hours and the place. */
function ShiftCard({ data }: { data: LinkPreview }) {
  const { business, shift } = data;
  if (!shift) return null;
  const { day, date, hours } = formatShift(shift);
  const open = shift.seats - shift.taken;
  return (
    <section className={styles.ticket} aria-labelledby="account-title">
      <div className={styles.from}>
        <BusinessMark name={business.name} logo={business.logo} brand={business.brand} size={32} />
        <span>{business.name}</span>
      </div>
      <h1 id="account-title" className={styles.day}>
        <span>{day}</span>
        {date}
      </h1>
      <p className={styles.hours}>{hours}</p>
      {(shift.place || shift.event) && (
        <div className={styles.where}>
          {shift.place && <p>{shift.place}</p>}
          {shift.event && <p className={styles.quiet}>{shift.event}</p>}
        </div>
      )}
      <p className={styles.seats}>
        {open > 0 ? `${open} of ${shift.seats} ${shift.seats === 1 ? "seat" : "seats"} open` : "Every seat is taken"}
      </p>
    </section>
  );
}

function Placeholder() {
  return (
    <section className={`${styles.ticket} ${styles.waiting}`} aria-busy="true" aria-label="Loading invitation">
      <span className={styles.block} style={{ width: 56, height: 56 }} />
      <span className={styles.block} style={{ width: "62%", height: 30 }} />
      <span className={styles.block} style={{ width: "88%", height: 18 }} />
    </section>
  );
}

export function AccountLinkError({ title, detail, onContinue, onSwitch }: {
  title: string;
  detail: string;
  onContinue: () => void;
  onSwitch?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AccountPage>
      <AppMark />
      <section className={styles.card} aria-labelledby="account-title">
        <div className={styles.head}>
          <h1 id="account-title" className={styles.title}>{title}</h1>
          <p className={styles.lede}>{detail}</p>
        </div>
        <div className={styles.actions}>
          {onSwitch && (
            <button className="btn block" disabled={busy} onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSwitch();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}>
              {busy ? "Signing out…" : "Use another account"}
            </button>
          )}
          <button className={onSwitch ? styles.plain : "btn block"} onClick={onContinue} disabled={busy}>
            Go to my register
          </button>
          {error && <p role="alert" className="alert">{error}</p>}
        </div>
      </section>
    </AccountPage>
  );
}

type AccountProps = {
  onSignedIn: (id: string) => Promise<void>;
} & (
  | { entry: AccountEntry; onDemo: () => void; notice?: string }
  | { requiredUser: string; onDismiss: () => void }
);

const MODES = [
  { value: "signin", label: "Sign in" },
  { value: "create", label: "Create account" },
] as const;

export function Account(props: AccountProps) {
  const page = "entry" in props;
  const entry = page ? props.entry : undefined;
  const kind = entry?.kind ?? "register";
  const preview = usePreview(entry);
  const data = preview.state === "ready" ? preview.data : undefined;
  // Most people who open an invite are new; everyone else already has an account.
  const [mode, setMode] = useState<Mode>(kind === "invite" ? "create" : "signin");
  const create = mode === "create";
  useEffect(() => {
    if (preview.state === "gone") setMode("signin");
  }, [preview.state]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setShowPassword(false);
    setPassword("");
    setSentTo("");
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const auth = authClient().auth;
      const { data, error } = create
        ? await auth.signUp({
            email,
            password,
            options: { emailRedirectTo: entry?.returnTo ?? location.origin },
          })
        : await auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session && !data.session.user.is_anonymous) {
        if (!page && props.requiredUser !== data.session.user.id)
          throw Error("Sign in with the owner account for this register.");
        await props.onSignedIn(data.session.user.id);
      } else {
        setPassword("");
        setShowPassword(false);
        setSentTo(email);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const business = data?.business.name;
  const submitLabel = busy
    ? create ? "Creating account…" : "Signing in…"
    : create ? "Create account"
      : kind === "invite" && preview.state !== "gone" ? "Sign in and join"
      : "Sign in";

  const fields = (
    <form onSubmit={submit} className={styles.form}>
      <fieldset disabled={busy || !accountsEnabled}>
        <label className={styles.field}>
          <span>Email</span>
          <input
            className="input"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <div className={styles.field}>
          <span className={styles.label}>
            <label htmlFor="account-password">Password</label>
            {create && (
              <Explain title="Password">
                <p>Use at least 8 characters. You’ll use this email and password on every phone you sell from.</p>
              </Explain>
            )}
          </span>
          <div className={styles.password}>
            <input
              id="account-password"
              className="input"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={create ? "new-password" : "current-password"}
              minLength={create ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className={styles.visibility} onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="alert">{error}</p>}
        <button type="submit" className="btn block">{submitLabel}</button>
      </fieldset>
    </form>
  );

  // Signing in again from inside the register.
  if (!page) return (
    <Sheet title="Sign in" onClose={props.onDismiss} busy={busy}>
      <div className="stack gap-14">
        <p className="muted">Sign in again to reconnect this register.</p>
        {fields}
      </div>
    </Sheet>
  );

  const linked = kind !== "register";
  const plainTitle =
    kind === "invite" ? "Join the team"
      : kind === "shift" ? "Open the shift"
      : kind === "business" ? "Open your team’s shifts"
      : "Sign in";
  const formTitle =
    kind === "invite" ? (preview.state === "gone" ? "Sign in" : create ? "Create your account to join" : "Sign in to join")
      : kind === "shift" ? "Sign in to take a seat"
      : kind === "business" ? "Sign in to see open shifts"
      : create ? "Create your account" : "Sign in to your register";

  const sent = (
    <section className={styles.card} aria-labelledby="sent-title">
      <div className={styles.head}>
        <h2 id="sent-title" className={styles.title}>Check your email</h2>
        <p className={styles.lede} role="status">
          We sent a link to <strong>{sentTo}</strong>. Open it on this phone
          {business ? <> to {kind === "invite" ? "join" : "open"} {business}</> : linked ? " to continue" : " to finish"}.
        </p>
      </div>
      <button type="button" className={styles.plain} onClick={() => switchMode("create")}>Use a different email</button>
    </section>
  );

  const form = (
    <section className={styles.card} aria-labelledby={linked && preview.state !== "none" ? "form-title" : "account-title"}>
      {linked && preview.state !== "none" ? (
        <h2 id="form-title" className={styles.formTitle}>{formTitle}</h2>
      ) : (
        <h1 id="account-title" className={styles.title}>{linked ? plainTitle : formTitle}</h1>
      )}
      {accountsEnabled && (
        <div className={styles.modes}>
          <LiquidSegments label="Account" options={MODES} value={mode} disabled={busy} onChange={switchMode} />
        </div>
      )}
      {!accountsEnabled && <p className={styles.lede}>Live accounts are unavailable on this server.</p>}
      {props.notice && <p role="alert" className="alert">{props.notice}</p>}
      {fields}
    </section>
  );

  return (
    <AccountPage brand={data?.business.brand} credit={Boolean(data)}>
      {!data && <AppMark />}
      {preview.state === "loading" && <Placeholder />}
      {data && (kind === "invite" ? <InviteCard data={data} /> : <ShiftCard data={data} />)}
      {preview.state === "gone" && (
        <section className={styles.card} aria-labelledby="account-title">
          <div className={styles.head}>
            <h1 id="account-title" className={styles.title}>This invite was used</h1>
            <p className={styles.lede}>If you joined with it, sign in. If not, ask the owner for a new link.</p>
          </div>
        </section>
      )}
      {sentTo ? sent : form}
      {kind === "register" && !sentTo && (
        <button type="button" className={styles.demo} disabled={busy} onClick={props.onDemo}>
          <span>
            <strong>Try the demo</strong>
            <span>A sample coffee counter. The PIN is 1234.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      )}
    </AccountPage>
  );
}

export function Setup({
  onSave,
  onSignOut,
  adding = false,
}: {
  onSave: (a: OwnerAction) => Promise<void>;
  onSignOut: () => void;
  /** Adding another business, rather than the first one. */
  adding?: boolean;
}) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("PHP");
  const [timeZone, setTimeZone] = useState(zone);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <h1 className="headline" style={{ paddingTop: 24 }}>
        {adding ? "Add a business." : "Set up your stall."} <span className="g">{adding ? "It gets its own menu, team and till." : "It takes a minute."}</span>
      </h1>
      <form
        className="card card-pad stack gap-14"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await onSave({ action: "setup", name: name.trim(), pin, currency, timeZone });
          } catch (e) {
            setErr(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Business name</span>
          <input
            className="input"
            required
            maxLength={80}
            placeholder="e.g. Kape sa Kanto"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Currency</span>
          <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <CurrencyOptions />
          </select>
        </label>
        <label className="field">
          <span>Time zone</span>
          <select className="select" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {Array.from(new Set([zone, ...Intl.supportedValuesOf("timeZone")])).map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-head">
            Owner PIN, 4 to 8 digits
            <Explain title="Owner PIN">
              <p>The PIN guards prices, settings, reversals and closing the drawer.</p>
              <p>Staff can sell without it.</p>
            </Explain>
          </span>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            minLength={4}
            maxLength={8}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        {err && (
          <p role="alert" className="alert">
            {err}
          </p>
        )}
        <button className="btn block" disabled={busy}>
          {busy ? "Creating…" : adding ? "Add" : "Create register"}
        </button>
      </form>
      <button className="link" onClick={onSignOut}>
        {adding ? "Cancel" : "Sign out"}
      </button>
    </div>
  );
}
