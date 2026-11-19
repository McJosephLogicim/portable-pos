"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Banknote,
  Building2,
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
  return error instanceof Error
    ? error.message
    : "That didn't save. Check the connection and try again.";
}

export function haptic(ms = 8) {
  try {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
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
