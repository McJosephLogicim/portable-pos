"use client";

import { friendlyError } from "@/lib/errors";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Banknote,
  Building2,
  Camera,
  CreditCard,
  Delete,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { RequestFailure } from "@/lib/client";
import { currencyDigits } from "@/lib/settings";
import type { PaymentKind } from "@/lib/types";

/** Format minor units, dropping ".00" so counters read like price tags. */
export function formatMoney(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  const whole = minor % 10 ** digits === 0;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

export function currencySymbol(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency
  );
}

/** A number set large with its currency sign small and grey, the Studio way. */
export function Money({
  value,
  currency,
  className = "",
  sign = false,
}: {
  value: number;
  currency: string;
  className?: string;
  sign?: boolean;
}) {
  const text = formatMoney(Math.abs(value), currency);
  const symbol = currencySymbol(currency);
  const prefix = sign && value !== 0 ? (value < 0 ? "−" : "+") : "";
  const at = text.indexOf(symbol);
  return (
    <span className={"num " + className}>
      {prefix}
      {at === 0 ? (
        <>
          <span className="unit">{symbol}</span>
          {text.slice(symbol.length)}
        </>
      ) : (
        text
      )}
    </span>
  );
}

export function errorText(error: unknown) {
  return friendlyError(error, "That didn't save. Check the connection and try again.");
}

