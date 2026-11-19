"use client";

import { useId, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Tag } from "@/lib/types";

/**
 * Pick one name from a list, add a new one by typing it, or remove one from the list,
 * all in the same field.
 */
export function Combobox({
  label,
  options,
  value,
  placeholder,
  disabled,
  hint,
  onChange,
  onCreate,
  onRemove,
}: {
  label: string;
  options: Tag[];
  value: Tag | null;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  onChange: (tag: Tag | null) => void;
  onCreate: (name: string) => Tag;
  onRemove: (tag: Tag) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const typed = text.trim();
  const q = typed.toLocaleLowerCase();
  const shown = options.filter((o) => !q || o.name.toLocaleLowerCase().includes(q));
  const exact = options.find((o) => o.name.toLocaleLowerCase() === q);
  const canCreate = typed.length > 0 && !exact;
  const rows = shown.length + (canCreate ? 1 : 0);

  function pick(tag: Tag | null) {
    onChange(tag);
    setText("");
    setOpen(false);
  }
  function create() {
    if (!canCreate) return;
    pick(onCreate(typed.slice(0, 80)));
  }

  return (
    <div className="field combo">
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <div className="combo-box">
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-autocomplete="list"
          aria-activedescendant={open && rows ? `${id}-o${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={value ? value.name : placeholder}
          value={open ? text : value?.name ?? ""}
          onFocus={() => {
            setOpen(true);
            setText("");
            setActive(0);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.parentElement?.contains(e.relatedTarget as Node)) setOpen(false);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(rows - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active < shown.length) pick(shown[active]);
              else create();
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        {value && !open && !disabled && (
          <button type="button" className="combo-clear" aria-label={"Clear " + label} onClick={() => onChange(null)}>
            <X size={16} />
          </button>
        )}
      </div>
      {open && (
        <div className="combo-list card" id={id + "-list"} role="listbox" aria-label={label}>
          {shown.map((o, i) => (
            <div
              key={o.id}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={value?.id === o.id}
              className={"combo-row" + (i === active ? " active" : "")}
            >
              <button type="button" className="grow combo-pick" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                <span className="ellipsis">{o.name}</span>
                {value?.id === o.id && <Check size={16} />}
              </button>
              <button
                type="button"
                className="round flat combo-remove"
                aria-label={"Remove " + o.name + " from the list"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onRemove(o);
                  if (value?.id === o.id) onChange(null);
                }}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          {canCreate && (
            <button
              type="button"
              id={`${id}-o${shown.length}`}
              role="option"
              aria-selected={false}
              className={"combo-row combo-add" + (active === shown.length ? " active" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={create}
            >
              <Plus size={16} /> Add “{typed}”
            </button>
          )}
          {!rows && <p className="label" style={{ padding: "12px 14px" }}>Type a name to add one.</p>}
        </div>
      )}
      {hint && !open && <p className="label">{hint}</p>}
    </div>
  );
}

export interface Suggestion {
  key: string;
  name: string;
  /** A second line, such as what picking it brings along. */
  detail?: string;
}

/**
 * A text field that offers what was typed before, so a category, a choice or an option is
 * picked once and reused instead of retyped. Typing something new still works.
 */
export function SuggestInput({
  value,
  suggestions,
  onChange,
  onPick,
  label,
  placeholder,
  maxLength = 60,
  autoFocus,
  className = "",
  newText = "New",
}: {
  value: string;
  suggestions: Suggestion[];
  onChange: (text: string) => void;
  /** Called when a suggestion is picked; defaults to filling in its name. */
  onPick?: (s: Suggestion) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  className?: string;
  newText?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = value.trim().toLocaleLowerCase();
  const shown = suggestions
    .filter((s) => s.name.toLocaleLowerCase() !== q || s.detail)
    .filter((s) => !q || s.name.toLocaleLowerCase().includes(q))
    .slice(0, 8);
  const visible = open && shown.length > 0;

  function pick(s: Suggestion) {
    if (onPick) onPick(s);
    else onChange(s.name);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className={"suggest " + className}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={visible}
        aria-controls={id + "-list"}
        aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${id}-s${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (!visible) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {visible && (
        <div className="combo-list card" id={id + "-list"} role="listbox" aria-label={label}>
          <p className="combo-head">{q ? "Matches" : "Used before"}</p>
          {shown.map((s, i) => (
            <button
              key={s.key}
              type="button"
              id={`${id}-s${i}`}
              role="option"
              aria-selected={i === active}
              className={"combo-row combo-pick" + (i === active ? " active" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              <span className="grow stack">
                <span className="ellipsis">{s.name}</span>
                {s.detail && <span className="label ellipsis">{s.detail}</span>}
              </span>
            </button>
          ))}
          {q && !suggestions.some((s) => s.name.toLocaleLowerCase() === q) && (
            <p className="combo-foot label">
              <Plus size={14} /> {newText} “{value.trim()}”. Keep typing to add it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
