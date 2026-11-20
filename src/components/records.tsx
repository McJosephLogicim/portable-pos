"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react";
import { buzz, CategoryTabs, ConfirmSheet, EmptyState, errorText, Sheet } from "./ui";
import { collapseOnExit, fadeOnExit } from "@/lib/exit";
import { blocked, refusal, type Reason } from "@/lib/reject";

/*
 * One way to keep a list of things in Settings: menu items, categories, choices, stock items
 * and organizers. A page lists them in white cards. Tapping a row opens a sheet that edits
 * that one thing and saves it right away. The same sheet, empty, adds a new one.
 */

/** Lists this long get a search field. */
export const SEARCH_FROM = 6;

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();

/** Whether every word typed appears somewhere in these texts, ignoring case and accents. */
export function matches(query: string, ...texts: (string | undefined | false)[]) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(texts.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/**
 * Search and optional filter tabs above a Settings list. By default the search field
 * appears once the list reaches SEARCH_FROM.
 */
export function RecordSearch({
  count,
  noun,
  query,
  onQuery,
  filters,
  alwaysSearch,
}: {
  /** How many things the page lists, before searching. */
  count: number;
  /** "items", "people"… */
  noun: string;
  query: string;
  onQuery: (query: string) => void;
  alwaysSearch?: boolean;
  filters?: {
    label: string;
    options: string[];
    value: string | null;
    onChange: (value: string | null) => void;
    onNew?: () => void;
    newDisabled?: boolean;
  };
}) {
  const search = alwaysSearch || count >= SEARCH_FROM || query !== "";
  if (!search && !filters) return null;
  return (
    <>
      {search && (
        <div className="search-field record-search">
          <Search size={18} aria-hidden="true" />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            aria-label={"Search " + noun}
            placeholder={"Search " + noun}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="combo-clear" aria-label="Clear search" onClick={() => onQuery("")}>
              <X size={18} />
            </button>
          )}
        </div>
      )}
      {filters && (
        <CategoryTabs
          label={filters.label}
          categories={filters.options}
          value={filters.value}
          onChange={filters.onChange}
          onNew={filters.onNew}
          newDisabled={filters.newDisabled}
        />
      )}
    </>
  );
}

/** What a list shows when search or a filter leaves nothing. */
export function RecordNoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={<Search size={22} />}
      title={query.trim() ? `Nothing matches “${query.trim()}”` : "Nothing here"}
      text="Try another name, or see everything."
    >
      <button type="button" className="btn ghost compact" onClick={onClear}>
        Show all
      </button>
    </EmptyState>
  );
}

/** A titled white card of rows. */
export function RecordGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="stack gap-10">
      {title && <p className="group-title">{title}</p>}
      <div className="card card-list">{children}</div>
    </div>
  );
}

/** How a row behaves while its list is in Select mode. */
export type RowSelect = { on: boolean; picked: boolean; toggle: () => void; start: () => void };

/** Held this long, a row starts Select mode with itself picked. */
const HOLD_MS = 450;

/**
 * One thing in a list: what it is, a line about it, a value at the end and a chevron.
 * With `select`, holding the row starts Select mode, and in Select mode a tap picks it.
 */
