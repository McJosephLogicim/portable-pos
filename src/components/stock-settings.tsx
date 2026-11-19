"use client";

import { useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import { SuggestInput } from "./combobox";
import { stockModel, units } from "@/lib/stock";
import type { Product, StockItem, StockUse } from "@/lib/types";
import { SubPage, useCommit, type SettingsProps } from "./settings";
import { buzz } from "./ui";
import { namesText, plural, RecordAdd, RecordEmpty, RecordGroup, RecordRow, RecordSheet, useRecordSave } from "./records";

/** A stock item's details: its name and the unit it's counted in. */
/** Units already used, then the usual ones, so a unit is picked once and reused. */
export function unitSuggestions(stockItems: StockItem[] = []) {
  const used = stockItems.map((s) => s.unit);
  return [...new Set([...used, ...units])].map((u) => ({
    key: u,
    name: u,
    detail: used.includes(u) ? "Used by " + namesText(stockItems.filter((s) => s.unit === u).map((s) => s.name), 2) : undefined,
  }));
}

export function StockSheet({
  item,
  menu,
  stockItems,
  onSave,
  onRemove,
  onClose,
}: {
  item?: StockItem;
  menu: Product[];
  /** Every stock item, whose units are offered. */
  stockItems?: StockItem[];
  onSave: (item: StockItem) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "pack");
  const { busy, error, run } = useRecordSave(onClose);
  const users = item ? usedBy(menu, item.id) : [];
  return (
    <RecordSheet
      noun="stock item"
      editing={Boolean(item)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim() && unit.trim())}
      onSave={() => void run(() => onSave({ id: item?.id ?? crypto.randomUUID(), name: name.trim(), unit: unit.trim() }))}
      onRemove={onRemove && (() => void run(onRemove))}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={60}
            autoFocus={!item}
            placeholder="e.g. Strawberry pack"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Counted in</span>
          <SuggestInput
            label="Counted in"
            maxLength={16}
            placeholder="e.g. pack, kg, bottle"
            value={unit}
            newText="New unit"
            suggestions={unitSuggestions(stockItems)}
            onChange={setUnit}
          />
        </div>
      </div>
      <p className="label">
        {item
          ? users.length
            ? "Used by " + namesText(users, 3) + "." + (onRemove ? " Removing it stops those items using it." : "")
            : "No menu item uses it yet. Open a menu item and set Stock to Uses stock."
          : "It's counted when a shift opens and closes. Then pick it on the menu items that use it."}
      </p>
    </RecordSheet>
  );
}

function usedBy(menu: Product[], id: string) {
  return menu.filter((p) => p.uses?.some((u) => u.stockId === id)).map((p) => p.name);
}

