/*
 * Exit motion. React removes an element the moment its state says so, so a cart line at 0, a
 * cleared order or a closed sheet just vanishes. These ref callbacks leave a short-lived copy
 * (a "ghost") of the element where it was and animate that out instead, so the screen shows
 * where the thing went. The real element is already gone: nothing waits on the animation and
 * a fast cashier can keep tapping.
 *
 *   <div ref={collapseOnExit}>   a row in a list: fades and closes its height
 *   <div ref={fadeOnExit}>       a floating thing (toast, charge bar, dropdown): fades and drops
 *   Sheet uses exitSheet itself.
 *
 * Timing comes from the --exit-* tokens in globals.css. Rules:
 * - Exits are quicker than entrances and always ease out.
 * - Reduced motion: no movement or height change, only a fade (rows just go).
 * - After a key press (keyboard use, typing in a search) nothing animates.
 * - A bulk change (a filter hiding many rows at once) is instant; only single removals animate.
 */

import { cssTimeMs } from "./motion";

const BULK = 6;
const fallback = { fade: 120, collapse: 180, sheet: 160 };
type Kind = keyof typeof fallback;

function duration(kind: Kind) {
  return cssTimeMs(
    getComputedStyle(document.documentElement).getPropertyValue("--exit-" + kind),
    fallback[kind],
  );
}
function curve(name: "--ease-out" | "--ease-move" | "--ease-drawer") {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "ease-out";
}
function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function skip() {
  return (
    typeof window === "undefined" ||
    typeof Element.prototype.animate !== "function" ||
    document.documentElement.dataset.input === "keyboard" ||
    document.visibilityState === "hidden"
  );
}

// React's dev StrictMode detaches and reattaches refs right after mounting. That isn't a removal.
const mountedAt = new WeakMap<Element, number>();
function justMounted(node: Element) {
  return performance.now() - (mountedAt.get(node) ?? 0) < 100;
}

/** A copy of the node that can't be read, focused or tapped, and doesn't replay its entrance. */
function ghostOf<T extends Element>(node: T): T {
  const ghost = node.cloneNode(true) as T;
  ghost.removeAttribute("id");
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.classList.add("exit-ghost");
  return ghost;
}

/*
 * Ghosts are made while React is still committing, before the real node is removed, so they
 * can copy its place and size. They start once the commit is done, when it's clear which of
 * them survived: a ghost whose parent left too (switching pages) is simply dropped.
 */
let batch: { ghost: HTMLElement; collapse: boolean; run: () => void }[] = [];
function queue(ghost: HTMLElement, collapse: boolean, run: () => void) {
  if (!batch.length) queueMicrotask(flush);
  batch.push({ ghost, collapse, run });
}
function flush() {
  const live = batch.filter((b) => b.ghost.isConnected);
  batch = [];
  const rows = live.filter((b) => b.collapse).length;
  for (const b of live) {
    if (b.collapse && rows > BULK) b.ghost.remove();
    else b.run();
  }
}
function finish(ghost: Element, animation: Animation) {
  animation.finished.then(
    () => ghost.remove(),
    () => ghost.remove(),
  );
}

/** Ref for a row in a list: when it's removed, it fades and its height closes up. */
export function collapseOnExit(node: HTMLElement | null) {
  if (!node) return;
  mountedAt.set(node, performance.now());
  return () => {
    if (skip() || reduced() || justMounted(node) || !node.parentNode || !node.offsetHeight) return;
    const style = getComputedStyle(node);
    const parent = getComputedStyle(node.parentElement ?? node);
    // In a flex or grid column the gap stays until the ghost is gone; pull it in as it closes.
    const column =
      parent.display.includes("grid") ||
      (parent.display.includes("flex") && parent.flexDirection.startsWith("column"));
    const gap = column ? parseFloat(parent.rowGap) || 0 : 0;
    const ghost = ghostOf(node);
    ghost.style.overflow = "hidden";
    ghost.style.boxSizing = "border-box";
    ghost.style.pointerEvents = "none";
    node.parentNode.insertBefore(ghost, node.nextSibling);
    const from = {
      height: node.offsetHeight + "px",
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      borderTopWidth: style.borderTopWidth,
      borderBottomWidth: style.borderBottomWidth,
    };
    queue(ghost, true, () => {
      const time = duration("collapse");
      // The row's content fades out in the first half; the space closes over the whole time.
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: time / 2,
        easing: curve("--ease-out"),
        fill: "forwards",
      });
      const animation = ghost.animate(
        [
          from,
          {
            height: "0px",
            paddingTop: "0px",
            paddingBottom: "0px",
            marginTop: "0px",
            marginBottom: -gap + "px",
            borderTopWidth: "0px",
            borderBottomWidth: "0px",
          },
        ],
        { duration: time, easing: curve("--ease-move"), fill: "forwards" },
      );
      finish(ghost, animation);
    });
  };
}

