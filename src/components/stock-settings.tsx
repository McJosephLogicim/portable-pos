"use client";

import { useState } from "react";
import { Package, Trash2 } from "lucide-react";
import { stockModel, units } from "@/lib/stock";
import type { Product, StockItem, StockUse } from "@/lib/types";
import { SubPage, useCommit, type SettingsProps } from "./settings";
import { buzz } from "./ui";
import { namesText, plural, RecordAdd, RecordEmpty, RecordGroup, RecordRow, RecordSheet, useRecordSave } from "./records";

/** A stock item's details: its name and the unit it's counted in. */
export function StockSheet({
  item,
  menu,
  onSave,
  onRemove,
  onClose,
}: {
  item?: StockItem;
  menu: Product[];
  onSave: (item: StockItem) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "pack");
  const { busy, error, run } = useRecordSave(onClose);
  const users = item ? usedBy(menu, item.id) : [];
  const list = units.includes(unit) ? units : [unit, ...units];
  return (
    <RecordSheet
      noun="stock item"
      editing={Boolean(item)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim())}
      onSave={() => void run(() => onSave({ id: item?.id ?? crypto.randomUUID(), name: name.trim(), unit }))}
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
          <div className="chips wrap" role="group" aria-label="Unit">
            {list.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => {
                  buzz.tap();
                  setUnit(u);
                }}
              >
                {u}
              </button>
            ))}
          </div>
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
