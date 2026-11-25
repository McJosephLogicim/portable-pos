"use client";

import { Check, ChevronRight, Eye, EyeOff, Mail, UserRound, UserRoundPlus } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import { APP_NAME, appIcons, emptyStateObjects, popoPoses } from "@/lib/app-brand";
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { loginDeadline } from "@/lib/login-session";
import { accountsEnabled, authClient, rememberAccount, savedAccounts, type SavedAccount } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";
import { blocked, OFFLINE } from "@/lib/reject";
import { onColor } from "@/lib/theme";
import type { LinkPreview } from "@/lib/types";
import { BusinessMark } from "./businesses";
import { LiquidSegments } from "./liquid-segments";
import { Popo } from "./popo";
import { CurrencyOptions } from "./settings";
import { DoneCheck, errorText, Explain, GlossyObject, Sheet } from "./ui";
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
    <section className={`${styles.ticket} ${styles.inviteTicket}`} aria-labelledby="account-title">
      <div className={styles.inviteMarks}>
        <BusinessMark name={business.name} logo={business.logo} brand={business.brand} size={56} />
        <Popo pose="welcome" size={76} className={styles.inviteMascot} />
      </div>
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
          {shift.place && <p className="ellipsis" title={shift.place}>{shift.place}</p>}
          {shift.event && <p className={`${styles.quiet} ellipsis`} title={shift.event}>{shift.event}</p>}
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
const VERIFIED_FEEDBACK_MS = 240;

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
  const [codeCaret, setCodeCaret] = useState(0);
  const [codeRejected, setCodeRejected] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [resendNotice, setResendNotice] = useState("");
  const [request, setRequest] = useState<"credentials" | "verify" | "resend" | null>(null);
  const [slot] = useState(() => crypto.randomUUID());
  const passwordId = useId();
  const codeErrorId = useId();
  const codeInput = useRef<HTMLInputElement>(null);
  const verifyingCode = useRef(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const busy = request !== null;
  const checking = request === "verify";
  const verificationTitle = emailVerified ? "Email verified" : "Check your email";
  const signInOnly = !page && props.signInOnly;
  const emailOptions = { emailRedirectTo: entry?.returnTo };

  useEffect(() => {
    if (sentTo && !emailVerified) codeInput.current?.focus();
  }, [sentTo, emailVerified]);

  function switchMode(next: Mode) {
    setMode(next);
    setShowPassword(false);
    setPassword("");
    setSentTo("");
    setCode("");
    setCodeCaret(0);
    setCodeRejected(false);
    setEmailVerified(false);
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
    rememberAccount({ id, email, slot, loginExpiresAt: loginDeadline(session.access_token) });
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

  function updateCode(value: string, input: HTMLInputElement, offset = input.selectionStart ?? value.length) {
    if (busy) return;
    const next = value.replace(/\D/g, "").slice(0, EMAIL_CODE_LENGTH);
    const caret = Math.min(value.slice(0, offset).replace(/\D/g, "").length, next.length);
    setCode(next);
    input.value = next;
    input.setSelectionRange(caret, caret);
    setCodeCaret(Math.min(caret, EMAIL_CODE_LENGTH - 1));
    setCodeRejected(false);
    setError("");
    setResendNotice("");
    if (next.length === EMAIL_CODE_LENGTH) void verifyEmail(next);
  }

  async function verifyEmail(token: string) {
    if (verifyingCode.current) return;
    verifyingCode.current = true;
    setRequest("verify");
    setError("");
    setResendNotice("");
    try {
      const { data, error } = await authClient(slot).auth.verifyOtp({ email: sentTo, token, type: "email" });
      if (error?.code === "otp_expired") {
        throw Error("That code is incorrect or expired. Try again or request a new code.");
      }
      if (error) throw error;
      if (!data.session || data.session.user.is_anonymous) throw Error("Couldn't sign in. Try again.");
      setEmailVerified(true);
      if (window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
        await new Promise((resolve) => window.setTimeout(resolve, VERIFIED_FEEDBACK_MS));
      }
      await finishSignIn(data.session);
    } catch (e) {
      setEmailVerified(false);
      setCode("");
      setCodeCaret(0);
      setCodeRejected(true);
      setError(errorText(e));
    } finally {
      verifyingCode.current = false;
      setRequest(null);
    }
  }

  async function resendCode() {
    setRequest("resend");
    setError("");
    setCodeRejected(false);
    setResendNotice("");
    try {
      const { error } = await authClient(slot).auth.resend({ email: sentTo, type: "signup", options: emailOptions });
      if (error) throw error;
      setCode("");
      setCodeCaret(0);
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

  const verificationMark = (
    <span className={styles.verificationMark} aria-hidden="true">
      {emailVerified ? <DoneCheck /> : <Mail size={24} />}
    </span>
  );
  const verification = emailVerified ? (
    <div className={styles.verification} role="status">
      <p className={styles.lede}>Email confirmed. Signing you in…</p>
    </div>
  ) : (
    <div className={styles.verification}>
      <p className={styles.lede}>Enter the six-digit code sent to <strong>{sentTo}</strong></p>
      <div>
        <label className={styles.field}>
          <span>Verification code</span>
          <span className={styles.codeField} dir="ltr" data-checking={checking} data-invalid={codeRejected}>
            <span className={styles.codeCells} aria-hidden="true">
              {Array.from({ length: EMAIL_CODE_LENGTH }, (_, index) => (
                <Fragment key={index}>
                  {index === EMAIL_CODE_LENGTH / 2 && <span className={styles.codeDivider} />}
                  <span className={styles.codeCell} data-filled={!!code[index]} data-active={index === codeCaret}>
                    {code[index]}
                  </span>
                </Fragment>
              ))}
            </span>
            <input
              ref={codeInput}
              className={styles.codeInput}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              spellCheck={false}
              aria-invalid={codeRejected || undefined}
              aria-describedby={codeRejected ? codeErrorId : undefined}
              value={code}
              onChange={(event) => updateCode(event.currentTarget.value, event.currentTarget)}
              onSelect={(event) => setCodeCaret(Math.min(event.currentTarget.selectionStart ?? code.length, EMAIL_CODE_LENGTH - 1))}
              onClick={(event) => {
                if (busy || event.detail === 0) return;
                const input = event.currentTarget;
                const cells = input.parentElement!.querySelectorAll(`.${styles.codeCell}`);
                const clicked = Array.from(cells).findIndex((cell) => event.clientX < cell.getBoundingClientRect().right);
                const index = Math.min(clicked < 0 ? EMAIL_CODE_LENGTH - 1 : clicked, code.length);
                input.setSelectionRange(index, Math.min(index + 1, code.length));
                setCodeCaret(Math.min(index, EMAIL_CODE_LENGTH - 1));
              }}
              onPaste={(event) => {
                if (busy) return;
                const value = event.clipboardData.getData("text");
                if (value.replace(/\D/g, "").length < EMAIL_CODE_LENGTH) return;
                event.preventDefault();
                updateCode(value, event.currentTarget, value.length);
              }}
              readOnly={busy}
            />
          </span>
        </label>
        {error && <p id={codeErrorId} role="alert" className={styles.codeError}>{error}</p>}
      </div>
      <p role="status" className={styles.codeStatus}>{checking ? "Checking code…" : resendNotice}</p>
      <div className={styles.codeActions}>
        <button type="button" className={styles.plain} disabled={busy} onClick={resendCode}>
          {request === "resend" ? "Sending…" : "Resend code"}
        </button>
        <button type="button" className={styles.plain} disabled={busy} onClick={() => switchMode(mode)}>
          Use a different email
        </button>
      </div>
    </div>
  );

  if (!page) return (
    <Sheet title={sentTo ? verificationTitle : signInOnly ? "Sign in" : "Add account"} onClose={props.onDismiss} busy={busy}>
      <div className="stack gap-14">
        {sentTo ? <>{verificationMark}{verification}</> : <>
          {modes}
          {fields}
        </>}
      </div>
    </Sheet>
  );

  if (kind === "register") {
    function closeEmail() {
      setEmailOpen(false);
      switchMode("signin");
    }

    return (
      <main className={styles.entry}>
        <div className={styles.entryStage} aria-hidden="true">
          <div className={styles.marketScene}>
            <Image className={styles.marketStall} src={emptyStateObjects.marketStall} alt="" width={280} height={280} priority unoptimized />
            <Image className={styles.marketMascot} src={popoPoses.welcome} alt="" width={160} height={160} priority unoptimized />
          </div>
        </div>
        <section className={styles.entryShell} aria-labelledby="entry-title">
          <h1 id="entry-title" className={styles.entryBrand} aria-label={`${APP_NAME} sign in`}>
            {APP_NAME}
          </h1>
          {props.notice && <p role="alert" className="alert">{props.notice}</p>}
          {!accountsEnabled && <p className={styles.entryNote}>Live accounts are unavailable on this server.</p>}
          <div className={styles.entryActions}>
            <button type="button" className={styles.entryPrimary} disabled={!accountsEnabled} onClick={() => setEmailOpen(true)}>
              <Mail size={18} aria-hidden="true" /> Continue with email
            </button>
            <button type="button" className={styles.entrySecondary} onClick={props.onDemo} aria-describedby="demo-hint">
              Try the demo
            </button>
          </div>
          <p className={styles.entryNote} id="demo-hint">Sample register · PIN 1234</p>
          <div className={styles.entryLinks}>
            {accountsEnabled && (
              <button type="button" onClick={() => { switchMode("create"); setEmailOpen(true); }}>
                Create account
              </button>
            )}
            {props.onChooseAccount && <button type="button" onClick={props.onChooseAccount}>Switch account</button>}
          </div>
        </section>
        {emailOpen && (
          <Sheet title={sentTo ? verificationTitle : create ? "Create your account" : "Sign in with email"}
            onClose={closeEmail} busy={busy}>
            <div className="stack gap-14">
              {sentTo ? <>{verificationMark}{verification}</> : <>
                {fields}
                <button type="button" className={styles.plain} disabled={busy}
                  onClick={create ? closeEmail : () => switchMode("create")}>
                  {create ? "Back to sign in" : "Create account"}
                </button>
              </>}
            </div>
          </Sheet>
        )}
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
        <section className={`${styles.card} ${styles.verificationCard}`} aria-labelledby="sent-title">
          {verificationMark}
          {data || preview.state === "gone"
            ? <h2 id="sent-title" className={styles.title}>{verificationTitle}</h2>
            : <h1 id="sent-title" className={styles.title}>{verificationTitle}</h1>}
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
      footer={<button type="button" className="btn block" onClick={onAdd} disabled={busy} {...blocked(!online && OFFLINE)}>
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
      <div className={styles.setupHeading}>
        <h1 className="headline">
          {adding ? "Add a business." : onboarding ? "Create your business" : "Set up your stall."}
          {!onboarding && <span className="g"> {adding ? "It gets its own menu, team and till." : "It takes a minute."}</span>}
        </h1>
        <GlossyObject className={styles.setupObject} object="marketStall" />
      </div>
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
