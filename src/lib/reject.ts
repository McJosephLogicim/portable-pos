/*
 * Feedback for a tap that can't go through. A future shift, a sold-out item or an action that
 * needs a connection used to just sit there when tapped. Now the thing you tapped flinches
 * (a short red tint and a small shake), the phone buzzes, and a toast says why.
 *
 *   <button {...blocked(!online && "Connect to the internet to add items")} onClick={add}>
 *
 * `blocked(reason)` marks the element aria-disabled with the reason, instead of `disabled`, so it
 * still receives the tap (and stays reachable for screen readers and keyboards). One listener
 * on the document, installed by the workspace, stops that tap before React sees it and calls
 * `reject`. Keep `disabled` for buttons that are only busy saving: that isn't something to explain.
 */

import { cssTimeMs } from "./motion";

export type Reason = string | false | null | undefined;

/** Props that block an element with a reason, or nothing when the reason is empty. */
export function blocked(reason: Reason): { "aria-disabled"?: true; "data-blocked"?: string } {
  return reason ? { "aria-disabled": true, "data-blocked": reason } : {};
}

type Listener = (reason: string) => void;
const listeners = new Set<Listener>();

/** Hears every rejected tap's reason; the workspace shows it as a toast. */
export function onReject(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const running = new WeakMap<Element, Animation[]>();

function token(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function flinch(node: HTMLElement) {
  if (typeof node.animate !== "function") return;
  running.get(node)?.forEach((animation) => animation.cancel());
  const style = getComputedStyle(node);
  const danger = token("--danger", "#d93025");
  // A square row inside a rounded card would show a boxy outline, so only rounded things get the ring.
  const ring = parseFloat(style.borderTopLeftRadius) > 0 ? `inset 0 0 0 1.5px ${danger}` : "";
  const join = (first: string) => (style.boxShadow === "none" ? first : `${first}, ${style.boxShadow}`);
  // The resting shadow gets a clear ring in the same slot, so the two lists blend smoothly.
  const shadow = ring ? join(ring) : style.boxShadow;
  const rest = ring ? join("inset 0 0 0 0 transparent") : style.boxShadow;
  const tint = `color-mix(in srgb, ${danger} 12%, ${style.backgroundColor})`;
  // A blocked button is drawn faded. It comes up to full strength while it flinches, so the red reads.
  const opacity = Number(style.opacity);
  const lit = String(Math.max(opacity, 0.85));
  const hold = { backgroundColor: tint, boxShadow: shadow, opacity: lit };
  const animations = [
    node.animate(
      [
        { ...hold, offset: 0 },
        { ...hold, offset: 0.45, easing: token("--ease-out", "ease-out") },
        { backgroundColor: style.backgroundColor, boxShadow: rest, opacity: style.opacity, offset: 1 },
      ],
      { duration: cssTimeMs(token("--reject-tint", ""), 720) },
    ),
  ];
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    animations.push(
      node.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(4px)" },
          { transform: "translateX(-2px)" },
          { transform: "translateX(0)" },
        ],
        { duration: cssTimeMs(token("--reject-shake", ""), 320), easing: "ease-out", composite: "add" },
      ),
    );
  }
  running.set(node, animations);
}

/** The element flinches, the phone buzzes, and the reason goes to the toast. */
export function reject(node: Element | null, reason?: string) {
  // A row that is a card's only content: the whole card flinches.
  const card = node?.parentElement;
  if (card?.classList.contains("card") && card.childElementCount === 1) node = card;
  if (node instanceof HTMLElement) flinch(node);
  try {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) navigator.vibrate?.([30, 40, 30]);
  } catch {
    /* not supported */
  }
  if (reason) listeners.forEach((listener) => listener(reason));
}

/**
 * Catches taps (and Enter or Space) on anything marked with `blocked`, before React's own
 * handlers run, so the action doesn't happen and the reason shows instead.
 */
export function installRejects() {
  function onClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-blocked]") : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    reject(target, target.dataset.blocked);
  }
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}


/** The reason for anything that needs the server. */
export const OFFLINE = "You're offline. Connect to the internet to change this.";

/** A `disabled` prop that may carry its reason: true means offline, false or empty means allowed. */
export function refusal(disabled: boolean | Reason): Reason {
  return disabled === true ? OFFLINE : disabled;
}
