"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { plural, RecordSheet, useRecordSave } from "./records";

export function BulkNamesSheet({
  noun,
  nouns = noun + "s",
  label,
  maxLength,
  limit,
  children,
  onSave,
  onClose,
}: {
  noun: string;
  nouns?: string;
  label: string;
  maxLength: number;
  limit?: number;
  children?: ReactNode;
  onSave: (names: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const names = text.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const { busy, error, run } = useRecordSave(onClose);
  const problem = limit !== undefined && names.length > limit
    ? `You can add up to ${plural(limit, "more " + noun, "more " + nouns)}.`
    : names.some((name) => name.length > maxLength)
      ? `Use no more than ${maxLength} characters per line.`
      : "";
  const saveText = `Add ${plural(names.length, noun, nouns)}`;
  return (
    <RecordSheet
      noun={noun}
      title={`Add ${nouns} in bulk`}
      editing={false}
      busy={busy}
      error={problem || error}
      canSave={names.length > 0 && !problem}
      saveText={names.length ? saveText : "Add"}
      saveLabel={names.length ? saveText : `Add ${nouns}`}
      onSave={() => void run(() => onSave(names))}
      onClose={onClose}
    >
      {children}
      <label className="field">
        <span>{label}</span>
        <textarea className="input" rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
    </RecordSheet>
  );
}

type BatchEditor<T> = {
  rows: T[];
  add: (record: T) => void;
  close: () => void;
};

/** Stage complete records through their regular editors, then save them together. */
export function BulkRecordsSheet<T>({
  noun,
  nouns = noun + "s",
  singleLabel,
  limit,
  nameOf,
  editor,
  onSave,
  onClose,
}: {
  noun: string;
  nouns?: string;
  singleLabel: string;
  limit?: number;
  nameOf: (record: T) => string;
  editor: (input: BatchEditor<T>) => ReactNode;
  onSave: (records: T[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<{ key: string; record: T }[]>([]);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useRecordSave(onClose);
  const count = entries.length;
  const atLimit = limit !== undefined && count >= limit;
  const rows = entries.map(({ record }) => record);
  const saveText = `Add ${plural(count, noun, nouns)}`;
  return (
    <>
      <RecordSheet
        noun={noun}
        title={`Add ${nouns} in bulk`}
        editing={false}
        busy={busy}
        error={error}
        canSave={count > 0 && (limit === undefined || count <= limit)}
        saveText={count ? saveText : "Add"}
        saveLabel={count ? saveText : `Add ${nouns}`}
        onSave={() => void run(() => onSave(rows))}
        onClose={onClose}
      >
        {count === 0 && <p className="label">Build a list and save it together.</p>}
        {count > 0 && (
          <div className="card card-list">
            {entries.map(({ key, record }) => (
              <div key={key} className="list-row">
                <span className="grow">{nameOf(record)}</span>
                <button type="button" className="round flat" disabled={busy} aria-label={`Remove ${nameOf(record)} from batch`} onClick={() => setEntries((all) => all.filter((entry) => entry.key !== key))}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn secondary" disabled={busy || atLimit} onClick={() => setEditing(true)}>
          <Plus size={18} aria-hidden="true" /> {singleLabel}
        </button>
      </RecordSheet>
      {editing && editor({
        rows,
        add: (record) => {
          const key = crypto.randomUUID();
          setEntries((all) => [...all, { key, record }]);
        },
        close: () => setEditing(false),
      })}
    </>
  );
}