export function RecordRow({
  lead,
  title,
  detail,
  end,
  onClick,
  disabled,
  select,
}: {
  lead: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  end?: ReactNode;
  onClick: () => void;
  disabled?: boolean | Reason;
  select?: RowSelect;
}) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const selecting = Boolean(select?.on);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  useEffect(() => cancelHold, []);
  function startSelect() {
    if (!select || select.on) return;
    buzz.tick();
    select.start();
  }
  return (
    <button
      className={"list-row record-row" + (selecting ? " selecting" : "")}
      {...blocked(refusal(disabled))}
      aria-pressed={selecting ? select!.picked : undefined}
      ref={collapseOnExit}
      onPointerDown={(e) => {
        cancelHold();
        hold.current = null;
        if (!select || selecting || disabled || !e.isPrimary || e.button !== 0 || e.pointerType === "mouse") return;
        const state = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
        state.timer = window.setTimeout(() => {
          state.fired = true;
          startSelect();
        }, HOLD_MS);
        hold.current = state;
      }}
      onPointerMove={(e) => {
        const h = hold.current;
        if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => {
        // A held row (or a right-click) starts selecting instead of opening the phone's menu.
        if (!select) return;
        e.preventDefault();
        cancelHold();
        if (!hold.current?.fired) startSelect();
        hold.current = { timer: 0, x: 0, y: 0, fired: true };
      }}
      onClick={() => {
        if (hold.current?.fired) {
          hold.current = null;
          return;
        }
        hold.current = null;
        if (selecting) {
          buzz.tap();
          select!.toggle();
        } else onClick();
      }}
    >
      {lead}
      <span className="grow stack">
        <span className="ellipsis">{title}</span>
        {detail && <span className="label ellipsis">{detail}</span>}
      </span>
      {end !== undefined && <span className="record-end">{end}</span>}
      {selecting ? (
        <span className={"tick" + (select!.picked ? " on" : "")} aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
      ) : (
        <ChevronRight size={18} className="chev" />
      )}
    </button>
  );
}

/** Which rows of a list are picked in Select mode. `keys` are the rows that still exist. */
export function useRecordSelect(keys: string[]) {
  const [on, setOn] = useState(false);
  const [raw, setRaw] = useState<string[]>([]);
  const live = new Set(keys);
  const picked = raw.filter((k) => live.has(k));
  // The action bar takes the tab bar's place while selecting.
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.dataset.selecting = "";
    return () => {
      delete root.dataset.selecting;
    };
  }, [on]);
  const start = (key?: string) => {
    setOn(true);
    setRaw(key ? [key] : []);
  };
  const toggle = (key: string) => setRaw((all) => (all.includes(key) ? all.filter((k) => k !== key) : [...all, key]));
  return {
    on,
    picked,
    start,
    done: () => {
      setOn(false);
      setRaw([]);
    },
    set: setRaw,
    row: (key: string): RowSelect => ({ on, picked: picked.includes(key), toggle: () => toggle(key), start: () => start(key) }),
  };
}
export type RecordSelection = ReturnType<typeof useRecordSelect>;

/** "Select" beside the page title, "Done" while selecting. */
export function RecordSelectToggle({ select, disabled }: { select: RecordSelection; disabled?: boolean | Reason }) {
  return (
    <button
      type="button"
      className="btn ghost small select-toggle"
      {...blocked(!select.on && refusal(disabled))}
      onClick={() => (select.on ? select.done() : select.start())}
    >
      {select.on ? "Done" : "Select"}
    </button>
  );
}

/**
 * Floats where the tab bar was while a list is in Select mode: how many are picked, Select all,
 * and what can be done to all of them at once. Removing always asks first.
 */