/** A short buzz on phones that support it: a number, or a pattern of buzz and pause. */
export function haptic(ms: number | number[] = 8) {
  try {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
export const buzz = {
  tap: () => haptic(6),
  tick: () => haptic(10),
  success: () => haptic([14, 60, 22]),
  big: () => haptic([18, 50, 18, 50, 40]),
  error: () => haptic([30, 40, 30]),
};

/* ---------- celebration ---------- */

const CelebrateContext = createContext<(origin?: { x: number; y: number }) => void>(() => {});
/** A short burst of confetti from a point, for a finished sale, a full checklist or a quota hit. */
export function useCelebrate() {
  return useContext(CelebrateContext);
}
const confettiColors = ["#0a0a0a", "#0a0a0a", "#8c8c8c", "#1e9e5a", "#f2c94c", "#ff7a59"];
export function CelebrateProvider({ children }: { children: ReactNode }) {
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const fire = useCallback((origin?: { x: number; y: number }) => {
    buzz.success();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = Date.now() + Math.random();
    const x = origin?.x ?? innerWidth / 2;
    const y = origin?.y ?? innerHeight * 0.4;
    setBursts((b) => [...b, { id, x, y }]);
    setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 1400);
  }, []);
  return (
    <CelebrateContext.Provider value={fire}>
      {children}
      {bursts.map((b) => (
        <div key={b.id} className="confetti" style={{ left: b.x, top: b.y }} aria-hidden="true">
          {Array.from({ length: 22 }, (_, i) => {
            const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.2;
            const distance = 70 + ((i * 37) % 70);
            return (
              <i
                key={i}
                style={
                  {
                    "--dx": `${Math.cos(angle) * distance}px`,
                    "--dy": `${Math.sin(angle) * distance - 40}px`,
                    "--r": `${(i * 47) % 360}deg`,
                    background: confettiColors[i % confettiColors.length],
                    animationDelay: `${(i % 4) * 18}ms`,
                    borderRadius: i % 3 ? "2px" : "50%",
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      ))}
    </CelebrateContext.Provider>
  );
}
/** The center of an element, for where confetti starts. */
export function centerOf(el: Element | null | undefined) {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function progressStyle(percent: number): CSSProperties {
  return { "--progress": `${percent}%` } as CSSProperties;
}

/** Counts up to a number when it changes, like a scoreboard. */
export function useCountUp(value: number, ms = 600) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, ms]);
  return shown;
}

/* ---------- photos ---------- */

type Upload = (file: File, face?: boolean) => Promise<string>;
const PhotoContext = createContext<Upload>(async () => {
  throw Error("Photos are unavailable.");
});
export const PhotoProvider = PhotoContext.Provider;

/** Profile photos of the team, by member id and by name. */
export interface Faces {
  byId: Record<string, string>;
  byName: Record<string, string>;
}
const FacesContext = createContext<Faces>({ byId: {}, byName: {} });
export const FacesProvider = FacesContext.Provider;
export function useFaces() {
  return useContext(FacesContext);
}
export function facesOf(state: {
  faces?: Record<string, string>;
  me?: { memberId: string; name: string; photo?: string } | null;
  team?: { id: string; name: string; photo?: string }[];
  bookings?: { staff: { memberId: string; name: string }[] }[];
}): Faces {
  const byId: Record<string, string> = { ...(state.faces ?? {}) };
  for (const m of state.team ?? []) if (m.photo) byId[m.id] = m.photo;
  if (state.me?.photo) byId[state.me.memberId] = state.me.photo;
  const byName: Record<string, string> = {};
  for (const m of state.team ?? []) if (byId[m.id]) byName[m.name] = byId[m.id];
  for (const b of state.bookings ?? []) for (const s of b.staff) if (byId[s.memberId]) byName[s.name] = byId[s.memberId];
  if (state.me && byId[state.me.memberId]) byName[state.me.name] = byId[state.me.memberId];
  return { byId, byName };
}

/** Turns a stored proof photo address into something an img can show. */
const ProofContext = createContext<(url: string) => Promise<string>>(async (url) => url);
export const ProofProvider = ProofContext.Provider;
export function useProof() {
  return useContext(ProofContext);
}

/** A square photo slot. Tap to take or choose a photo; it shrinks and uploads it. */
export function PhotoPicker({
  value,
  onChange,
  label,
  size = "large",
  disabled,
  onError,
  face,
}: {
  /** A profile photo, which anyone on the team can add for themselves. */
  face?: boolean;
  value?: string;
  onChange: (url: string | undefined) => void;
  onError?: (message: string) => void;
  label: string;
  size?: "large" | "small";
  disabled?: boolean;
}) {
  const upload = useContext(PhotoContext);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={"photo-pick " + size}>
      <button
        type="button"
        className={"photo-slot" + (value ? " has" : "")}
        aria-label={value ? "Change " + label : "Add " + label}
        disabled={busy || disabled}
        onClick={() => {
          buzz.tap();
          input.current?.click();
        }}
      >
        {value ? <img src={value} alt="" /> : <Camera size={size === "large" ? 26 : 18} strokeWidth={1.6} />}
        {busy && <span className="photo-busy" />}
      </button>
      {size === "small" && value && !busy && (
        <button type="button" className="photo-clear" aria-label={"Remove " + label} onClick={() => onChange(undefined)}>
          <X size={12} strokeWidth={2.6} />
        </button>
      )}
      {size === "large" && (
        <span className="stack gap-4 grow">
          <span className="strong">
            {value ? label[0].toUpperCase() + label.slice(1) : "Add " + (/^[aeiou]/i.test(label) ? "an " : "a ") + label}
          </span>
          {error ? (
            <span className="label alert" role="alert">{error}</span>
          ) : (
            <span className="label">{value ? "Tap it to take another." : "Take one or pick from your gallery."}</span>
          )}
          {value && (
            <button type="button" className="link danger" style={{ alignSelf: "flex-start" }} onClick={() => onChange(undefined)}>
              Remove photo
            </button>
          )}
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          onError?.("");
          try {
            onChange(await upload(file, face));
            buzz.success();
          } catch (err) {
            const message = errorText(err);
            setError(message);
            onError?.(message);
            buzz.error();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on wide screens. Uses the native dialog for focus. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  busy = false,
  action,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  action?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close.current();
      }}
      onClick={(event) => {
        if (event.target !== ref.current || busy) return;
        const box = ref.current.getBoundingClientRect();
        if (
          event.clientY < box.top ||
          event.clientY > box.bottom ||
          event.clientX < box.left ||
          event.clientX > box.right
        )
          close.current();
      }}
    >
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        {action}
        <button
          type="button"
          className="round flat"
          aria-label="Close"
          disabled={busy}
          onClick={() => close.current()}
        >
          <X size={19} />
        </button>
      </div>
      <div className="sheet-body">{children}</div>
      {footer && <div className="sheet-foot">{footer}</div>}
    </dialog>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className="switch-hit">
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onChange(!checked);
        }}
      />
    </span>
  );
}

export function DoneCheck() {
  return (
    <span className="done-check" aria-hidden="true">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5l4.2 4.2L19 7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function MethodIcon({
  kind,
  size = 20,
}: {
  kind: PaymentKind;
  size?: number;
}) {
  const Icon =
    kind === "cash"
      ? Banknote
      : kind === "wallet"
        ? Smartphone
        : kind === "card"
          ? CreditCard
          : kind === "bank"
            ? Building2
            : Wallet;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

/** A money field with the currency sign inside it. Shows the parsed value's error on blur only. */
export function MoneyField({
  label,
  value,
  onChange,
  currency,
  big = false,
  autoFocus,
  placeholder = "0",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  big?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="money-input">
        <input
          className={"input" + (big ? " big" : "")}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(event) =>
            onChange(event.target.value.replace(/[^\d.]/g, ""))
          }
        />
        <span className={"prefix" + (big ? " big" : "")}>
          {currencySymbol(currency)}
        </span>
      </span>
    </label>
  );
}

/* ---------- owner PIN ---------- */

type PinRequest = (run: (pin: string) => Promise<void>) => Promise<boolean>;
const PinContext = createContext<PinRequest>(async () => false);

/** Owner actions ask for the PIN once, then reuse it for five minutes on this screen. */
export function usePin() {
  return useContext(PinContext);
}

const PIN_TTL = 5 * 60 * 1000;

export function PinProvider({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  const cached = useRef<{ pin: string; at: number } | null>(null);
  const [ask, setAsk] = useState<{
    error: string;
    n: number;
    resolve: (pin: string | null) => void;
  } | null>(null);
  const prompt = useCallback(
    (error = "") =>
      new Promise<string | null>((resolve) =>
        setAsk({ error, resolve, n: Date.now() }),
      ),
    [],
  );
  const request = useCallback<PinRequest>(
    async (run) => {
      const fresh =
        cached.current && Date.now() - cached.current.at < PIN_TTL
          ? cached.current.pin
          : null;
      let pin = fresh ?? (await prompt());
      for (;;) {
        if (pin === null) return false;
        try {
          await run(pin);
          cached.current = { pin, at: Date.now() };
          return true;
        } catch (error) {
          if (
            error instanceof RequestFailure &&
            (error.status === 403 || error.status === 429)
          ) {
            cached.current = null;
            pin = await prompt(error.message);
            continue;
          }
          throw error;
        }
      }
    },
    [prompt],
  );
  return (
    <PinContext.Provider value={request}>
      {children}
      {ask && (
        <PinSheet
          key={ask.n}
          error={ask.error}
          hint={hint}
          onDone={(pin) => {
            ask.resolve(pin);
            setAsk(null);
          }}
        />
      )}
    </PinContext.Provider>
  );
}

function PinSheet({
  error,
  hint,
  onDone,
}: {
  error: string;
  hint?: string;
  onDone: (pin: string | null) => void;
}) {
  const [pin, setPin] = useState("");
  const press = useCallback((key: string) => {
    haptic(6);
    setPin((p) =>
      key === "back" ? p.slice(0, -1) : p.length < 8 ? p + key : p,
    );
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") press("back");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [press]);
  return (
    <Sheet
      title="Owner PIN"
      onClose={() => onDone(null)}
      footer={
        <button
          className="btn block"
          disabled={pin.length < 4}
          onClick={() => onDone(pin)}
        >
          Confirm
        </button>
      }
    >
      <div className="stack gap-6" style={{ textAlign: "center" }}>
        <div
          className={"pin-dots" + (error ? " shake" : "")}
          aria-label={pin.length + " digits entered"}
          role="status"
        >
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <i key={i} className={i < pin.length ? "on" : ""} />
          ))}
        </div>
        <p className={error ? "alert" : "label"} role={error ? "alert" : undefined}>
          {error || hint || "Enter the 4 to 8 digit owner PIN."}
        </p>
      </div>
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button key={k} type="button" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          className="quiet"
          aria-label="Delete digit"
          onClick={() => press("back")}
        >
          <Delete size={24} strokeWidth={1.6} />
        </button>
      </div>
    </Sheet>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), 2200);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

/** An empty list inside a card: what goes here, and how it fills up. */
export function EmptyRow({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="list-row empty-row">
      <span className="grow stack gap-4">
        <span className="strong">{title}</span>
        {detail && <span className="label">{detail}</span>}
      </span>
    </div>
  );
}