/** Ref for something floating (toast, charge bar, dropdown): it fades and drops a little. */
export function fadeOnExit(node: HTMLElement | null) {
  if (!node) return;
  mountedAt.set(node, performance.now());
  return () => {
    if (skip() || justMounted(node) || !node.parentNode || !node.offsetHeight) return;
    const { transform, opacity } = getComputedStyle(node);
    const base = transform === "none" ? "" : transform;
    const settle = node.classList.contains("combo-drop") ? "scaleY(0.97)" : "translateY(6px)";
    const ghost = ghostOf(node);
    ghost.style.pointerEvents = "none";
    node.parentNode.insertBefore(ghost, node.nextSibling);
    queue(ghost, false, () => {
      const still = reduced();
      const animation = ghost.animate(
        [
          { opacity, transform: base || "none" },
          { opacity: 0, transform: still ? base || "none" : (base + " " + settle).trim() },
        ],
        { duration: still ? 80 : duration("fade"), easing: curve("--ease-out"), fill: "forwards" },
      );
      finish(ghost, animation);
    });
  };
}

let sheetExit: { layer: HTMLElement; animations: Animation[] } | null = null;

export function clearSheetExit() {
  if (!sheetExit) return;
  sheetExit.layer.remove();
  sheetExit.animations.forEach((animation) => animation.cancel());
  sheetExit = null;
}

/**
 * For Sheet: the dialog leaves the top layer as soon as it's removed, so its ghost goes into a
 * popover, which also sits in the top layer: above the sheet it was opened from, below any
 * sheet that opens next.
 */
export function exitSheet(node: HTMLDialogElement | null) {
  if (!node) return;
  mountedAt.set(node, performance.now());
  return () => {
    if (skip() || justMounted(node) || !node.open) return;
    const box = node.getBoundingClientRect();
    if (!box.height) return;
    clearSheetExit();
    const scrolls = [...node.querySelectorAll<HTMLElement>(".sheet-body")].map((el) => el.scrollTop);
    const { opacity } = getComputedStyle(node);
    const backdropOpacity = getComputedStyle(node, "::backdrop").opacity;

    const layer = document.createElement("div");
    layer.className = "exit-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("inert", "");
    const backdrop = document.createElement("div");
    backdrop.className = "exit-backdrop";
    const panel = document.createElement("div");
    panel.className = node.className + " exit-ghost";
    panel.append(...ghostOf(node).childNodes);
    Object.assign(panel.style, {
      display: "flex",
      position: "fixed",
      top: box.top + "px",
      left: box.left + "px",
      width: box.width + "px",
      height: box.height + "px",
      maxHeight: "none",
      margin: "0",
    });
    layer.append(backdrop, panel);
    document.body.append(layer);
    if (typeof layer.showPopover === "function") {
      layer.popover = "manual";
      layer.showPopover();
    }
    panel.querySelectorAll<HTMLElement>(".sheet-body").forEach((el, i) => (el.scrollTop = scrolls[i] ?? 0));

    const still = reduced();
    const time = still ? 80 : duration("sheet");
    const scrim = backdrop.animate(
      [{ opacity: backdropOpacity }, { opacity: 0 }],
      { duration: time, easing: "linear", fill: "forwards" },
    );
    const closing = panel.animate(
      [
        { opacity, transform: "none" },
        { opacity: 0, transform: still ? "none" : "translateY(32px)" },
      ],
      { duration: time, easing: curve("--ease-drawer"), fill: "forwards" },
    );
    sheetExit = { layer, animations: [scrim, closing] };
    const finishSheet = () => {
      layer.remove();
      if (sheetExit?.layer === layer) sheetExit = null;
    };
    closing.finished.then(finishSheet, finishSheet);
  };
}
