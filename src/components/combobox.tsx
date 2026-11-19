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
