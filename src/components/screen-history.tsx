"use client";

import { Activity, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type ScrollPosition = {
  x: number;
  y: number;
  containers: { node: Element; left: number; top: number }[];
  focus: HTMLElement | null;
};

export function captureScreen(root?: HTMLElement | null): ScrollPosition {
  const active = document.activeElement;
  return {
    x: window.scrollX,
    y: window.scrollY,
    containers: [...(root?.querySelectorAll("*") ?? [])].flatMap((node) => {
      const { scrollLeft: left, scrollTop: top } = node;
      return left || top ? [{ node, left, top }] : [];
    }),
    focus: active instanceof HTMLElement && root?.contains(active) ? active : null,
  };
}

export function restoreScreen(position?: ScrollPosition) {
  window.scrollTo({ left: position?.x ?? 0, top: position?.y ?? 0, behavior: "instant" });
  for (const { node, left, top } of position?.containers ?? []) {
    if (node.isConnected) node.scrollTo({ left, top, behavior: "instant" });
  }
  if (position?.focus?.matches("button, a[href], [tabindex]:not(input, textarea, select)") &&
      position.focus.isConnected) {
    position.focus.focus({ preventScroll: true });
  }
}

type Entry<T> = {
  id: string;
  screen: T;
  root?: HTMLElement;
  position?: ScrollPosition;
};

type Stack<T> = { entries: Entry<T>[]; index: number };

function writeEntry(id: string, replace: boolean) {
  // The register can reconnect before Next installs its History API wrappers.
  // These are same-URL entries, so carry over the current route's metadata.
  const state = { ...history.state, posScreen: id };
  if (replace) history.replaceState(state, "");
  else history.pushState(state, "");
}

export function useScreenHistory<T>(initial: T) {
  const [stack, setStack] = useState<Stack<T>>(() => ({
    entries: [{ id: "initial", screen: initial }], index: 0,
  }));
  const latest = useRef(stack);
  const goingBack = useRef(false);
  const update = useCallback((next: Stack<T>) => {
    latest.current = next;
    setStack(next);
  }, []);

  const reset = useCallback((screen: T) => {
    const entry = { id: crypto.randomUUID(), screen };
    goingBack.current = false;
    writeEntry(entry.id, true);
    update({ entries: [entry], index: 0 });
  }, [update]);

  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const onPop = (event: PopStateEvent) => {
      goingBack.current = false;
      const { entries, index } = latest.current;
      const nextIndex = entries.findIndex((entry) => entry.id === event.state?.posScreen);
      if (nextIndex === -1) {
        // An older register session may still have entries in this browser tab.
        // Start a new stack here without bringing that session's screens back.
        const current = entries[index];
        writeEntry(current.id, true);
        update({ entries: [current], index: 0 });
        return;
      }
      if (nextIndex === index) return;
      entries[index].position = captureScreen(entries[index].root);
      update({ entries, index: nextIndex });
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      history.scrollRestoration = previousRestoration;
    };
  }, [update]);

  function open(screen: T, { from, replace = false }: { from?: string; replace?: boolean } = {}) {
    const { entries, index } = latest.current;
    const current = entries[index];
    if (goingBack.current || (from && from !== current.id)) return;
    current.position = captureScreen(current.root);
    const entry = { id: crypto.randomUUID(), screen };
    writeEntry(entry.id, replace);
    if (replace) {
      // A replacement keeps the browser's forward entries intact.
      update({ entries: entries.map((existing, i) => i === index ? entry : existing), index });
    } else {
      update({ entries: [...entries.slice(0, index + 1), entry], index: index + 1 });
    }
  }

  function back(from: string) {
    const { entries, index } = latest.current;
    if (index === 0 || entries[index].id !== from || goingBack.current) return;
    goingBack.current = true;
    history.back();
  }

  return { ...stack, current: stack.entries[stack.index], reset, open, back };
}

export function HistoryScreen<T>({ entry, active, children }: {
  entry: Entry<T>;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <ScreenContent entry={entry}>{children}</ScreenContent>
    </Activity>
  );
}

function ScreenContent<T>({ entry, children }: { entry: Entry<T>; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    entry.root = node;
    node.dataset.activeScreen = "";
    restoreScreen(entry.position);
    return () => {
      entry.root = undefined;
      delete node.dataset.activeScreen;
    };
  }, [entry]);
  return <main ref={root}>{children}</main>;
}
