"use client";
import { ArrowUpRight, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent, type ReactNode } from "react";
import { accountsEnabled, authClient } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";
import { CurrencyOptions } from "./settings";
import { errorText, Explain, Sheet } from "./ui";
import styles from "./account.module.css";

export type AccountEntry = {
  kind: "register" | "invite" | "business" | "shift";
  returnTo?: string;
};

const entryCopy = {
  register: { title: "Sign in", detail: "Open your register." },
  invite: { title: "Join a business", detail: "Sign in or create an account to accept your invitation." },
  business: { title: "Open team schedule", detail: "Use the email address your team invited." },
  shift: { title: "Open shared shift", detail: "Use the email address your team invited." },
};

function AccountPage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.content}>
          <header className={styles.brand}>
            <Image src="/icon-192.png" alt="" width={34} height={34} loading="eager" unoptimized />
            <span>Portable POS</span>
          </header>
          <section className={styles.body} aria-labelledby="account-title">
            {children}
          </section>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
        <div className={styles.mark} aria-hidden="true">
          <Image src="/icon-512.png" alt="" width={512} height={512} loading="eager" unoptimized />
        </div>
      </div>
    </main>
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
      <div className={styles.intro}>
        <h1 id="account-title">{title}</h1>
        <p>{detail}</p>
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
        <button className={onSwitch ? "link" : "btn block"} onClick={onContinue} disabled={busy}>
          Go to my register
        </button>
        {error && <p role="alert" className="alert">{error}</p>}
      </div>
    </AccountPage>
  );
}

type AccountProps = {
  onSignedIn: (id: string) => Promise<void>;
} & (
  | { entry: AccountEntry; onDemo: () => void; notice?: string }
  | { requiredUser: string; onDismiss: () => void }
);

export function Account(props: AccountProps) {
  const page = "entry" in props;
  const entry = page ? props.entry : undefined;
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = entryCopy[entry?.kind ?? "register"];
  const title = checkEmail ? "Check your email" : create ? "Create your account" : page ? copy.title : "Sign in";
  const createDetail =
    entry?.kind === "invite" ? "Confirm your email to accept the invitation."
      : entry?.kind === "shift" ? "Use the email address your team invited to open this shift."
      : entry?.kind === "business" ? "Use the email address your team invited to open the schedule."
      : "Create an account for your business.";
  const detail = checkEmail
    ? <>We sent a confirmation link to <strong>{email}</strong>. Open it to continue.</>
    : create ? createDetail : page ? copy.detail : "Sign in again to reconnect this register.";

  function switchMode(next: boolean) {
    setCreate(next);
    setShowPassword(false);
    setPassword("");
    setCheckEmail(false);
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
        setCheckEmail(true);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const form = (
    <form onSubmit={submit} className={styles.form}>
      <fieldset disabled={busy || !accountsEnabled}>
        <label className="field">
          <span>Email address</span>
          <input
            className="input"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <div className="field">
          <label htmlFor="account-password">Password</label>
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
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn block">
          {busy ? "Please wait…" : create ? "Create account" : "Sign in"}
        </button>
      </fieldset>
    </form>
  );

  if (!page) return (
    <Sheet title={title} onClose={props.onDismiss} busy={busy}>
      <div className="stack gap-14">
        <p className="muted">{detail}</p>
        {form}
      </div>
    </Sheet>
  );

  return (
    <AccountPage footer={entry?.kind === "register" && (
      <button type="button" className={styles.demo} disabled={busy} onClick={props.onDemo}>
        Try the demo <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    )}>
      <div className={styles.intro}>
        <h1 id="account-title">{title}</h1>
        <p role={checkEmail ? "status" : undefined}>{detail}</p>
      </div>
      {props.notice && <p role="alert" className="alert">{props.notice}</p>}
      {!accountsEnabled && <p className="muted">Live accounts are unavailable on this server.</p>}
      {checkEmail ? (
        <button type="button" className="btn block" onClick={() => switchMode(false)}>Back to sign in</button>
      ) : (
        <>
          {form}
          {accountsEnabled && (
            <div className={styles.switch}>
              <span>{create ? "Already have an account?" : "New to Portable POS?"}</span>
              <button type="button" className="link" disabled={busy} onClick={() => switchMode(!create)}>
                {create ? "Sign in" : "Create an account"}
              </button>
            </div>
          )}
        </>
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
    <div className="page narrow">
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
