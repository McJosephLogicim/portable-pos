"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { errorText, Sheet } from "./ui";

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
    <button className="list-row record-row" disabled={disabled} onClick={onClick}>
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
  onRemove?: () => void;
  onClose: () => void;
  /** How this record works, behind an (i) beside the sheet title. */
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
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
            <button className="btn ghost danger compact block" disabled={busy} onClick={onRemove}>
              <Trash2 size={16} /> {removeLabel ?? "Remove " + noun}
            </button>
          )}
        </>
      }
    >
      {children}
    </Sheet>
  );
}

/** Names that pick things on or off, like which menu items use a choice. */
export function PickChips({
  label,
  items,
  picked,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  picked: string[];
  onChange: (picked: string[]) => void;
}) {
  return (
    <div className="chips wrap" role="group" aria-label={label}>
      {items.map((i) => {
        const on = picked.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((x) => x !== i.id) : [...picked, i.id])}
          >
            {i.name}
          </button>
        );
      })}
    </div>
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
