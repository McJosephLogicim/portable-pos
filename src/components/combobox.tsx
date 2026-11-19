"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";

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
  newText?: string | false;
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
          {newText && q && !suggestions.some((s) => s.name.toLocaleLowerCase() === q) && (
            <p className="combo-foot label">
              <Plus size={14} /> {newText} “{value.trim()}”. Keep typing to add it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
