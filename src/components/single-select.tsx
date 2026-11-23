"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useAnchoredList } from "./combobox";
import { fold, RecordSearch, SEARCH_FROM } from "./records";
import { buzz } from "./ui";

type Option<Id extends string> = {
  id: Id;
  name: string;
  detail?: string;
  searchText?: string;
  icon?: ReactNode;
};

export function SingleSelect<Id extends string>({ label, searchNoun, items, value, onChange, disabled }: {
  label: string;
  searchNoun: string;
  items: Option<Id>[];
  value?: Id;
  onChange: (value: Id) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === value);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const shown = words.length ? items.filter((item) => {
    const text = fold([item.name, item.detail, item.searchText].filter(Boolean).join(" "));
    return words.every((word) => text.includes(word));
  }) : items;

  useAnchoredList(trigger, popup, open, shown.length);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    }
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [close, open]);

  function moveFocus(from: EventTarget, direction: number) {
    const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const current = options.findIndex((option) => option === from);
    const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) : current + direction;
    if (next < 0) popup.current?.querySelector("input")?.focus({ preventScroll: true });
    else {
      const option = options[next];
      option?.focus({ preventScroll: true });
      option?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || disabled || !items.length) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      trigger.current?.focus({ preventScroll: true });
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const from = event.target;
      if (!open) {
        setOpen(true);
        requestAnimationFrame(() => moveFocus(from, direction));
      } else moveFocus(from, direction);
    }
  }

  return (
    <div className="stack gap-6">
      <span className="label">{label}</span>
      <div ref={root} className={`suggest${open ? " open" : ""}`} onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
        }}>
        <div className="chips filter-chips">
          <button type="button" ref={trigger} className="filter-open select-pill" aria-haspopup="listbox"
            aria-expanded={open} aria-controls={open ? listId : undefined}
            aria-label={selected ? `${label}: ${selected.name}` : label} disabled={disabled || !items.length}
            onClick={() => open ? close() : setOpen(true)}>
            {selected?.icon}
            <span className="ellipsis">{selected?.name ?? (items.length ? `Select ${label.toLowerCase()}` : `No ${searchNoun} available`)}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
        {open && (
          <div ref={popup} className="combo-list combo-drop select-dropdown" data-input-options="">
            {items.length >= SEARCH_FROM && (
              <RecordSearch count={items.length} noun={searchNoun} query={query} onQuery={(text) => {
                setQuery(text);
                if (list.current) list.current.scrollTop = 0;
              }} />
            )}
            <div ref={list} id={listId} className="select-dropdown-options" role="listbox" aria-label={label}>
              {shown.map((item) => (
                <button key={item.id} type="button" role="option" tabIndex={-1} aria-selected={item.id === value}
                  className="combo-row combo-pick" onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    buzz.tap();
                    onChange(item.id);
                    trigger.current?.focus({ preventScroll: true });
                    close();
                  }}>
                  {item.icon}
                  <span className="grow stack">
                    <span className="ellipsis">{item.name}</span>
                    {item.detail && <span className="label ellipsis">{item.detail}</span>}
                  </span>
                  {item.id === value && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
            {!shown.length && <p className="combo-foot label" role="status">No matches found</p>}
          </div>
        )}
      </div>
    </div>
  );
}