export function RecordSelectBar({
  select,
  shown,
  noun,
  nouns = noun + "s",
  onEdit,
  removeDetail,
  onRemove,
}: {
  select: RecordSelection;
  /** The keys of the rows on screen now, for Select all. */
  shown: string[];
  noun: string;
  nouns?: string;
  onEdit?: () => void;
  /** What removing the picked ones does, in a sentence. */
  removeDetail: (picked: string[]) => string;
  onRemove: (picked: string[]) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const count = select.picked.length;
  const all = shown.length > 0 && shown.every((k) => select.picked.includes(k));
  const what = plural(count, noun, nouns);
  return (
    <>
      <div className="select-bar" role="region" aria-label="Selected" ref={fadeOnExit}>
        <div className="select-bar-top">
          <span className="strong" aria-live="polite">
            {count ? what + " selected" : "Tap " + nouns + " to select"}
          </span>
          <button
            type="button"
            className="btn ghost small"
            disabled={!shown.length}
            onClick={() => select.set(all ? select.picked.filter((k) => !shown.includes(k)) : [...new Set([...select.picked, ...shown])])}
          >
            {all ? "Clear" : "Select all"}
          </button>
        </div>
        <div className={onEdit ? "grid-2" : "stack"}>
          {onEdit && (
            <button type="button" className="btn" aria-label={"Edit " + what} {...blocked(!count && `Tap ${nouns} to select them first.`)} onClick={onEdit}>
              <Pencil size={16} /> Edit
            </button>
          )}
          <button
            type="button"
            className={"btn secondary danger-text" + (onEdit ? "" : " block")}
            aria-label={"Remove " + what}
            {...blocked(!count && `Tap ${nouns} to select them first.`)}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={16} /> Remove
          </button>
        </div>
      </div>
      {confirming && (
        <ConfirmSheet
          title={"Remove " + what + "?"}
          detail={removeDetail(select.picked)}
          confirmLabel="Remove"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const done = await onRemove(select.picked);
            if (done) select.done();
            return done;
          }}
        />
      )}
    </>
  );
}


/** Saves from a sheet: shows the error, keeps the sheet open on failure, closes it on success. */
export function useRecordSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    setError("");
    try {
      if (await fn()) onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** The sheet that adds or edits one thing, with the same footer everywhere. */
export function RecordSheet({
  noun,
  editing,
  busy,
  error,
  canSave,
  saveLabel,
  saveText,
  onSave,
  removeLabel,
  removeDetail,
  onRemove,
  onClose,
  help,
  title,
  children,
}: {
  /** "item", "category", "stock item"… */
  noun: string;
  /** Instead of "Edit item" or "New item". */
  title?: string;
  editing: boolean;
  busy: boolean;
  error: string;
  canSave: boolean;
  saveLabel?: string;
  /** The Save button's text, like "Add 4 items". */
  saveText?: string;
  onSave: () => void;
  removeLabel?: string;
  removeDetail?: string;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
  /** How this record works, behind an (i) beside the sheet title. */
  help?: ReactNode;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = removeLabel ?? "Remove " + noun;
  return (
    <>
    <Sheet
      title={title ?? (editing ? "Edit " : "New ") + noun}
      onClose={onClose}
      help={help}
      busy={busy}
      footer={
        <>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button className="btn block" aria-label={saveLabel ?? (editing ? "Save " : "Add ") + noun} disabled={busy || !canSave} onClick={onSave}>
            {busy ? "Saving…" : saveText ?? (editing ? "Save" : "Add")}
          </button>
          {editing && onRemove && (
            <button className="btn ghost danger compact block" aria-label={remove} disabled={busy} onClick={() => setConfirming(true)}>
              <Trash2 size={16} /> Remove
            </button>
          )}
        </>
      }
    >
      {children}
    </Sheet>
    {confirming && onRemove && (
      <ConfirmSheet
        title={remove + "?"}
        detail={removeDetail ?? `This will remove this ${noun} for your business.`}
        confirmLabel="Remove"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          const done = await onRemove();
          if (done) onClose();
          return done;
        }}
      />
    )}
    </>
  );
}

export function plural(n: number, one: string, many = one + "s") {
  return n + " " + (n === 1 ? one : many);
}

/** "Iced latte, Mocha and 3 more" */
export function namesText(names: string[], max = 2) {
  if (names.length <= max) return names.join(", ");
  return names.slice(0, max).join(", ") + " and " + (names.length - max) + " more";
}

/** "Iced latte and Mocha", "Iced latte, Mocha, Ube and 3 more": for sentences. */
export function andText(names: string[], max = 3) {
  if (names.length > max) return namesText(names, max);
  if (names.length < 2) return names.join("");
  return names.slice(0, -1).join(", ") + " and " + names.at(-1);
}
