"use client";

import Image from "next/image";
import { emptyStateObjects } from "@/lib/app-brand";
import { friendlyError } from "@/lib/errors";
import { blocked, type Reason } from "@/lib/reject";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  Banknote,
  Building2,
  Camera,
  CreditCard,
  Delete,
  Info,
  Plus,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { RequestFailure } from "@/lib/client";
import { DEMO_PIN } from "@/lib/demo";
import { currencyDigits } from "@/lib/settings";
import { clearSheetExit, collapseOnExit, exitSheet, fadeOnExit } from "@/lib/exit";
import type { PaymentKind } from "@/lib/types";
import { activeTextEntry } from "./input-experience";
import { Popo, type PopoMotion, type PopoPose } from "./popo";

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

/** A number with a smaller currency sign that shares its text color. */
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
/** A short burst of confetti from a point for an occasional milestone. */
export function useCelebrate() {
  return useContext(CelebrateContext);
}
const confettiColors = ["#0a0a0a", "#0a0a0a", "#8c8c8c", "#1e9e5a", "#f2c94c", "#ff7a59"];
export function CelebrateProvider({ children }: { children: ReactNode }) {
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const fire = useCallback((origin?: { x: number; y: number }) => {
    buzz.success();
    if (document.documentElement.dataset.input === "keyboard" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = Date.now() + Math.random();
    const x = origin?.x ?? innerWidth / 2;
    const y = origin?.y ?? innerHeight * 0.4;
    setBursts([{ id, x, y }]);
    setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 900);
  }, []);
  return (
    <CelebrateContext.Provider value={fire}>
      {children}
      {bursts.map((b) => (
        <div key={b.id} className="confetti" style={{ left: b.x, top: b.y }} aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => {
            const angle = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
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
export function useCountUp(value: number, ms = 260) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || document.documentElement.dataset.input === "keyboard" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      from.current = Math.round(start + (value - start) * eased);
      setShown(from.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
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
  blockedReason,
  onError,
  face,
}: {
  /** A profile photo, which anyone on the team can add for themselves. */
  face?: boolean;
  value?: string;
  onChange: (url: string | undefined) => void | Promise<void>;
  onError?: (message: string) => void;
  label: string;
  size?: "large" | "small";
  blockedReason?: Reason;
}) {
  const upload = useContext(PhotoContext);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [viewing, setViewing] = useState(false);
  const title = label[0].toUpperCase() + label.slice(1);
  return (
    <div className={"photo-pick " + size}>
      <button
        type="button"
        className={"photo-slot" + (value ? " has" : "")}
        aria-label={value ? (size === "small" ? "View " : "Change ") + label : "Add " + label}
        aria-busy={busy || undefined}
        disabled={busy}
        {...blocked(blockedReason)}
        onClick={() => {
          buzz.tap();
          // A small photo opens large first, with Change and Remove under it.
          if (size === "small" && value) setViewing(true);
          else input.current?.click();
        }}
      >
        {value ? <img src={value} alt="" /> : <Camera size={size === "large" ? 26 : 18} strokeWidth={1.6} />}
        {busy && <span className="photo-busy" aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">{busy ? "Saving photo…" : ""}</span>
      {size === "large" && (
        <span className="stack gap-4 grow">
          <span className="strong">
            {value ? label[0].toUpperCase() + label.slice(1) : "Add " + (/^[aeiou]/i.test(label) ? "an " : "a ") + label}
          </span>
          {error ? (
            <span className="label alert" role="alert">{error}</span>
          ) : (
            <span className="label">{busy ? "Saving photo…" : value ? "Tap it to take another." : "Take one or pick from your gallery."}</span>
          )}
          {value && (
            <button type="button" className="link danger" style={{ alignSelf: "flex-start" }} disabled={busy} {...blocked(blockedReason)} onClick={() => setRemoving(true)}>
              Remove
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
            await onChange(await upload(file, face));
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
      {viewing && value && (
        <Sheet
          title={title}
          onClose={() => setViewing(false)}
          footer={
            <div className="grid-2">
              <button
                type="button"
                className="btn"
                {...blocked(blockedReason)}
                onClick={() => {
                  // The file picker must open inside the tap, before the sheet closes.
                  input.current?.click();
                  setViewing(false);
                }}
              >
                Change
              </button>
              <button
                type="button"
                className="btn secondary"
                {...blocked(blockedReason)}
                onClick={() => {
                  setViewing(false);
                  void Promise.resolve(onChange(undefined)).catch((err) => {
                    const message = errorText(err);
                    setError(message);
                    onError?.(message);
                  });
                }}
              >
                Remove
              </button>
            </div>
          }
        >
          <img src={value} alt={title} className={"photo-full" + (face ? " face" : "")} />
        </Sheet>
      )}
      {removing && (
        <ConfirmSheet
          title={`Remove ${label}?`}
          detail="The image will be cleared when you save."
          confirmLabel="Remove"
          blockedReason={blockedReason}
          onClose={() => setRemoving(false)}
          onConfirm={() => onChange(undefined)}
        />
      )}
    </div>
  );
}

/*
 * Focus rings are for keyboard users. Browsers mostly agree, but Safari also rings buttons that
 * get focus from a script or a dialog after a tap. Track how the person last interacted, and
 * let CSS hide rings (html[data-input="touch"]) until they press a key.
 */
let usingKeyboard = false;
if (typeof window !== "undefined") {
  const mark = (keyboard: boolean) => {
    usingKeyboard = keyboard;
    document.documentElement.dataset.input = keyboard ? "keyboard" : "touch";
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) mark(true);
    },
    true,
  );
  window.addEventListener("pointerdown", () => mark(false), true);
}

type SheetDrag = {
  pointer: number;
  start: number;
  offset: number;
  lastY: number;
  lastAt: number;
  velocity: number;
};

/** Bottom sheet at every screen size. Uses the native dialog for focus. */
let sheetOrder = 0;
const returningSheets = new Map<number, () => void>();

function restoreSheet(order: number, show: () => void) {
  if (!returningSheets.size) queueMicrotask(() => {
    const pending = [...returningSheets].sort(([a], [b]) => a - b);
    returningSheets.clear();
    for (const [, open] of pending) open();
  });
  returningSheets.set(order, show);
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  busy = false,
  action,
  help,
  describedBy,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  action?: ReactNode;
  /** How this sheet works, behind an (i) beside the title. */
  help?: ReactNode;
  describedBy?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const scrolls = useRef(new Map<Element, { left: number; top: number }>());
  const order = useRef<number>(undefined);
  const backdropPressed = useRef(false);
  const drag = useRef<SheetDrag | null>(null);
  const rebound = useRef<Animation | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // However the sheet is closed (X, backdrop, Save, or the page moving on), it slides back down.
  const setRef = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    const exit = exitSheet(node);
    return () => {
      ref.current = null;
      exit?.();
    };
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let trigger: Element | null = null;
    const show = () => {
      if (!node.isConnected) return;
      trigger = document.activeElement;
      clearSheetExit();
      node.showModal();
      // Focus the sheet without scrolling an input or making the Close button look selected.
      node.focus({ preventScroll: true });
      for (const [element, { left, top }] of scrolls.current) {
        if (node.contains(element)) element.scrollTo({ left, top, behavior: "instant" });
        else scrolls.current.delete(element);
      }
    };
    if (order.current === undefined) {
      order.current = ++sheetOrder;
      show();
    } else {
      // A returning screen can contain several open sheets. Reopen the parent before the child.
      restoreSheet(order.current, show);
    }
    const number = order.current;
    return () => {
      returningSheets.delete(number);
      node.close();
      if (usingKeyboard && trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  function isBackdrop(event: { target: EventTarget; clientX: number; clientY: number }) {
    const node = ref.current;
    if (!node || event.target !== node) return false;
    const box = node.getBoundingClientRect();
    return event.clientY < box.top || event.clientY > box.bottom ||
      event.clientX < box.left || event.clientX > box.right;
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const node = ref.current;
    if (!node || busy || drag.current || !event.isPrimary || event.button !== 0 ||
      activeTextEntry() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const transform = getComputedStyle(node).transform;
    const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    rebound.current?.cancel();
    node.dataset.dragging = "";
    node.style.transform = `translateY(${offset}px)`;
    drag.current = {
      pointer: event.pointerId,
      start: event.clientY,
      offset,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const motion = drag.current;
    const node = ref.current;
    if (!node || motion?.pointer !== event.pointerId) return;
    const distance = motion.offset + event.clientY - motion.start;
    // Beyond either edge, extra pointer travel produces progressively less movement.
    const offset = distance < 0 ? distance / (1 - distance / 28) :
      distance > 112 ? 112 + (distance - 112) / (1 + (distance - 112) / 96) : distance;
    node.style.transform = `translateY(${offset}px)`;
    motion.velocity = (event.clientY - motion.lastY) / Math.max(1, event.timeStamp - motion.lastAt);
    motion.lastY = event.clientY;
    motion.lastAt = event.timeStamp;
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>, released: boolean) {
    const motion = drag.current;
    const node = ref.current;
    if (!node || motion?.pointer !== event.pointerId) return;
    drag.current = null;
    const distance = event.clientY - motion.start;
    const flick = distance > 20 && motion.velocity > 0.55 && event.timeStamp - motion.lastAt < 80;
    if (released && !busy && (distance >= 96 || flick)) {
      close.current();
      // Some screens guard closing while a save is in flight. Restore the pose if still open.
    }
    const transform = node.style.transform;
    node.style.removeProperty("transform");
    delete node.dataset.dragging;
    if (!node.isConnected || !transform || !node.animate) return;
    rebound.current = node.animate([{ transform }, { transform: "none" }], {
      duration: 200,
      easing: getComputedStyle(node).getPropertyValue("--ease-drawer").trim(),
    });
  }
  return (
    <dialog
      ref={setRef}
      className={className ? `sheet ${className}` : "sheet"}
      tabIndex={-1}
      aria-labelledby={id}
      aria-describedby={describedBy}
      onScrollCapture={(event) => {
        const element = event.target;
        if (element instanceof Element && element.closest("dialog") === ref.current) {
          const { scrollLeft: left, scrollTop: top } = element;
          if (left || top) scrolls.current.set(element, { left, top });
          else scrolls.current.delete(element);
        }
      }}
      onCancel={(event) => {
        if (event.target !== ref.current) return;
        event.preventDefault();
        if (!busy) close.current();
      }}
      onPointerDown={(event) => {
        backdropPressed.current = isBackdrop(event);
        // Handle the first backdrop tap with the field still focused.
        if (backdropPressed.current && activeTextEntry()) event.preventDefault();
      }}
      onPointerCancel={() => { backdropPressed.current = false; }}
      onClick={(event) => {
        const tappedBackdrop = backdropPressed.current && isBackdrop(event);
        backdropPressed.current = false;
        if (!tappedBackdrop) return;
        const field = activeTextEntry();
        if (field) field.blur();
        else if (!busy) close.current();
      }}
    >
      <div className="sheet-head">
        <div
          className="sheet-grip"
          aria-hidden="true"
          data-disabled={busy || undefined}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={(event) => endDrag(event, true)}
          onPointerCancel={(event) => endDrag(event, false)}
          onLostPointerCapture={(event) => endDrag(event, false)}
        />
        {help ? (
          <div className="sheet-title">
            <h2 id={id}>{title}</h2>
            <Explain title={title} label={"About " + title.toLowerCase()}>
              {help}
            </Explain>
          </div>
        ) : (
          <h2 id={id}>{title}</h2>
        )}
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

export function ConfirmSheet({
  title,
  detail,
  confirmLabel,
  destructive = true,
  blockedReason,
  onClose,
  onConfirm,
}: {
  title: string;
  detail: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  blockedReason?: Reason;
  onClose: () => void;
  onConfirm: (button: HTMLButtonElement) => void | boolean | Promise<void | boolean>;
}) {
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function confirm(button: HTMLButtonElement) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (await onConfirm(button) !== false) onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={title}
      describedBy={descriptionId}
      busy={busy}
      onClose={onClose}
      footer={
        <div className="grid-2">
          <button
            type="button"
            className={destructive ? "btn destructive" : "btn"}
            disabled={busy}
            {...blocked(blockedReason)}
            onClick={(event) => void confirm(event.currentTarget)}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      }
    >
      <p id={descriptionId} className="muted">{detail}</p>
      {error && <p className="alert" role="alert">{error}</p>}
    </Sheet>
  );
}

/**
 * The one (i) in the app. A word that needs explaining, like "usable yield", gets a small (i)
 * next to it that opens a short, plain answer. Keeps labels short without leaving anyone guessing.
 *
 * It often sits inside a <label>, so two things keep it from fighting the field:
 * - The trigger is a span, not a <button>. A button is "labelable", so tapping the label's text
 *   would open this sheet instead of focusing the field.
 * - The sheet renders into <body>. Inside the label, any tap in the sheet (its text, the
 *   backdrop, and on iOS even X or Got it) re-clicked the (i) and reopened it straight away.
 */
export function Explain({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  function show(event: SyntheticEvent) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  }
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className="explain"
        aria-label={label ?? "What is " + title.toLowerCase() + "?"}
        aria-haspopup="dialog"
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") show(event);
        }}
      >
        <Info size={15} strokeWidth={1.9} />
      </span>
      {open &&
        createPortal(
          // React still bubbles events up its own tree through a portal; stop them here so a tap
          // in the sheet never reaches a row, card or label the (i) sits in.
          <div className="explain-layer" onClick={(event) => event.stopPropagation()}>
            <Sheet
              title={title}
              onClose={() => setOpen(false)}
              footer={
                <button type="button" className="btn block" onClick={() => setOpen(false)}>
                  Done
                </button>
              }
            >
              <div className="explain-text stack gap-10">{children}</div>
            </Sheet>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * The one live notice in the app: something true right now that needs attention, like a failed
 * sync or a sold-out item in the order. A small dot says how serious it is; the text says what
 * happened and what to do. How-it-works text never goes here; it goes behind an (i).
 */
export function Notice({
  tone = "info",
  action,
  onDismiss,
  live = "polite",
  children,
}: {
  /** danger: something failed or blocks the next step. warn: needs doing soon. info: just so you know. */
  tone?: "danger" | "warn" | "info";
  /** One small button, like Retry. */
  action?: ReactNode;
  onDismiss?: () => void;
  /** assertive only when it blocks what the person is doing right now. */
  live?: "polite" | "assertive";
  children: ReactNode;
}) {
  return (
    <div className={"notice " + tone} role={live === "assertive" ? "alert" : "status"} ref={collapseOnExit}>
      <span className="dot" aria-hidden="true" />
      <span className="notice-text">{children}</span>
      {action && <span className="notice-actions">{action}</span>}
      {onDismiss && (
        <button type="button" className="round flat small" aria-label="Dismiss" onClick={onDismiss}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  blockedReason,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  blockedReason?: Reason;
}) {
  return (
    <span className="switch-hit">
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-label={label}
        {...blocked(blockedReason)}
        onClick={(event) => {
          event.stopPropagation();
          onChange(!checked);
        }}
      />
    </span>
  );
}

export function DoneCheck({ small = false }: { small?: boolean }) {
  const size = small ? 16 : 24;
  return (
    <span className={"done-check" + (small ? " small" : "")} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5l4.2 4.2L19 7"
          pathLength={1}
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * The items in an order as overlapping photos, like the people on a shift card. Shows up to `max`,
 * then a circle counting the rest.
 */
export function ItemFaces({
  items,
  max = 5,
}: {
  items: { id: string; name: string; image?: string }[];
  max?: number;
}) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span className="row faces item-faces" role="img" aria-label={items.map((i) => i.name).join(", ")}>
      {shown.map((i) => (
        <span key={i.id} className={"avatar small" + (i.image ? " has-photo" : "")} aria-hidden="true">
          {i.image ? <img src={i.image} alt="" /> : i.name.trim().slice(0, 1).toUpperCase()}
        </span>
      ))}
      {rest > 0 && (
        <span className="avatar small dim" aria-hidden="true">
          +{rest}
        </span>
      )}
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
  help,
}: {
  label: string;
  /** A short explanation behind an (i) next to the label. */
  help?: { title: string; body: ReactNode };
  value: string;
  onChange: (value: string) => void;
  currency: string;
  big?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className={help ? "field-head" : undefined}>
        <label htmlFor={id}>{label}</label>
        {help && <Explain title={help.title}>{help.body}</Explain>}
      </span>
      <span className="money-input">
        <input
          id={id}
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
    </div>
  );
}

/* ---------- owner PIN ---------- */

type PinRequest = (run: (pin: string) => Promise<void>, options?: { fresh?: boolean }) => Promise<boolean>;
const PinContext = createContext<PinRequest>(async () => false);

/** Owner actions ask for the PIN once, then reuse it for five minutes on this screen. */
export function usePin() {
  return useContext(PinContext);
}

const runPracticeAction: PinRequest = async (run) => {
  await run(DEMO_PIN);
  return true;
};

/** The local lesson reuses owner forms without asking for credentials. */
export function PracticePinProvider({ children }: { children: ReactNode }) {
  return <PinContext.Provider value={runPracticeAction}>{children}</PinContext.Provider>;
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
    async (run, options) => {
      const cachedPin =
        !options?.fresh && cached.current && Date.now() - cached.current.at < PIN_TTL
          ? cached.current.pin
          : null;
      let pin = cachedPin ?? (await prompt());
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
          {...blocked(pin.length < 4 && "Enter at least four digits of the owner PIN.")}
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

export function Toast({
  text,
  undo,
  stamp,
  onDone,
}: {
  text: string;
  undo?: (pin: string) => Promise<void>;
  /** Changes when the same text is shown again, so it stays up for the full time. */
  stamp?: number;
  onDone: (restored?: boolean) => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const withPin = usePin();
  const [busy, setBusy] = useState(false);
  const restoring = useRef(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (busy || hover || focused || pressed) return;
    // Longer text (the reason a tap was refused) needs a moment more to read.
    const t = setTimeout(() => done.current(), undo ? 10000 : text.length > 32 ? 3200 : 2200);
    return () => clearTimeout(t);
  }, [text, undo, stamp, busy, hover, focused, pressed]);

  function endGesture(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const start = gesture.current;
    if (!start || event.pointerId !== start.id) return;
    gesture.current = null;
    setPressed(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    suppressClick.current = cancelled || Math.hypot(dx, dy) > 8;
    if (!cancelled && !restoring.current && dy >= 36 && dy > Math.abs(dx) * 1.2) {
      done.current();
    }
  }

  async function restore() {
    if (!undo || restoring.current) return;
    restoring.current = true;
    setBusy(true);
    setError("");
    try {
      if (await withPin(undo)) done.current(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      restoring.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      className="toast"
      ref={fadeOnExit}
      onClick={(event) => {
        if ((event.target as Element).closest(".toast-action")) return;
        const dragged = suppressClick.current;
        suppressClick.current = false;
        if (dragged && event.detail !== 0) return;
        if (!restoring.current) done.current();
      }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (!event.isPrimary || event.button !== 0 || restoring.current || (event.target as Element).closest(".toast-action")) return;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setPressed(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => endGesture(event)}
      onPointerCancel={(event) => endGesture(event, true)}
      onLostPointerCapture={(event) => endGesture(event, true)}
      onPointerEnter={(event) => { if (undo && event.pointerType === "mouse") setHover(true); }}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <button
        type="button"
        className="toast-dismiss"
        aria-label={`Dismiss notification: ${error || text}`}
        disabled={busy}
      >
        <span role={error ? "alert" : undefined}>{error || text}</span>
      </button>
      {undo && (
        <button type="button" className="toast-action" disabled={busy} onClick={() => void restore()}>
          {busy ? "Restoring…" : "Undo"}
        </button>
      )}
    </div>
  );
}

type EmptyStateObject = keyof typeof emptyStateObjects;

export function GlossyObject({ object, className }: { object: EmptyStateObject; className: string }) {
  return <Image className={className} src={emptyStateObjects[object]} alt="" width={160} height={160} unoptimized />;
}

type EmptyStateArt =
  | { pose: PopoPose; motion?: PopoMotion; object?: EmptyStateObject; icon?: never }
  | { icon: ReactNode; pose?: never; motion?: never; object?: never };

/** Page empties lead with Popo. Search and filter misses can use a utility icon. */
export function EmptyState({ icon, pose, object, motion = "idle", title, text, children, heading = "h2" }: EmptyStateArt & {
  title: string;
  text?: string;
  children?: ReactNode;
  heading?: "h1" | "h2";
}) {
  const Title = pose ? heading : "span";
  return (
    <div className={pose ? "card empty empty-popo" : "card empty"}>
      {pose ? (
        <span className={object ? "empty-popo-with-object" : undefined} aria-hidden="true">
          <Popo pose={pose} motion={motion} size={100} />
          {object && (
            <GlossyObject className="empty-popo-object" object={object} />
          )}
        </span>
      ) : (
        <span className="well" aria-hidden="true">{icon}</span>
      )}
      <Title className="strong">{title}</Title>
      {text && <span className="label empty-text">{text}</span>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

/** An empty list inside a card: what goes here, and how it fills up. */
export function EmptyRow({ object, title, detail }: { object: EmptyStateObject; title: string; detail?: string }) {
  return (
    <div className="list-row empty-row">
      <GlossyObject className="empty-row-object" object={object} />
      <span className="grow stack gap-4">
        <span className="strong">{title}</span>
        {detail && <span className="label">{detail}</span>}
      </span>
    </div>
  );
}


/**
 * Category tabs, as on Sell: "All" then each category. Tapping the open tab goes back to All.
 * onNew adds a dashed New category button at the end.
 */
export function CategoryTabs({
  label = "Categories",
  categories,
  value,
  onChange,
  onNew,
  newDisabled,
}: {
  label?: string;
  categories: string[];
  value: string | null;
  onChange: (category: string | null) => void;
  onNew?: () => void;
  newDisabled?: boolean;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
        All
      </button>
      {categories.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(value === c ? null : c)}>
          {c}
        </button>
      ))}
      {onNew && (
        <button type="button" className="chip-new" disabled={newDisabled} onClick={onNew}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          New category
        </button>
      )}
    </div>
  );
}
