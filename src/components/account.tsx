"use client";
import { Check, ChevronRight, Eye, EyeOff, UserRound, UserRoundPlus } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { APP_NAME, appIcons } from "@/lib/app-brand";
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { accountsEnabled, authClient, rememberAccount, savedAccounts, type SavedAccount } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";
import { onColor } from "@/lib/theme";
import type { LinkPreview } from "@/lib/types";
import { BusinessMark } from "./businesses";
import { LiquidSegments } from "./liquid-segments";
import { Popo } from "./popo";
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
      <Image src={appIcons.small} alt="" width={28} height={28} loading="eager" unoptimized />
      <span>{APP_NAME}</span>
    </div>
  );
}

function AccountPage({ children, brand, credit }: {
  children: ReactNode;
  brand?: string;
  credit?: boolean;
}) {
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
  | { entry: AccountEntry; onDemo: () => void; notice?: string; onChooseAccount?: () => void }
  | { signInOnly?: boolean; initialEmail?: string; onDismiss: () => void }
);

const MODES = [
  { value: "signin", label: "Sign in" },
  { value: "create", label: "Create account" },
] as const;
const EMAIL_CODE_LENGTH = 6;

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
  const [email, setEmail] = useState(page ? "" : props.initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const [request, setRequest] = useState<"credentials" | "verify" | "resend" | null>(null);
  const [slot] = useState(() => crypto.randomUUID());
  const passwordId = useId();
  const codeInput = useRef<HTMLInputElement>(null);
  const busy = request !== null;
  const signInOnly = !page && props.signInOnly;
  const emailOptions = { emailRedirectTo: entry?.returnTo };

  useEffect(() => {
    if (sentTo) codeInput.current?.focus();
  }, [sentTo]);

  function switchMode(next: Mode) {
    setMode(next);
    setShowPassword(false);
    setPassword("");
    setSentTo("");
    setCode("");
    setError("");
    setResendNotice("");
  }

  function openVerification(address: string) {
    setPassword("");
    setShowPassword(false);
    setSentTo(address);
  }

  async function finishSignIn(session: Session | null) {
    if (!session || session.user.is_anonymous) throw Error("Couldn't sign in. Try again.");
    const { id, email } = session.user;
    const previous = savedAccounts().find((account) => account.id === id);
    rememberAccount({ id, email, slot });
    if (previous && previous.slot !== slot)
      void authClient(previous.slot).auth.signOut({ scope: "local" }).catch(() => {});
    await props.onSignedIn(id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setRequest("credentials");
    setError("");
    const address = email.trim();
    try {
      // Use a separate session for both signup and sign-in so the current register can still sync.
      const auth = authClient(slot).auth;
      const { data, error } = create
        ? await auth.signUp({ email: address, password, options: emailOptions })
        : await auth.signInWithPassword({ email: address, password });
      if (!create && error?.code === "email_not_confirmed") {
        openVerification(address);
        return;
      }
      if (error) throw error;
      if (create && !data.session) {
        openVerification(address);
        return;
      }
      await finishSignIn(data.session);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRequest(null);
    }
  }

  function updateCode(value: string) {
    if (busy) return;
    const next = value.replace(/\D/g, "").slice(0, EMAIL_CODE_LENGTH);
    setCode(next);
    setError("");
    if (next.length === EMAIL_CODE_LENGTH) void verifyEmail(next);
  }

  async function verifyEmail(token: string) {
    setRequest("verify");
    setError("");
    setResendNotice("");
    try {
      const { data, error } = await authClient(slot).auth.verifyOtp({ email: sentTo, token, type: "email" });
      if (error?.code === "otp_expired") {
        throw Error("That code is incorrect or expired. Try again or request a new code.");
      }
      if (error) throw error;
      await finishSignIn(data.session);
    } catch (e) {
      setCode("");
      setError(errorText(e));
    } finally {
      setRequest(null);
    }
  }

  async function resendCode() {
    setRequest("resend");
    setError("");
    setResendNotice("");
    try {
      const { error } = await authClient(slot).auth.resend({ email: sentTo, type: "signup", options: emailOptions });
      if (error) throw error;
      setCode("");
      setResendNotice("New code sent. Use the most recent email.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRequest(null);
    }
  }

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
            <label htmlFor={passwordId}>Password</label>
            {create && (
              <Explain title="Password">
                <p>Use at least 8 characters. You’ll use this email and password on every phone you sell from.</p>
              </Explain>
            )}
          </span>
          <div className={styles.password}>
            <input
              id={passwordId}
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

  const modes = accountsEnabled && !signInOnly && (
    <div className={styles.modes}>
      <LiquidSegments label="Account" options={MODES} value={mode} disabled={busy} onChange={switchMode} />
    </div>
  );

  const verification = (
    <>
      <p className={styles.lede}>Enter the six-digit code sent to <strong>{sentTo}</strong>.</p>
      <div className={`${styles.form} stack gap-14`}>
        <label className={styles.field}>
          <span>Verification code</span>
          <input
            ref={codeInput}
            className={`input ${styles.code}`}
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            onChange={(e) => updateCode(e.target.value)}
            readOnly={busy}
          />
        </label>
        {error && <p role="alert" className="alert">{error}</p>}
      </div>
      {request === "verify" && <p role="status" className={styles.lede}>Verifying email…</p>}
      {resendNotice && <p role="status" className={styles.lede}>{resendNotice}</p>}
      <div className={styles.codeActions}>
        <button type="button" className={styles.plain} disabled={busy} onClick={resendCode}>
          {request === "resend" ? "Sending…" : "Resend code"}
        </button>
        <button type="button" className={styles.plain} disabled={busy} onClick={() => switchMode(mode)}>
          Use a different email
        </button>
      </div>
    </>
  );

  if (!page) return (
    <Sheet title={sentTo ? "Check your email" : signInOnly ? "Sign in" : "Add account"} onClose={props.onDismiss} busy={busy}>
      <div className="stack gap-14">
        {sentTo ? verification : <>
          {modes}
          {fields}
        </>}
      </div>
    </Sheet>
  );

  if (kind === "register") {
    return (
      <main className={styles.entry}>
        <section className={styles.entryShell} aria-labelledby="entry-title">
          <AppMark />
          <div className={styles.entryIntro}>
            <h1 id="entry-title" className={styles.title}>
              {sentTo ? "Check your email" : create ? "Create your account" : "Sign in to your Pop-up"}
            </h1>
            <div aria-hidden="true" className={styles.entryPopo}>
              <Popo pose="welcome" motion="greet" size={118} />
            </div>
          </div>
          {sentTo ? <div className={styles.entryVerification}>{verification}</div> : (
            <>
              {!accountsEnabled && <p className={styles.lede}>Live accounts are unavailable on this server.</p>}
              {props.notice && <p role="alert" className="alert">{props.notice}</p>}
              {fields}
              {accountsEnabled && (
                <button type="button" className={styles.modeLink} disabled={busy}
                  onClick={() => switchMode(create ? "signin" : "create")}>
                  {create ? "Back to sign in" : "Create account"}
                </button>
              )}
              {props.onChooseAccount && (
                <button type="button" className={styles.modeLink} disabled={busy} onClick={props.onChooseAccount}>
                  Switch account
                </button>
              )}
              <button type="button" className={styles.demo} disabled={busy} onClick={props.onDemo}>
                <span>
                  <strong>Try the demo</strong>
                  <span>Sample register · PIN 1234</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  const plainTitle =
    kind === "invite" ? "Join the team"
      : kind === "shift" ? "Open the shift"
      : "Open your team’s shifts";
  const formTitle =
    kind === "invite" ? (preview.state === "gone" ? "Sign in" : create ? "Create your account to join" : "Sign in to join")
      : kind === "shift" ? "Sign in to take a seat"
      : "Sign in to see open shifts";

  const form = (
    <section className={styles.card} aria-labelledby={preview.state !== "none" ? "form-title" : "account-title"}>
      {preview.state !== "none" ? (
        <h2 id="form-title" className={styles.formTitle}>{formTitle}</h2>
      ) : (
        <h1 id="account-title" className={styles.title}>{plainTitle}</h1>
      )}
      {modes}
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
      {sentTo ? (
        <section className={styles.card} aria-labelledby="sent-title">
          {data || preview.state === "gone"
            ? <h2 id="sent-title" className={styles.title}>Check your email</h2>
            : <h1 id="sent-title" className={styles.title}>Check your email</h1>}
          {verification}
        </section>
      ) : form}
      {props.onChooseAccount && !sentTo && (
        <button type="button" className={styles.plain} onClick={props.onChooseAccount}>Switch account</button>
      )}
    </AccountPage>
  );
}

export function AccountSwitcher({
  accounts,
  current,
  online,
  onSelect,
  onAdd,
  onClose,
}: {
  accounts: SavedAccount[];
  current?: string;
  online: boolean;
  onSelect: (account: SavedAccount) => Promise<void>;
  onAdd: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Switch account" onClose={onClose} busy={busy}
      footer={<button type="button" className="btn block" onClick={onAdd} disabled={busy || !online}>
        <UserRoundPlus size={18} aria-hidden="true" /> Add account
      </button>}>
      <div className="card card-list">
        {accounts.map((account) => (
          <button key={account.id} type="button" className="list-row" disabled={busy || account.id === current}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSelect(account);
              } catch (error) {
                setError(errorText(error));
              } finally {
                setBusy(false);
              }
            }}>
            <span className="well"><UserRound size={18} aria-hidden="true" /></span>
            <span className="grow stack" style={{ minWidth: 0 }}>
              <span className="strong ellipsis">{account.name || account.email || "Account"}</span>
              <span className="label ellipsis">{[account.name ? account.email : undefined, account.business].filter(Boolean).join(" · ")}</span>
            </span>
            {account.id === current ? <Check size={18} aria-label="Current account" /> : <ChevronRight size={18} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {!online && <p className="label">Connect to sign in or add an account.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
    </Sheet>
  );
}

export function Setup({
  onSave,
  onSignOut,
  adding = false,
  onboarding = false,
}: {
  onSave: (a: OwnerAction) => Promise<void>;
  onSignOut: () => void;
  /** Adding another business, rather than the first one. */
  adding?: boolean;
  onboarding?: boolean;
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
        {adding ? "Add a business." : onboarding ? "Create your business" : "Set up your stall."}
        {!onboarding && <span className="g"> {adding ? "It gets its own menu, team and till." : "It takes a minute."}</span>}
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
          {busy ? "Creating…" : adding ? "Add" : onboarding ? "Create business" : "Create register"}
        </button>
      </form>
      <button className="link" onClick={onSignOut}>
        {adding ? "Cancel" : "Sign out"}
      </button>
    </div>
  );
}
