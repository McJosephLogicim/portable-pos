"use client";

import { blocked, type Reason } from "@/lib/reject";
import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Image as ImageIcon, X } from "lucide-react";
import { fold, RecordSearch, SEARCH_FROM } from "./records";
import { buzz, Sheet } from "./ui";

const RESULTS_PER_PAGE = 24;
const PILLS_PER_PAGE = 12;

type MultiSelectOption<Id extends string> = {
  id: Id;
  name: string;
  detail?: string;
  searchText?: string;
  count?: number;
  image?: string;
  note?: string;
  blockedReason?: Reason;
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

function toggle<Id extends string>(picked: Id[], id: Id) {
  buzz.tap();
  return picked.includes(id) ? picked.filter((value) => value !== id) : [...picked, id];
}

type MultiSelectProps<Id extends string> = {
  label: string;
  searchNoun?: string;
  items: MultiSelectOption<Id>[];
  picked: Id[];
  onChange: (picked: Id[]) => void;
  showThumbnails?: boolean;
  disabled?: boolean;
};

export function MultiSelect<Id extends string>({
  label, searchNoun = "options", items, picked, onChange, showThumbnails, disabled,
}: MultiSelectProps<Id>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pillPage, setPillPage] = useState(0);

  if (!items.length) return <p className="label">No {searchNoun} available</p>;
  if (items.length < SEARCH_FROM) {
    return (
      <div className="chips wrap picker-options" role="group" aria-label={label}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={picked.includes(item.id)}
            disabled={disabled}
            {...blocked(item.blockedReason)}
            onClick={() => onChange(toggle(picked, item.id))}
          >
            {showThumbnails && <PickerThumbnail image={item.image} size={24} />}
            <span>{item.name}</span>
            {item.note && <span className="picker-note">{item.note}</span>}
            {item.count !== undefined && <span className="filter-count">{item.count}</span>}
          </button>
        ))}
      </div>
    );
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const lastPillPage = Math.max(0, Math.ceil(picked.length / PILLS_PER_PAGE) - 1);
  const selectedPage = Math.min(pillPage, lastPillPage);
  const end = picked.length - selectedPage * PILLS_PER_PAGE;
  const pills = picked.slice(Math.max(0, end - PILLS_PER_PAGE), end).reverse();

  return (
    <div className="picker stack gap-8">
      <button
        ref={trigger}
        type="button"
        className="input place-button picker-trigger"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="grow">Select {label.toLocaleLowerCase()}</span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {picked.length > 0 && (
        <div className="stack gap-6" role="group" aria-label={`Selected ${label.toLocaleLowerCase()}`}>
          <div className="picker-meta">
            <p className="label" role="status">
              {lastPillPage > 0 ? `${pageLabel(selectedPage, PILLS_PER_PAGE, picked.length)} selected` : `${picked.length} selected`}
            </p>
            {lastPillPage > 0 && <PageButtons label="selections" page={selectedPage} last={lastPillPage} onPage={setPillPage} />}
          </div>
          <div className="chips wrap picker-pills">
            {pills.map((id) => {
              const item = byId.get(id);
              const name = item?.name ?? id;
              return (
                <button
                  type="button"
                  key={id}
                  aria-label={`Remove ${name}`}
                  disabled={disabled}
                  {...blocked(item?.blockedReason)}
                  onClick={(event) => {
                    if (event.currentTarget === document.activeElement) {
                      const adjacent = event.currentTarget.nextElementSibling ?? event.currentTarget.previousElementSibling;
                      if (adjacent instanceof HTMLButtonElement && !adjacent.disabled) adjacent.focus();
                      else trigger.current?.focus();
                    }
                    onChange(toggle(picked, id));
                  }}
                >
                  {showThumbnails && <PickerThumbnail image={item?.image} size={24} />}
                  <span className="ellipsis">{name}</span>
                  <X size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {open && (
        <PickerSheet
          label={label}
          searchNoun={searchNoun}
          items={items}
          picked={picked}
          showThumbnails={showThumbnails}
          disabled={disabled}
          onClose={() => setOpen(false)}
          onChange={(next) => {
            onChange(next);
            setPillPage(0);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PickerSheet<Id extends string>({
  label, searchNoun, items, picked, onChange, showThumbnails, disabled, onClose,
}: MultiSelectProps<Id> & { searchNoun: string; onClose: () => void }) {
  const [draft, setDraft] = useState(picked);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null);
  const selected = new Set(draft);
  const index = useMemo(() => items.map((item) => ({
    item,
    text: fold([item.name, item.detail, item.searchText].filter(Boolean).join(" ")),
  })), [items]);
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = words.length ? index.filter(({ text }) => words.every((word) => text.includes(word))) : index;
  const lastPage = Math.max(0, Math.ceil(matches.length / RESULTS_PER_PAGE) - 1);
  const resultPage = Math.min(page, lastPage);
  const results = matches.slice(resultPage * RESULTS_PER_PAGE, (resultPage + 1) * RESULTS_PER_PAGE);

  function goToPage(next: number) {
    setPage(next);
    toolbar.current?.parentElement?.scrollTo({ top: 0 });
  }

  return (
    <Sheet
      title={label}
      onClose={onClose}
      footer={
        <button type="button" className="btn block" disabled={disabled} onClick={() => onChange(draft)}>
          {draft.length ? `Done · ${draft.length} selected` : "Done"}
        </button>
      }
    >
      <div
        ref={toolbar}
        className="picker-toolbar stack gap-6"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <RecordSearch
          count={items.length}
          noun={searchNoun}
          query={query}
          onQuery={(value) => {
            setQuery(value);
            goToPage(0);
          }}
          alwaysSearch
        />
        <div className="picker-meta">
          <p className="label" role="status">
            {matches.length
              ? `${lastPage ? pageLabel(resultPage, RESULTS_PER_PAGE, matches.length) : matches.length} ${matches.length === 1 ? "result" : "results"}`
              : "No matches found"}
          </p>
          {lastPage > 0 && <PageButtons label="results" page={resultPage} last={lastPage} onPage={goToPage} />}
        </div>
      </div>
      {results.length > 0 && (
        <div className="card card-list picker-list" role="group" aria-label={label}>
          {results.map(({ item }) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={selected.has(item.id)}
              disabled={disabled}
              {...blocked(item.blockedReason)}
              className="list-row"
              onClick={() => setDraft(toggle(draft, item.id))}
            >
              <span className="picker-check" aria-hidden="true">{selected.has(item.id) && <Check size={14} strokeWidth={2.5} />}</span>
              {showThumbnails && <PickerThumbnail image={item.image} size={36} />}
              <span className="stack grow">
                <span>{item.name}</span>
                {item.detail && <span className="label">{item.detail}</span>}
              </span>
              {item.note && <span className="label end">{item.note}</span>}
              {item.count !== undefined && <span className="filter-count">{item.count}</span>}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
