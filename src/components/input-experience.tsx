"use client";

import { useEffect } from "react";

const textInputTypes = new Set(["text", "search", "email", "url", "tel", "password", "number"]);
const optionsSelector = "[data-input-options]";
const scrollIntentMs = 250;

function isTextEntry(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLInputElement && !textInputTypes.has(element.type)) return false;
  return (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) &&
    !element.readOnly && !element.disabled && element.inputMode !== "none";
}

export function activeTextEntry() {
  return isTextEntry(document.activeElement) ? document.activeElement : null;
}

export function InputExperience() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    let keyboardOpen = false;
    // Browser focus and keyboard movement can scroll as well. Only dismiss after a user gesture.
    let scrollUntil = 0;
    let touch: { id: number; x: number; y: number } | undefined;

    function reveal() {
      const field = activeTextEntry();
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? root.clientHeight;
      // Ignore small viewport changes from browser chrome and keep the sheet fitted until the keyboard retracts.
      keyboardOpen = (Boolean(field) || keyboardOpen) && viewport?.scale === 1 && root.clientHeight - height > 100;
      if (keyboardOpen) {
        root.style.setProperty("--keyboard-top", `${top}px`);
        root.style.setProperty("--keyboard-bottom", `${Math.max(0, root.clientHeight - top - height)}px`);
        root.style.setProperty("--keyboard-height", `${height}px`);
        root.dataset.keyboard = "";
      } else {
        delete root.dataset.keyboard;
        root.style.removeProperty("--keyboard-top");
        root.style.removeProperty("--keyboard-bottom");
        root.style.removeProperty("--keyboard-height");
      }

      if (!field || performance.now() < scrollUntil) return;
      const rect = field.getBoundingClientRect();
      let visibleTop = top;
      let visibleBottom = top + height;
      for (let container = field.parentElement; container && container !== document.body; container = container.parentElement) {
        if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(container).overflowY)) continue;
        const bounds = container.getBoundingClientRect();
        visibleTop = Math.max(visibleTop, bounds.top);
        visibleBottom = Math.min(visibleBottom, bounds.bottom);
      }
      if (rect.top < visibleTop + 8 || rect.bottom > visibleBottom - 8) {
        // Centre the field in the part of the screen the keyboard leaves visible. scrollIntoView
        // centres it in the layout viewport instead, which on iOS sits partly under the keyboard,
        // so iOS panned back, we scrolled again, and the page shook. Scroll each container only as
        // far as it can go, so a field that is already as visible as it can be stays put.
        let remaining = Math.round((rect.top + rect.bottom) / 2 - (visibleTop + visibleBottom) / 2);
        for (let container = field.parentElement; container && remaining; container = container.parentElement) {
          const page = container === document.body;
          const scroller = page ? document.scrollingElement ?? root : container;
          if (!page && !/^(auto|scroll)$/.test(getComputedStyle(container).overflowY)) continue;
          const before = scroller.scrollTop;
          scroller.scrollTop = before + remaining;
          remaining -= scroller.scrollTop - before;
          if (page || container instanceof HTMLDialogElement) break;
        }
      }
    }

    function scheduleReveal() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    }

    function onFocus() {
      scrollUntil = 0;
      touch = undefined;
      scheduleReveal();
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const field = activeTextEntry();
      const control = target.closest("label") as HTMLLabelElement | null;
      if (isTextEntry(target) || isTextEntry(control?.control ?? null)) {
        scheduleReveal();
      } else if (!(target instanceof HTMLDialogElement) && !target.closest(optionsSelector)) {
        field?.blur();
      }
    }

    function onEnter(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
      const field = activeTextEntry();
      if (!(field instanceof HTMLInputElement) || field !== event.target || field.form) return;
      if (field.enterKeyHint === "done") {
        field.blur();
      } else if (field.enterKeyHint === "next") {
        const group = field.closest("dialog, main");
        if (!group) return;
        const fields = Array.from(group.querySelectorAll<HTMLInputElement>('input[enterkeyhint="next"]'));
        const next = fields.slice(fields.indexOf(field) + 1).find((input) =>
          isTextEntry(input) && input.getClientRects().length > 0,
        );
        if (next) next.focus();
        else field.blur();
      }
    }

    function onTouchStart(event: TouchEvent) {
      const start = event.touches[0];
      touch = event.touches.length === 1 && activeTextEntry() &&
        event.target instanceof Element && !event.target.closest(optionsSelector)
        ? { id: start.identifier, x: start.clientX, y: start.clientY }
        : undefined;
    }

    function onTouchMove(event: TouchEvent) {
      const move = event.touches[0];
      if (!touch || event.touches.length !== 1 || move.identifier !== touch.id) return;
      if (Math.hypot(move.clientX - touch.x, move.clientY - touch.y) > 10) {
        scrollUntil = performance.now() + scrollIntentMs;
      }
    }

    function onWheel(event: WheelEvent) {
      if ((event.deltaX || event.deltaY) && !event.ctrlKey && event.target instanceof Element && !event.target.closest(optionsSelector)) {
        scrollUntil = performance.now() + scrollIntentMs;
      }
    }

    function onScroll(event: Event) {
      const field = activeTextEntry();
      if (!field || performance.now() >= scrollUntil || event.target === field) return;
      if (event.target instanceof Element && event.target.closest(optionsSelector)) return;
      scrollUntil = 0;
      field.blur();
    }

    function onViewportScroll(event: Event) {
      onScroll(event);
      if (keyboardOpen) scheduleReveal();
    }

    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", scheduleReveal);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onEnter);
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, true);
    viewport?.addEventListener("resize", scheduleReveal);
    viewport?.addEventListener("scroll", onViewportScroll);
    scheduleReveal();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", scheduleReveal);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onEnter);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("scroll", onScroll, true);
      viewport?.removeEventListener("resize", scheduleReveal);
      viewport?.removeEventListener("scroll", onViewportScroll);
      root.style.removeProperty("--keyboard-top");
      root.style.removeProperty("--keyboard-bottom");
      root.style.removeProperty("--keyboard-height");
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
