"use client";
import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { ArrowRight, X } from "lucide-react";
import { accountsEnabled, authClient } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";

export function Overlay({
  title,
  onDismiss,
  children,
}: {
  title: string;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="account-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onDismiss?.();
      }}
    >
      <div className="dialog-top">
        <h2>{title}</h2>
        {onDismiss && (
          <button className="icon-btn" aria-label="Close" onClick={onDismiss}>
            <X size={19} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
export function Account({
  onDismiss,
  onSignedIn,
  requiredUser,
}: {
  onDismiss: () => void;
  onSignedIn: (id: string) => Promise<void>;
  requiredUser?: string;
}) {
  const [create, setCreate] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const auth = authClient().auth;
      const { data, error } = create
        ? await auth.signUp({
            email,
            password,
            options: { emailRedirectTo: location.origin },
          })
        : await auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.session) {
        if (requiredUser && requiredUser !== data.session.user.id)
          throw Error("Sign in with the owner account for this register.");
        await onSignedIn(data.session.user.id);
      } else {
        setInfo("Check your email to confirm your account, then sign in here.");
        setCreate(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!accountsEnabled)
    return (
      <Overlay title="Demo workspace" onDismiss={onDismiss}>
        <p className="dialog-intro">
          Live business accounts are waiting for the Supabase database. You can
          try a full shift here. Demo sales stay on this device.
        </p>
        <div className="workspace-facts">
          <div>
            <span>Demo owner PIN</span>
            <strong>1234</strong>
          </div>
        </div>
        <button className="black-button" onClick={onDismiss}>
          Back to register
          <ArrowRight size={16} />
        </button>
      </Overlay>
    );
  return (
    <Overlay
      title={create ? "Create your account" : "Owner sign in"}
      onDismiss={onDismiss}
    >
      <p className="dialog-intro">
        {create
          ? "Set up a register with your own menu and currency."
          : "Use your email and password to open your business."}
      </p>
      <form onSubmit={submit} className="account-form">
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={create ? "new-password" : "current-password"}
            minLength={create ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {info && <p role="status">{info}</p>}
        <button className="black-button" disabled={busy}>
          {busy ? "Please wait…" : create ? "Create account" : "Sign in"}
          <ArrowRight size={16} />
        </button>
      </form>
      {!requiredUser && (
        <button
          className="text-button"
          onClick={() => {
            setCreate(!create);
            setError("");
            setInfo("");
          }}
        >
          {create
            ? "Already have an account? Sign in"
            : "New business? Create an account"}
        </button>
      )}
    </Overlay>
  );
}
export function Setup({
  onSave,
  onSignOut,
}: {
  onSave: (a: OwnerAction) => Promise<void>;
  onSignOut: () => void;
}) {
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr("");
    try {
      await onSave({
        action: "setup",
        name: String(f.get("name")).trim(),
        pin: String(f.get("pin")),
        currency: String(f.get("currency")),
        timeZone: String(f.get("zone")),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className="setup-card">
      <h1>Set up your register</h1>
      <p>Your menu and sales belong to this business.</p>
      <form onSubmit={submit} className="account-form">
        <label>
          Business name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue="USD">
            {Intl.supportedValuesOf("currency").map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Time zone
          <select name="zone" defaultValue={defaultZone}>
            {Array.from(
              new Set([defaultZone, ...Intl.supportedValuesOf("timeZone")]),
            ).map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          Owner PIN
          <input
            type="password"
            inputMode="numeric"
            name="pin"
            pattern="[0-9]{4,8}"
            minLength={4}
            maxLength={8}
            required
            aria-describedby="pin-hint"
          />
        </label>
        <small id="pin-hint">
          Use 4–8 digits to protect pricing, reversals, and shift closing.
        </small>
        {err && <p role="alert">{err}</p>}
        <button className="black-button" disabled={busy}>
          Create register
          <ArrowRight size={16} />
        </button>
      </form>
      <button className="text-button" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  );
}
