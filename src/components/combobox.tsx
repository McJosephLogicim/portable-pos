"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { fadeOnExit } from "@/lib/exit";

export interface Suggestion {
  key: string;
  name: string;
  /** A second line, such as what picking it brings along. */
  detail?: string;
  searchText?: string;
  icon?: ReactNode;
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
  onDismiss,
  label,
  placeholder,
  maxLength = 60,
  autoFocus,
  inFlow = false,
  disabled,
  className = "",
  newText = "New",
}: {
  value: string;
  suggestions: Suggestion[];
  onChange: (text: string) => void;
  /** Called when a suggestion is picked; defaults to filling in its name. */
  onPick?: (s: Suggestion) => void;
  onDismiss?: () => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** Reserve space in the form for the dropdown when it opens. */
  inFlow?: boolean;
  disabled?: boolean;
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
    .filter((s) => newText === false || s.name.toLocaleLowerCase() !== search || s.detail)
    .filter((s) => {
      if (!search) return true;
      const text = s.searchText ? `${s.name} ${s.searchText}`.toLocaleLowerCase() : s.name.toLocaleLowerCase();
      return text.includes(search);
    });
  const visible = !disabled && open && shown.length > 0;
  const activeSuggestion = visible ? shown[active] : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const setListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    const exit = fadeOnExit(node);
    return () => {
      listRef.current = null;
      exit?.();
    };
  }, []);
  const activeRef = useRef<HTMLButtonElement>(null);
  useAnchoredList(inputRef, listRef, visible, shown.length);

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

  function dismiss() {
    close();
    onDismiss?.();
  }

  return (
    <div className={`suggest${visible ? " open" : ""}${inFlow ? " in-flow" : ""} ${className}`}>
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
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onFocus={() => { if (!inFlow) setOpen(true); }}
        onClick={() => setOpen(true)}
        onBlur={dismiss}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape" && (visible || (open && onDismiss))) {
            e.stopPropagation();
            e.preventDefault();
            dismiss();
            return;
          }
          if (!shown.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            if (e.key === "ArrowDown") setActive(Math.min(shown.length - 1, (activeSuggestion ? active : -1) + 1));
            else setActive(activeSuggestion ? Math.max(0, active - 1) : shown.length - 1);
          } else if (e.key === "Enter" && activeSuggestion) {
            e.preventDefault();
            pick(activeSuggestion);
          }
        }}
      />
      {shown.length > 0 && <ChevronDown aria-hidden="true" className="suggest-chevron" size={16} />}
      {visible && (
        <div
          ref={setListRef}
          className="combo-list combo-drop"
          id={id + "-list"}
          role="listbox"
          aria-label={label}
          data-input-options=""
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
              {s.icon}
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

const MAX = 240;
const MIN = 104;
const EDGE = 8;

/**
 * The list sits in the form's own flow, absolutely positioned right under its field, so it
 * scrolls with the field and the keyboard can't pull them apart. When there isn't room under
 * the field, the field's scroll box scrolls up to make room; the list never moves above it.
 */
function useAnchoredList(
  inputRef: React.RefObject<HTMLInputElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
  rows: number,
) {
  const fit = useCallback(() => {
    const input = inputRef.current;
    const list = listRef.current;
    if (!input || !list) return;
    list.style.maxHeight = `${MAX}px`;
    const box = scrollBox(input);
    const vv = window.visualViewport;
    let top = vv?.offsetTop ?? 0;
    let bottom = top + (vv?.height ?? document.documentElement.clientHeight);
    if (box && box !== document.scrollingElement) {
      const area = box.getBoundingClientRect();
      top = Math.max(top, area.top);
      bottom = Math.min(bottom, area.bottom);
    }
    const field = input.getBoundingClientRect();
    const end = list.getBoundingClientRect().bottom;
    const short = end + EDGE - bottom;
    if (short > 0 && box) {
      // Scroll up only as far as keeps the field itself in view.
      const step = Math.min(short, Math.max(0, field.top - top - EDGE));
      if (step > 0) box.scrollTop += step;
    }
    const room = bottom - list.getBoundingClientRect().top - EDGE;
    list.style.maxHeight = `${Math.max(MIN, Math.min(MAX, room))}px`;
  }, [inputRef, listRef]);

  // Wait a frame: scrolling during the tap that focused the field would move the tap target.
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [visible, rows, fit]);

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    // The keyboard opening and the page revealing the field both land after focus.
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", later);
    window.addEventListener("resize", later);
    const timer = window.setTimeout(fit, 320);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      vv?.removeEventListener("resize", later);
      window.removeEventListener("resize", later);
    };
  }, [visible, fit]);
}

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(p).overflowY)) return p;
  }
  return document.scrollingElement as HTMLElement | null;
}
