"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

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
  const [editing, setEditing] = useState(false);
  const q = value.trim().toLocaleLowerCase();
  const hasMatch = suggestions.some((s) => s.name.toLocaleLowerCase() === q);
  const search = editing || !hasMatch ? q : "";
  const shown = suggestions
    .filter((s) => s.name.toLocaleLowerCase() !== search || s.detail)
    .filter((s) => !search || s.name.toLocaleLowerCase().includes(search));
  const visible = open && shown.length > 0;
  const activeSuggestion = visible ? shown[active] : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  useFloatingList(inputRef, listRef, visible, shown.length);

  useLayoutEffect(() => {
    const option = activeRef.current;
    const list = listRef.current;
    if (!option || !list) return;
    const row = option.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
    else if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
  }, [activeSuggestion]);

  function close() {
    setOpen(false);
    setActive(-1);
    setEditing(false);
  }

  function pick(s: Suggestion) {
    if (onPick) onPick(s);
    else onChange(s.name);
    close();
  }

  return (
    <div className={"suggest " + className}>
      <input
        id={id}
        ref={inputRef}
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={visible}
        aria-controls={visible ? id + "-list" : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeSuggestion ? `${id}-s${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || !shown.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (e.key === "ArrowDown") setActive(Math.min(shown.length - 1, (activeSuggestion ? active : -1) + 1));
            else setActive(activeSuggestion ? Math.max(0, active - 1) : shown.length - 1);
          } else if (e.key === "Enter" && activeSuggestion) {
            e.preventDefault();
            pick(activeSuggestion);
          } else if (e.key === "Escape" && visible) {
            e.stopPropagation();
            e.preventDefault();
            close();
          }
        }}
      />
      {shown.length > 0 && <ChevronDown aria-hidden="true" className="suggest-chevron" size={16} />}
      {visible && (
        <div
          ref={listRef}
          className="combo-list combo-float card"
          id={id + "-list"}
          role="listbox"
          aria-label={label}
          data-input-options=""
          popover="manual"
        >
          <p className="combo-head" aria-hidden="true">{search ? "Matches" : "Suggestions"}</p>
          {shown.map((s, i) => (
            <button
              key={s.key}
              type="button"
              id={`${id}-s${i}`}
              ref={i === active ? activeRef : undefined}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={"combo-row combo-pick" + (i === active ? " active" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(event) => {
                pick(s);
                if (event.detail > 0) inputRef.current?.blur();
              }}
            >
              <span className="grow stack">
                <span className="ellipsis">{s.name}</span>
                {s.detail && <span className="label ellipsis">{s.detail}</span>}
              </span>
            </button>
          ))}
          {newText && q && !hasMatch && (
            <p className="combo-foot label">
              <Plus size={14} aria-hidden="true" /> {newText} “{value.trim()}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const GAP = 4;
const EDGE = 8;
const MAX = 280;

/**
 * Keep the list anchored in the visible viewport, including when a keyboard is open.
 */
function useFloatingList(
  inputRef: React.RefObject<HTMLInputElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
  rows: number,
) {
  const update = useCallback(() => {
    const input = inputRef.current;
    const list = listRef.current;
    if (!input || !list) return;
    const r = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? document.documentElement.clientHeight);
    const below = bottom - r.bottom - GAP - EDGE;
    const above = r.top - top - GAP - EDGE;
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    const flip = below < Math.min(MAX, list.scrollHeight) && above > below;
    const room = Math.max(0, Math.min(MAX, flip ? above : below));
    list.style.visibility = room < 44 || r.bottom <= top || r.top >= bottom || clipped(input, r) ? "hidden" : "";
    list.style.maxHeight = `${room}px`;
    list.style.top = `${flip ? r.top - GAP - Math.min(list.scrollHeight, room) : r.bottom + GAP}px`;
  }, [inputRef, listRef]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!visible || !list) return;
    if (typeof list.showPopover === "function" && !list.matches(":popover-open")) {
      try {
        list.showPopover();
      } catch {
        // Not connected yet or already shown; the fixed position still works.
      }
    }
    update();
  }, [listRef, rows, update, visible]);

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const vv = window.visualViewport;
    const input = inputRef.current;
    const dialog = input?.closest("dialog");
    const observer = new ResizeObserver(schedule);
    if (input) observer.observe(input);
    if (dialog) observer.observe(dialog);
    dialog?.addEventListener("animationend", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dialog?.removeEventListener("animationend", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
    };
  }, [inputRef, visible, update]);
}

/** True once the field has scrolled out of a box that clips it, like a sheet's body. */
function clipped(input: HTMLElement, r: DOMRect): boolean {
  for (let el = input.parentElement; el && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "visible") continue;
    const box = el.getBoundingClientRect();
    if (r.bottom <= box.top || r.top >= box.bottom) return true;
  }
  return false;
}
