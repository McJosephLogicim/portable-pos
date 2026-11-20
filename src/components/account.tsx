"use client";
import { useState, type FormEvent } from "react";
import { accountsEnabled, authClient } from "@/lib/client";
import type { OwnerAction } from "@/lib/demo";
import { CurrencyOptions } from "./settings";
import { errorText, Explain, Sheet } from "./ui";

export function Account({
  onDismiss,
  onSignedIn,
  requiredUser,
}: {
  onDismiss: () => void;
  onSignedIn: (id: string) => Promise<void>;
  requiredUser?: string;
}) {
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
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
        setInfo("Check your email to confirm, then sign in here.");
        setCreate(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!accountsEnabled)
    return (
      <Sheet
        title="Demo only"
        onClose={onDismiss}
        footer={
          <button className="btn block" onClick={onDismiss}>
            Keep selling
          </button>
        }
      >
        <p className="muted">
          Live accounts aren't connected on this server yet. The demo runs a full
          shift and keeps its sales on this phone. The owner PIN is 1234.
        </p>
      </Sheet>
    );
  return (
    <Sheet
      title={create ? "Create your account" : "Sign in"}
      onClose={onDismiss}
      busy={busy}
    >
      <form onSubmit={submit} className="stack gap-14">
        <p className="muted">
          {create
            ? "Your own menu, prices and sales. Free to start."
            : "Open your business on this phone."}
        </p>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={create ? "new-password" : "current-password"}
            minLength={create ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="notice">
            {info}
          </p>
        )}
        <button className="btn block" disabled={busy}>
          {busy ? "One moment…" : create ? "Create account" : "Sign in"}
        </button>
        {!requiredUser && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setCreate(!create);
              setError("");
              setInfo("");
            }}
          >
            {create ? "I already have an account" : "New here? Create an account"}
          </button>
        )}
      </form>
    </Sheet>
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
          {busy ? "Creating…" : adding ? "Add business" : "Create register"}
        </button>
      </form>
      <button className="link" onClick={onSignOut}>
        {adding ? "Cancel" : "Sign out"}
      </button>
    </div>
  );
}
