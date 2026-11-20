"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { countFilterOptions, matchesFilters, type FilterFacets, type FilterSelection, type FilterValue } from "@/lib/filters";
import { buzz, Sheet } from "./ui";
import { MultiSelect } from "./multi-select";

type FilterGroup<Key extends string> = { key: Key; name: string; options: FilterValue[] };
const VISIBLE_FILTER_PILLS = 8;

function toggleFilter<Key extends string>(filter: FilterSelection<Key>, key: Key, value: string) {
  buzz.tap();
  const picked = filter[key] ?? [];
  return { ...filter, [key]: picked.includes(value) ? picked.filter((option) => option !== value) : [...picked, value] };
}

export function FilterBar<Key extends string>({ label, groups, filter, onChange, onOpen }: {
  label: string;
  groups: FilterGroup<Key>[];
  filter: FilterSelection<Key>;
  onChange: (next: FilterSelection<Key>) => void;
  onOpen: () => void;
}) {
  const chips: { key: Key; name: string; value: string; label: string }[] = [];
  let total = 0;
  for (const { key, name, options } of groups) {
    const selected = filter[key] ?? [];
    total += selected.length;
    for (const value of selected.slice(0, Math.max(0, VISIBLE_FILTER_PILLS - chips.length))) {
      chips.push({ key, name, value, label: options.find((option) => option.value === value)?.label ?? value });
    }
  }
  return (
    <div className="chips filter-chips" role="group" aria-label="Filters">
      <button type="button" className="filter-open" onClick={onOpen}>
        <SlidersHorizontal size={15} strokeWidth={1.9} />
        {total ? "Filters · " + total : label}
      </button>
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value}`}
          type="button"
          aria-label={`Remove ${chip.name.toLowerCase()} ${chip.label}`}
          onClick={() => onChange(toggleFilter(filter, chip.key, chip.value))}
        >
          <span className="g">{chip.name}</span> {chip.label} <X size={14} />
        </button>
      ))}
      {total > chips.length && (
        <button type="button" className="filter-open" onClick={onOpen}>+{total - chips.length} more</button>
      )}
    </div>
  );
}

export function FilterChoices({ name, options, picked, onChange, showThumbnails }: {
  name: string;
  options: (FilterValue & { count: number; image?: string })[];
  picked: string[];
  onChange: (picked: string[]) => void;
  showThumbnails?: boolean;
}) {
  return (
    <div className="stack gap-10">
      <p className="group-title">{name}</p>
      <MultiSelect
        label={name}
        items={options.map((option) => ({ id: option.value, name: option.label, count: option.count, image: option.image }))}
        picked={picked}
        onChange={onChange}
        showThumbnails={showThumbnails}
      />
    </div>
  );
}

export function RecordFilters<Key extends string>({ noun, label, names, rows, searched, filter, onChange }: {
  noun: string;
  label: string;
  names: Record<Key, string>;
  rows: FilterFacets<Key>[];
  searched: FilterFacets<Key>[];
  filter: FilterSelection<Key>;
  onChange: (next: FilterSelection<Key>) => void;
}) {
  const [draft, setDraft] = useState<FilterSelection<Key> | null>(null);
  const keys = Object.keys(names) as Key[];
  const groups = keys.map((key) => ({
    key,
    name: names[key],
    options: countFilterOptions(rows, filter, key),
  }));
  if (!groups.some(({ key, options }) => options.length || filter[key]?.length)) return null;
  const count = draft && searched.filter((facets) => matchesFilters(facets, draft)).length;
  return (
    <>
      <FilterBar label={label} groups={groups} filter={filter} onChange={onChange} onOpen={() => setDraft(filter)} />
      {draft && (
        <Sheet
          title={`Filter ${noun}`}
          onClose={() => setDraft(null)}
          action={keys.some((key) => draft[key]?.length) ? (
            <button className="btn ghost small" onClick={() => setDraft({})}>Clear</button>
          ) : undefined}
          footer={
            <button className="btn block" onClick={() => {
              onChange(draft);
              setDraft(null);
            }}>
              {count ? `Show ${count} ${count === 1 ? "result" : "results"}` : "No results match"}
            </button>
          }
        >
          {groups.map(({ key, name }) => {
            const options = countFilterOptions(rows, draft, key).sort((a, b) => a.label.localeCompare(b.label));
            if (!options.length) return null;
            return <FilterChoices
              key={key}
              name={name}
              options={options}
              picked={draft[key] ?? []}
              onChange={(picked) => setDraft({ ...draft, [key]: picked })}
            />;
          })}
        </Sheet>
      )}
    </>
  );
}
