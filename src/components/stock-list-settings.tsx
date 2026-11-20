"use client";

import { useState } from "react";
import { Boxes, Plus, Tag, Truck } from "lucide-react";
import { matchesFilters, type FilterFacets, type FilterSelection } from "@/lib/filters";
import { editStockList, stockListFields, stockListKey, stockListsOf } from "@/lib/stock-lists";
import type { StockListField } from "@/lib/types";
import type { RecipesProps } from "./recipes";
import { RecordFilters } from "./filter-controls";
import { matches, namesText, plural, RecordGroup, RecordNoMatch, RecordRow, RecordSearch, RecordSheet, useRecordSave } from "./records";
import { SubPage, useCommit } from "./settings";

const groups = [
  { field: "category", Icon: Tag },
  { field: "kind", Icon: Boxes },
  { field: "supplier", Icon: Truck },
] as const;
const listFilterNames = { list: "List", usage: "Usage" };
type ListFilter = keyof typeof listFilterNames;

function StockListSheet({ field, name, usedBy, onSave, onClose }: {
  field: StockListField;
  name?: string;
  usedBy: string[];
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { noun, maxLength, placeholder } = stockListFields[field];
  const [draft, setDraft] = useState(name ?? "");
  const { busy, error, run } = useRecordSave(onClose);
  return (
    <RecordSheet
      noun={noun}
      editing={Boolean(name)}
      busy={busy}
      error={error}
      canSave={Boolean(draft.trim()) && draft.trim() !== name}
      onSave={() => void run(() => onSave(draft.trim()))}
      onRemove={name && !usedBy.length ? () => onSave("") : undefined}
      onClose={onClose}
    >
      <div className="card card-pad">
        <label className="field">
          <span>Name</span>
          <input className="input" autoFocus={!name} maxLength={maxLength} placeholder={placeholder} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
      </div>
      {usedBy.length > 0 && <p className="label">Renaming updates {namesText(usedBy, 3)}.</p>}
    </RecordSheet>
  );
}

export function StockListsPage(props: RecipesProps) {
  const settings = props.state.business!.settings;
  const commit = useCommit(props);
  const lists = stockListsOf(settings);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterSelection<ListFilter>>({});
  const [editing, setEditing] = useState<{ field: StockListField; name?: string } | null>(null);
  function usedBy(field: StockListField, name?: string) {
    if (!name) return [];
    return (settings.stockItems ?? []).filter((item) =>
      stockListKey(item.details?.[field]) === stockListKey(name),
    ).map((item) => item.name);
  }
  const entries = groups.flatMap(({ field }) => lists[field].map((name) => {
    const items = usedBy(field, name);
    const list = stockListFields[field].title;
    const usage = items.length ? "In use" : "Unused";
    const facets: FilterFacets<ListFilter> = {
      list: [{ value: list, label: list }],
      usage: [{ value: usage, label: usage }],
    };
    return { field, name, items, facets };
  }));
  const searched = entries.filter(({ name, items }) => matches(query, name, ...items));
  const shown = searched.filter(({ facets }) => matchesFilters(facets, filter));
  const narrow = Boolean(query.trim() || filter.usage?.length);

  return (
    <SubPage
      title="Stock lists"
      backLabel="Back to recipes"
      sentence={<>Reuse prep categories, <span className="g">stock types and suppliers.</span></>}
      help={<p>Add names here or type a new one when you save a prep or stock item. To remove a name, first change any items using it.</p>}
      onBack={() => props.onPage(null)}
    >
      <RecordSearch count={entries.length} noun="stock lists" query={query} onQuery={setQuery} alwaysSearch={entries.length > 0} />
      <RecordFilters
        noun="stock lists"
        label="Filter by list or usage…"
        names={listFilterNames}
        rows={entries.map(({ facets }) => facets)}
        searched={searched.map(({ facets }) => facets)}
        filter={filter}
        onChange={setFilter}
      />
      {narrow && !shown.length && <RecordNoMatch query={query} onClear={() => {
        setQuery("");
        setFilter({});
      }} />}
      {groups.map(({ field, Icon }) => {
        const { title, noun } = stockListFields[field];
        const names = shown.filter((entry) => entry.field === field);
        if ((filter.list?.length && !filter.list.includes(title)) || (narrow && !names.length)) return null;
        return (
          <RecordGroup key={field} title={title}>
            {names.map(({ name, items }) => (
              <RecordRow
                key={stockListKey(name)}
                disabled={!props.online}
                onClick={() => setEditing({ field, name })}
                lead={<span className="well"><Icon size={18} strokeWidth={1.8} /></span>}
                title={name}
                detail={items.length ? namesText(items) : undefined}
                end={plural(items.length, "item")}
              />
            ))}
            <button type="button" className="list-row" disabled={!props.online} onClick={() => setEditing({ field })}>
              <span className="well"><Plus size={18} /></span>
              <span className="grow row-title">Add {noun}</span>
            </button>
          </RecordGroup>
        );
      })}
      {!props.online && <p className="label">Connect to edit stock lists.</p>}
      {editing && (
        <StockListSheet
          field={editing.field}
          name={editing.name}
          usedBy={usedBy(editing.field, editing.name)}
          onClose={() => setEditing(null)}
          onSave={(value) => commit.settings(
            editStockList(settings, editing.field, editing.name, value),
            value ? (editing.name ? "Saved " : "Added ") + value : "Removed " + editing.name,
          )}
        />
      )}
    </SubPage>
  );
}
