"use client";

import { useState } from "react";
import { Boxes, Tag, Tags, Truck } from "lucide-react";
import { editStockList, stockListFields, stockListKey, stockListsOf } from "@/lib/stock-lists";
import type { StockListField } from "@/lib/types";
import type { RecipesProps } from "./recipes";
import { AddMenu } from "./add-menu";
import { BulkNamesSheet } from "./bulk-add";
import { matches, namesText, plural, RecordGroup, RecordNoMatch, RecordRow, RecordSearch, RecordSheet, useRecordSave } from "./records";
import { SubPage, useCommit } from "./settings";
import { EmptyState } from "./ui";
import { OFFLINE } from "@/lib/reject";

const groups = [
  { field: "category", Icon: Tag },
  { field: "kind", Icon: Boxes },
  { field: "supplier", Icon: Truck },
] as const;
function StockListPicker({ field, onChange }: {
  field: StockListField;
  onChange: (field: StockListField) => void;
}) {
  return (
    <label className="field">
      <span>List</span>
      <select className="select" value={field} onChange={(event) => onChange(event.target.value as StockListField)}>
        {groups.map(({ field }) => <option key={field} value={field}>{stockListFields[field].title}</option>)}
      </select>
    </label>
  );
}

function StockListSheet({ field: initialField, name, usedBy, onSave, onClose }: {
  field: StockListField;
  name?: string;
  usedBy: string[];
  onSave: (field: StockListField, value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [field, setField] = useState(initialField);
  const { noun, maxLength, placeholder } = stockListFields[field];
  const [draft, setDraft] = useState(name ?? "");
  const { busy, error, run } = useRecordSave(onClose);
  return (
    <RecordSheet
      noun={noun}
      title={name ? undefined : "New list entry"}
      editing={Boolean(name)}
      busy={busy}
      error={error}
      canSave={Boolean(draft.trim()) && draft.trim() !== name && draft.trim().length <= maxLength}
      onSave={() => void run(() => onSave(field, draft.trim()))}
      onRemove={name && !usedBy.length ? () => onSave(field, "") : undefined}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        {!name && <StockListPicker field={field} onChange={setField} />}
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
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ field: StockListField; name?: string } | null>(null);
  const [bulkField, setBulkField] = useState<StockListField | null>(null);
  const activeField = groups.find(({ field }) => stockListFields[field].title === tab)?.field;
  function usedBy(field: StockListField, name?: string) {
    if (!name) return [];
    return (settings.stockItems ?? []).filter((item) =>
      stockListKey(item.details?.[field]) === stockListKey(name),
    ).map((item) => item.name);
  }
  const count = Object.values(lists).reduce((sum, entries) => sum + entries.length, 0);
  const visibleGroups = groups
    .filter(({ field }) => !activeField || field === activeField)
    .map(({ field, Icon }) => ({
      field,
      Icon,
      shown: lists[field].map((name) => ({ name, items: usedBy(field, name) }))
        .filter(({ name, items }) => matches(query, name, ...items)),
    }));
  const hasEntries = activeField ? lists[activeField].length > 0 : count > 0;
  const noMatch = hasEntries && visibleGroups.every(({ shown }) => !shown.length);

  function addMenu(field?: StockListField) {
    return (
      <AddMenu
        singleLabel={field ? `Add a ${stockListFields[field].noun}` : "Add a list entry"}
        blockedReason={!props.online && OFFLINE}
        onSingle={() => setEditing({ field: field ?? "category" })}
        onBulk={() => setBulkField(field ?? "category")}
      />
    );
  }

  return (
    <SubPage
      title="Stock lists"
      backLabel="Back to recipes"
      sentence={<>Reuse prep categories, <span className="g">stock types and suppliers.</span></>}
      sentenceAction={hasEntries && addMenu(activeField)}
      help={<p>Add names here or type a new one when you save a prep or stock item. To remove a name, first change any items using it.</p>}
      onBack={() => props.onPage(null)}
    >
      <RecordSearch
        count={count}
        noun="stock lists"
        query={query}
        onQuery={setQuery}
        alwaysSearch={count > 0}
        filters={{
          label: "Stock lists",
          options: groups.map(({ field }) => stockListFields[field].title),
          value: tab,
          onChange: setTab,
        }}
      />
      {noMatch && <RecordNoMatch query={query} onClear={() => {
        setQuery("");
        setTab(null);
      }} />}
      {!activeField && !count && (
        <EmptyState pose="plan" object="supplyBox" title="No stock list entries yet" text="Add a category, stock type, or supplier to reuse it across items.">
          {addMenu()}
        </EmptyState>
      )}
      {visibleGroups.map(({ field, Icon, shown }) => {
        const { title } = stockListFields[field];
        if (activeField === field && !lists[field].length) {
          return (
            <EmptyState
              key={field}
              pose={field === "supplier" ? "team" : field === "kind" ? "neutral" : "connect"}
              object={field === "category" ? "mixingBowl" : "supplyBox"}
              title={`No ${title.toLocaleLowerCase()} yet`}
            >
              {addMenu(field)}
            </EmptyState>
          );
        }
        if (!shown.length) return null;
        return (
          <RecordGroup key={field} title={activeField ? undefined : title}>
            {shown.map(({ name, items }) => (
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
          </RecordGroup>
        );
      })}
      {!props.online && <p className="label">Connect to edit stock lists.</p>}
      {bulkField && (
        <BulkNamesSheet
          noun="list entry"
          nouns="list entries"
          label="Names, one per line"
          maxLength={stockListFields[bulkField].maxLength}
          onClose={() => setBulkField(null)}
          onSave={(names) => {
            const next = names.reduce((current, name) => ({
              ...current,
              ...editStockList(current, bulkField, undefined, name),
            }), settings);
            return commit.settings({ stockLists: next.stockLists }, "Added " + plural(names.length, "list entry", "list entries"));
          }}
        >
          <StockListPicker field={bulkField} onChange={setBulkField} />
        </BulkNamesSheet>
      )}
      {editing && (
        <StockListSheet
          field={editing.field}
          name={editing.name}
          usedBy={usedBy(editing.field, editing.name)}
          onClose={() => setEditing(null)}
          onSave={(field, value) => commit.settings(
            editStockList(settings, field, editing.name, value),
            value ? (editing.name ? "Saved " : "Added ") + value : "Removed " + editing.name,
          )}
        />
      )}
    </SubPage>
  );
}
