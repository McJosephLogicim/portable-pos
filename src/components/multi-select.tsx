"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, Search, X } from "lucide-react";
import { fold } from "./records";

const RESULTS_PER_PAGE = 24;
const PILLS_PER_PAGE = 12;

type MultiSelectOption = {
  id: string;
  name: string;
  detail?: string;
  searchText?: string;
  count?: number;
  image?: string;
};

function PickerThumbnail({ image, size }: { image?: string; size: number }) {
  const [failed, setFailed] = useState<string>();
  return (
    <span className="picker-thumbnail" style={{ width: size, height: size }} aria-hidden="true">
      {image && failed !== image ? (
        <img src={image} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(image)} />
      ) : (
        <ImageIcon size={Math.round(size / 2)} strokeWidth={1.6} />
      )}
    </span>
  );
}

function pageLabel(page: number, size: number, total: number) {
  return `${(page * size + 1).toLocaleString()}–${Math.min((page + 1) * size, total).toLocaleString()} of ${total.toLocaleString()}`;
}

function PageButtons({ label, page, last, onPage }: {
  label: string;
  page: number;
  last: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="picker-pages" role="group" aria-label={label}>
      <button type="button" className="round flat" aria-label={`Previous ${label}`} disabled={!page} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button type="button" className="round flat" aria-label={`Next ${label}`} disabled={page === last} onClick={() => onPage(page + 1)}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function MultiSelect({ label, placeholder, items, picked, onChange, showThumbnails }: {
  label: string;
  placeholder: string;
  items: MultiSelectOption[];
  picked: string[];
  onChange: (picked: string[]) => void;
  showThumbnails?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pillPage, setPillPage] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const index = useMemo(() => items.map((item) => ({
    item,
    text: fold([item.name, item.detail, item.searchText].filter(Boolean).join(" ")),
  })), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selected = useMemo(() => new Set(picked), [picked]);
  const matches = useMemo(() => {
    const words = fold(query).trim().split(/\s+/).filter(Boolean);
    return words.length ? index.filter(({ text }) => words.every((word) => text.includes(word))) : index;
  }, [index, query]);
  const lastPage = Math.max(0, Math.ceil(matches.length / RESULTS_PER_PAGE) - 1);
  const resultPage = Math.min(page, lastPage);
  const results = open ? matches.slice(resultPage * RESULTS_PER_PAGE, (resultPage + 1) * RESULTS_PER_PAGE) : [];
  const activeIndex = results.findIndex(({ item }) => item.id === active);
  const resultUnit = query.trim()
    ? matches.length === 1 ? "match" : "matches"
    : matches.length === 1 ? "option" : "options";
  const resultCount = lastPage > 0 ? pageLabel(resultPage, RESULTS_PER_PAGE, matches.length) : String(matches.length);
  const lastPillPage = Math.max(0, Math.ceil(picked.length / PILLS_PER_PAGE) - 1);
  const selectedPage = Math.min(pillPage, lastPillPage);
  // Show the most recent picks first so a new selection is visible immediately.
  const end = picked.length - selectedPage * PILLS_PER_PAGE;
  const pills = picked.slice(Math.max(0, end - PILLS_PER_PAGE), end).reverse();

  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
  }, [query, resultPage]);

  useEffect(() => {
    if (activeIndex >= 0) list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, active]);

  function search(text: string) {
    setQuery(text);
    setPage(0);
    setActive(null);
  }

  function close() {
    setOpen(false);
    search("");
  }

  function toggle(value: string) {
    if (selected.has(value)) {
      onChange(picked.filter((item) => item !== value));
    } else {
      setPillPage(0);
      onChange([...picked, value]);
    }
  }

  return (
    <div className="picker stack gap-8" onKeyDown={dismissOnEscape} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <div className="search-field record-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          className="input"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={activeIndex < 0 ? undefined : `${id}-${activeIndex}`}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            search(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const start = resultPage * RESULTS_PER_PAGE;
              const size = Math.min(RESULTS_PER_PAGE, matches.length - start);
              const next = event.key === "ArrowDown"
                ? Math.min(size - 1, activeIndex + 1)
                : activeIndex < 0 ? size - 1 : Math.max(0, activeIndex - 1);
              setActive(matches[start + next]?.item.id ?? null);
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              toggle(results[activeIndex].item.id);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="combo-clear"
            aria-label="Clear search"
            data-input-options=""
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { search(""); input.current?.focus(); }}
          >
            <X size={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="picker-results" data-input-options="">
          <div className="picker-meta">
            <p className="label" role="status">
              {matches.length ? `${resultCount} ${resultUnit}` : query.trim() ? "No matches found" : "No options available"}
            </p>
            {lastPage > 0 && (
              <PageButtons label="results" page={resultPage} last={lastPage} onPage={(next) => {
                setActive(null);
                setPage(next);
                input.current?.focus();
              }} />
            )}
          </div>
          <div ref={list} id={id} className="picker-list" role="listbox" aria-label={label} aria-multiselectable="true">
            {results.map(({ item }, i) => (
              <button
                type="button"
                key={item.id}
                id={`${id}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={selected.has(item.id)}
                className={"combo-row combo-pick" + (i === activeIndex ? " active" : "")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(item.id)}
              >
                <span className="picker-check" aria-hidden="true">{selected.has(item.id) && <Check size={14} strokeWidth={2.5} />}</span>
                {showThumbnails && <PickerThumbnail image={item.image} size={36} />}
                <span className="stack grow">
                  <span className="ellipsis">{item.name}</span>
                  {item.detail && <span className="label ellipsis">{item.detail}</span>}
                </span>
                {item.count !== undefined && <span className="filter-count">{item.count}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {picked.length > 0 && (
        <div className="stack gap-6" role="group" aria-label={`Selected ${label.toLocaleLowerCase()}`} data-input-options="">
          <div className="picker-meta">
            <p className="label" role="status">
              {lastPillPage > 0 ? `${pageLabel(selectedPage, PILLS_PER_PAGE, picked.length)} selected` : `${picked.length} selected`}
            </p>
            {lastPillPage > 0 && <PageButtons label="selections" page={selectedPage} last={lastPillPage} onPage={setPillPage} />}
          </div>
          <div className="chips wrap picker-pills">
            {pills.map((value) => {
              const item = byId.get(value);
              const name = item?.name ?? value;
              return (
                <button type="button" key={value} aria-label={`Remove ${name}`} onClick={(event) => {
                  if (event.currentTarget === document.activeElement) {
                    const next = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling ?? input.current;
                    if (next instanceof HTMLElement) next.focus();
                    if (!open) setOpen(false);
                  }
                  toggle(value);
                }}>
                  {showThumbnails && <PickerThumbnail image={item?.image} size={24} />}
                  <span className="ellipsis">{name}</span> <X size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  function dismissOnEscape(event: React.KeyboardEvent) {
    if (!open || event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    input.current?.focus();
    close();
  }
}
