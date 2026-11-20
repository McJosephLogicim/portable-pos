"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus, Search, Trash2, X } from "lucide-react";
import { CategoryTabs, ConfirmSheet, errorText, Sheet } from "./ui";
import { collapseOnExit } from "@/lib/exit";

/*
 * One way to keep a list of things in Settings: menu items, categories, choices, stock items
 * and organizers. A page lists them in white cards. Tapping a row opens a sheet that edits
 * that one thing and saves it right away. The same sheet, empty, adds a new one.
 */

export function RecordAdd({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="btn" disabled={disabled} onClick={onClick}>
      <Plus size={18} /> {label}
    </button>
  );
}

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
    <div className="card empty">
      <span className="strong">{query.trim() ? `Nothing matches “${query.trim()}”` : "Nothing here"}</span>
      <span className="label">Try another name, or see everything.</span>
      <button type="button" className="btn ghost small" onClick={onClear}>
        Show all
      </button>
    </div>
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

/** One thing in a list: what it is, a line about it, a value at the end and a chevron. */
export function RecordRow({
  lead,
  title,
  detail,
  end,
  onClick,
  disabled,
}: {
  lead: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  end?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="list-row record-row" disabled={disabled} onClick={onClick} ref={collapseOnExit}>
      {lead}
      <span className="grow stack">
        <span className="ellipsis">{title}</span>
        {detail && <span className="label ellipsis">{detail}</span>}
      </span>
      {end !== undefined && <span className="record-end">{end}</span>}
      <ChevronRight size={18} className="chev" />
    </button>
  );
}

/** What a list shows before anything is in it. */
export function RecordEmpty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="card empty">
      <span className="well">{icon}</span>
      <span className="strong">{title}</span>
      <span className="label" style={{ maxWidth: 300 }}>
        {text}
      </span>
    </div>
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
  onSave,
  removeLabel,
  removeDetail,
  onRemove,
  onClose,
  help,
  children,
}: {
  /** "item", "category", "stock item"… */
  noun: string;
  editing: boolean;
  busy: boolean;
  error: string;
  canSave: boolean;
  saveLabel?: string;
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
      title={(editing ? "Edit " : "New ") + noun}
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
          <button className="btn block" disabled={busy || !canSave} onClick={onSave}>
            {busy ? "Saving…" : (saveLabel ?? (editing ? "Save " : "Add ") + noun)}
          </button>
          {editing && onRemove && (
            <button className="btn ghost danger compact block" disabled={busy} onClick={() => setConfirming(true)}>
              <Trash2 size={16} /> {remove}
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
        confirmLabel={remove}
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
