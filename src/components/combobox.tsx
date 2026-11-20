"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const place = useFloatingList(inputRef, listRef, visible);

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
        ref={inputRef}
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
        <div
          ref={listRef}
          className={"combo-list combo-float card " + place}
          id={id + "-list"}
          role="listbox"
          aria-label={label}
          popover="manual"
        >
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

const GAP = 6;
const EDGE = 8;
const MAX = 280;
/** Below this much room under the field, the list opens upward if there is more room above. */
const MIN_BELOW = 168;

/**
 * Keeps the list pinned to its field as an overlay: it sits in the top layer (above open
 * sheets) when the browser supports popovers, follows the field while anything scrolls, and
 * measures against the visual viewport so the on-screen keyboard counts as no room.
 */
function useFloatingList(
  inputRef: React.RefObject<HTMLInputElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
): "below" | "above" {
  const [place, setPlace] = useState<"below" | "above">("below");

  const update = useCallback(() => {
    const input = inputRef.current;
    const list = listRef.current;
    if (!input || !list) return;
    const r = input.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const below = bottom - r.bottom - GAP - EDGE;
    const above = r.top - top - GAP - EDGE;
    const up = below < MIN_BELOW && above > below;
    list.style.visibility = clipped(input, r) ? "hidden" : "";
    const room = Math.max(96, Math.min(MAX, up ? above : below));
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    list.style.maxHeight = `${room}px`;
    if (up) {
      list.style.top = "auto";
      list.style.bottom = `${window.innerHeight - r.top + GAP}px`;
    } else {
      list.style.bottom = "auto";
      list.style.top = `${r.bottom + GAP}px`;
    }
    setPlace(up ? "above" : "below");
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
  });

  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const vv = window.visualViewport;
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
    };
  }, [visible, update]);

  return place;
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
