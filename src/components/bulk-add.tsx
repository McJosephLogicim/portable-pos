"use client";

import { useState, type ReactNode } from "react";
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