/** Things counted when a shift opens and closes, like a pack of strawberries or a kilo of ice. */
export function StockPage(props: SettingsProps) {
  const business = props.state.business!;
  const list = business.settings.stockItems ?? [];
  const menu = props.state.menu;
  const commit = useCommit(props);
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const legacy = stockModel([], menu).items;
  const count = list.length + legacy.length;
  return (
    <SubPage
      title="Stock items"
      sentence={
        count ? (
          <>
            {plural(count, "thing")} <span className="g">counted when a shift opens and closes.</span>
          </>
        ) : (
          <>
            Nothing counted yet. <span className="g">Add what runs out, like strawberry packs or ice.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      <RecordAdd label="Add stock item" disabled={!props.online || list.length >= 100} onClick={() => setEditing("new")} />
      {list.length > 0 && (
        <RecordGroup title={legacy.length ? "Stock items" : undefined}>
          {list.map((item) => {
            const users = usedBy(menu, item.id);
            return (
              <RecordRow
                key={item.id}
                disabled={!props.online}
                onClick={() => setEditing(item)}
                lead={
                  <span className="well">
                    <Package size={18} strokeWidth={1.8} />
                  </span>
                }
                title={item.name}
                detail={users.length ? "Used by " + namesText(users, 1) : "Not used by a menu item yet"}
                end={item.unit}
              />
            );
          })}
        </RecordGroup>
      )}
      {!count && (
        <RecordEmpty
          icon={<Package size={22} strokeWidth={1.6} />}
          title="No stock items yet"
          text="Add one here, or right from a menu item while you set it up."
        />
      )}
      {legacy.length > 0 && (
        <RecordGroup title="Menu items counted themselves">
          {legacy.map((i) => {
            const product = menu.find((p) => p.id === i.id);
            return (
              <RecordRow
                key={i.id}
                disabled={!props.online || !product}
                onClick={() => props.onPage("menu")}
                lead={
                  <span className="well">
                    <Package size={18} strokeWidth={1.8} />
                  </span>
                }
                title={i.name}
                detail="Change it on the menu item"
                end="piece"
              />
            );
          })}
        </RecordGroup>
      )}
      <p className="label">
        {props.online ? "New stock items are counted from the next shift." : "Connect to edit stock items."}
      </p>
      {editing && (
        <StockSheet
          stockItems={list}
          item={editing === "new" ? undefined : editing}
          menu={menu}
          onClose={() => setEditing(null)}
          onSave={(item) =>
            commit.settings(
              {
                stockItems: list.some((i) => i.id === item.id)
                  ? list.map((i) => (i.id === item.id ? item : i))
                  : [...list, item],
              },
              (editing === "new" ? "Added " : "Saved ") + item.name,
            )
          }
          onRemove={
            editing === "new"
              ? undefined
              : () =>
                  commit.run(async (pin) => {
                    await props.onSave(
                      commit.input({ stockItems: list.filter((i) => i.id !== editing.id) }),
                      pin,
                    );
                    if (usedBy(menu, editing.id).length)
                      await props.onMenu(
                        menu.map((p) =>
                          p.uses?.some((u) => u.stockId === editing.id)
                            ? (({ uses, ...rest }) => {
                                const left = uses!.filter((u) => u.stockId !== editing.id);
                                return left.length ? { ...rest, uses: left } : rest;
                              })(p)
                            : p,
                        ),
                        pin,
                      );
                  }, "Removed " + editing.name)
          }
        />
      )}
    </SubPage>
  );
}

export type UseDraft = { key: string; name: string; amount: string; unit: string };

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function useDrafts(uses: StockUse[] | undefined, stockItems: StockItem[]): UseDraft[] {
  return (uses ?? []).flatMap((u) => {
    const item = stockItems.find((s) => s.id === u.stockId);
    return item ? [{ key: u.stockId, name: item.name, amount: String(u.amount), unit: item.unit }] : [];
  });
}

/**
 * What a menu item uses with each sale. Each line is a stock item's name, typed or picked
 * from the list, and how much. A name that isn't a stock item yet becomes one on save.
 */
export function UsesEditor({
  stockItems,
  uses,
  onChange,
}: {
  stockItems: StockItem[];
  uses: UseDraft[];
  onChange: (uses: UseDraft[]) => void;
}) {
  const set = (key: string, patch: Partial<UseDraft>) =>
    onChange(uses.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  return (
    <div className="stack gap-8">
      {uses.map((u, i) => {
        const known = stockItems.find((s) => sameName(s.name, u.name));
        return (
          <div className="use-row" key={u.key}>
            <div className="row gap-8">
              <SuggestInput
                className="grow"
                label={`Stock item ${i + 1}`}
                placeholder="e.g. Strawberry pack"
                value={u.name}
                newText="New stock item"
                suggestions={stockItems
                  .filter((s) => !uses.some((x) => x.key !== u.key && sameName(x.name, s.name)))
                  .map((s) => ({ key: s.id, name: s.name, detail: "Counted in " + s.unit }))}
                onChange={(name) => set(u.key, { name })}
                onPick={(pick) => {
                  buzz.tap();
                  set(u.key, { name: pick.name });
                }}
              />
              <button
                type="button"
                className="round flat"
                aria-label={"Remove stock item " + (i + 1)}
                onClick={() => onChange(uses.filter((x) => x.key !== u.key))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="use-amount">
              <span className="label grow nowrap">Each sale uses</span>
              <input
                className="input count"
                inputMode="decimal"
                aria-label={`How much of stock item ${i + 1} one sale uses`}
                value={u.amount}
                onChange={(e) =>
                  set(u.key, { amount: e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 8) })
                }
              />
              {known || !u.name.trim() ? (
                <span className="label use-unit">{known?.unit ?? ""}</span>
              ) : (
                <SuggestInput
                  className="use-unit-input"
                  label={"Unit for " + u.name}
                  maxLength={16}
                  placeholder="unit"
                  value={u.unit}
                  newText="New unit"
                  suggestions={unitSuggestions(stockItems)}
                  onChange={(unit) => set(u.key, { unit })}
                />
              )}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="btn secondary compact"
        onClick={() => onChange([...uses, { key: crypto.randomUUID(), name: "", amount: "1", unit: "pack" }])}
      >
        <Plus size={16} /> Stock item
      </button>
    </div>
  );
}

/** Matches typed names to stock items, and makes the ones that don't exist yet. */
export function resolveUses(drafts: UseDraft[], stockItems: StockItem[]) {
  const created: StockItem[] = [];
  const uses: StockUse[] = [];
  for (const d of drafts) {
    const name = d.name.trim().slice(0, 60);
    if (!name) continue;
    const amount = Number(d.amount);
    if (!(amount > 0) || amount > 100000) throw Error("Enter how much " + name + " one sale uses, more than 0.");
    let item = [...stockItems, ...created].find((s) => sameName(s.name, name));
    if (!item) {
      item = { id: crypto.randomUUID(), name, unit: d.unit.trim().slice(0, 16) || "piece" };
      created.push(item);
    }
    if (uses.some((u) => u.stockId === item!.id)) throw Error(name + " is listed twice.");
    uses.push({ stockId: item.id, amount: Math.round(amount * 1000) / 1000 });
  }
  return { uses, created };
}

export function usesText(p: Product, stockItems: StockItem[] | undefined) {
  return (p.uses ?? [])
    .map((u) => stockItems?.find((s) => s.id === u.stockId)?.name)
    .filter(Boolean)
    .join(", ");
}
