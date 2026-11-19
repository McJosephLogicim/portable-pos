"use client";

import { useState } from "react";
import { Package, Trash2 } from "lucide-react";
import { stockModel, units } from "@/lib/stock";
import type { Product, StockItem, StockUse } from "@/lib/types";
import { SubPage, useDraft, type SettingsProps } from "./settings";
import { buzz } from "./ui";

function UnitSelect({ value, onChange, label }: { value: string; onChange: (unit: string) => void; label: string }) {
  const list = units.includes(value) ? units : [value, ...units];
  return (
    <select className="select unit-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

/** Things counted when a shift opens and closes, like a pack of strawberries or a kilo of ice. */
export function StockPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props, "Save stock items", "Stock items saved");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pack");
  const list = draft.settings.stockItems ?? [];
  const menu = props.state.menu;
  const legacy = stockModel([], menu).items;
  const full = list.length >= 100;
  const update = (change: (items: StockItem[]) => StockItem[]) =>
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, stockItems: change(current.settings.stockItems ?? []) },
    }));
  const usedBy = (id: string) => menu.filter((p) => p.uses?.some((u) => u.stockId === id)).map((p) => p.name);
  function add() {
    const value = name.trim();
    if (!value || full) return;
    update((items) => [...items, { id: crypto.randomUUID(), name: value, unit }]);
    setName("");
    buzz.tick();
  }
  const count = list.length + legacy.length;
  return (
    <SubPage
      title="Stock items"
      sentence={
        count ? (
          <>
            {count} {count === 1 ? "thing" : "things"} <span className="g">counted when a shift opens and closes.</span>
          </>
        ) : (
          <>
            Nothing counted yet. <span className="g">Add what runs out, like strawberry packs or ice.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      {list.length > 0 && (
        <div className="card card-list">
          {list.map((item) => {
            const users = usedBy(item.id);
            return (
              <div className="list-row stock-row" key={item.id}>
                <span className="well">
                  <Package size={18} strokeWidth={1.8} />
                </span>
                <span className="grow stack" style={{ minWidth: 0 }}>
                  <input
                    className="inline-input"
                    aria-label="Stock item name"
                    maxLength={60}
                    value={item.name}
                    onChange={(e) => {
                      const text = e.currentTarget.value;
                      update((items) => items.map((i) => (i.id === item.id ? { ...i, name: text } : i)));
                    }}
                  />
                  <span className="label ellipsis">
                    {users.length ? "Used by " + users.join(", ") : "Not used by a menu item yet"}
                  </span>
                </span>
                <UnitSelect
                  label={"Unit for " + item.name}
                  value={item.unit}
                  onChange={(u) => update((items) => items.map((i) => (i.id === item.id ? { ...i, unit: u } : i)))}
                />
                <button
                  type="button"
                  className="round flat"
                  aria-label={"Remove " + item.name}
                  onClick={() => update((items) => items.filter((i) => i.id !== item.id))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="card card-pad stack gap-10">
        <span className="strong">Add a stock item</span>
        <div className="row gap-8">
          <input
            className="input grow"
            maxLength={60}
            aria-label="New stock item"
            placeholder="e.g. Strawberry pack"
            value={name}
            disabled={full}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              add();
            }}
          />
          <UnitSelect label="Unit" value={unit} onChange={setUnit} />
        </div>
        <button type="button" className="btn secondary" onClick={add} disabled={!name.trim() || full}>
          Add stock item
        </button>
        <p className="label">
          Then open a menu item and pick what it uses, like 1 pack or 0.2 kg. Each sale takes it off what's left.
        </p>
      </div>
      {legacy.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Counted menu items</p>
          <div className="card card-list">
            {legacy.map((i) => (
              <div className="list-row" key={i.id}>
                <span className="well">
                  <Package size={18} strokeWidth={1.8} />
                </span>
                <span className="grow stack">
                  <span className="ellipsis">{i.name}</span>
                  <span className="label">Counted by the piece. Change it on the menu item.</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="label">New stock items are counted from the next shift.</p>
      {bar}
    </SubPage>
  );
}

/** Pick the stock items a menu item uses up with each sale, and how much of each. */
export function UsesEditor({
  stockItems,
  uses,
  onChange,
}: {
  stockItems: StockItem[];
  uses: { stockId: string; amount: string }[];
  onChange: (uses: { stockId: string; amount: string }[]) => void;
}) {
  const free = stockItems.filter((s) => !uses.some((u) => u.stockId === s.id));
  return (
    <div className="stack gap-10">
      {uses.map((u) => {
        const item = stockItems.find((s) => s.id === u.stockId);
        if (!item) return null;
        return (
          <div className="use-row" key={u.stockId}>
            <span className="grow ellipsis">{item.name}</span>
            <input
              className="input count"
              inputMode="decimal"
              aria-label={`${item.unit} of ${item.name} per sale`}
              value={u.amount}
              onChange={(e) =>
                onChange(
                  uses.map((x) =>
                    x.stockId === u.stockId
                      ? { ...x, amount: e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 8) }
                      : x,
                  ),
                )
              }
            />
            <span className="label use-unit">{item.unit}</span>
            <button
              type="button"
              className="round flat"
              aria-label={"Stop using " + item.name}
              onClick={() => onChange(uses.filter((x) => x.stockId !== u.stockId))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {free.length > 0 && (
        <div className="chips wrap" role="group" aria-label="Stock items to use">
          {free.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                buzz.tap();
                onChange([...uses, { stockId: s.id, amount: "1" }]);
              }}
            >
              + {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function usesFrom(drafts: { stockId: string; amount: string }[]): StockUse[] {
  return drafts.map((d) => {
    const amount = Number(d.amount);
    if (!(amount > 0) || amount > 100000) throw Error("Enter how much stock one sale uses, more than 0.");
    return { stockId: d.stockId, amount: Math.round(amount * 1000) / 1000 };
  });
}

export function usesText(p: Product, stockItems: StockItem[] | undefined) {
  return (p.uses ?? [])
    .map((u) => stockItems?.find((s) => s.id === u.stockId)?.name)
    .filter(Boolean)
    .join(", ");
}
