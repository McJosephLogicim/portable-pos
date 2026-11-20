"use client";

import { useState } from "react";
import { CookingPot, Minus, Package, Plus, Trash2 } from "lucide-react";
import { SuggestInput } from "./combobox";
import { amountText, parseMoney } from "@/lib/domain";
import { currencyDigits } from "@/lib/settings";
import { menuRecipeCost, prepCost, round, stockCostRates, stockModel, stockUnitCost, suggestedPrice, unitFor, units } from "@/lib/stock";
import type { Product, StockItem, StockPrep, StockPurchase, StockUse } from "@/lib/types";
import { SubPage, useCommit } from "./settings";
import type { RecipesProps } from "./recipes";
import { buzz, formatMoney, MoneyField } from "./ui";
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
  currency,
  menu,
  stockItems = [],
  prepOnly = false,
  onSave,
  onRemove,
  onClose,
}: {
  item?: StockItem;
  currency: string;
  menu: Product[];
  /** Every stock item, whose units are offered. */
  stockItems?: StockItem[];
  prepOnly?: boolean;
  onSave: (item: StockItem) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? (prepOnly ? "L" : "pack"));
  const [prepared, setPrepared] = useState(prepOnly || Boolean(item?.prep));
  const [batchYield, setBatchYield] = useState(item?.prep ? String(item.prep.yieldQuantity) : "");
  const [extraBatchCost, setExtraBatchCost] = useState(
    item?.prep?.extraBatchCost === undefined ? "" : amountText(item.prep.extraBatchCost, currency),
  );
  const ingredients = stockItems.filter((stock) => stock.id !== item?.id && !stock.prep);
  const [drafts, setDrafts] = useState(() => {
    const saved = useDrafts(item?.prep?.uses, ingredients);
    return saved.length ? saved : [blankUseDraft()];
  });
  const [purchasePrice, setPurchasePrice] = useState(item?.purchase ? amountText(item.purchase.price, currency) : "");
  const [packQuantity, setPackQuantity] = useState(item?.purchase ? String(item.purchase.quantity) : "");
  const [yieldPercent, setYieldPercent] = useState(item?.purchase?.yieldPercent === undefined ? "" : String(item.purchase.yieldPercent));
  const { busy, error, run } = useRecordSave(onClose);
  const users = item ? usedBy(menu, item.id) : [];
  const recipeUsers = item ? usedInRecipes(stockItems, menu, item.id) : [];

  function readPurchase(): StockPurchase | undefined {
    if (!purchasePrice && !packQuantity && !yieldPercent) return undefined;
    if (!purchasePrice) throw Error("Enter the purchase price.");
    const quantity = Number(packQuantity);
    if (!(quantity >= 0.001 && quantity <= 1_000_000))
      throw Error("Enter a pack quantity from 0.001 to 1,000,000.");
    const usable = yieldPercent === "" ? undefined : Number(yieldPercent);
    if (usable !== undefined && !(usable >= 0.01 && usable <= 100))
      throw Error("Enter a usable yield from 0.01% to 100%.");
    return {
      price: parseMoney(purchasePrice, currency),
      quantity,
      ...(usable !== undefined ? { yieldPercent: usable } : {}),
    };
  }

  function readPrep(): StockPrep {
    const yieldQuantity = Number(batchYield);
    if (!(yieldQuantity >= 0.001 && yieldQuantity <= 1_000_000))
      throw Error("Enter a finished batch yield from 0.001 to 1,000,000.");
    const { uses } = resolveUses(drafts, ingredients, false);
    if (!uses.length) throw Error("Add at least one ingredient to the prep recipe.");
    return {
      yieldQuantity,
      uses,
      ...(extraBatchCost ? { extraBatchCost: parseMoney(extraBatchCost, currency) } : {}),
    };
  }

  let costPerUnit: string | undefined;
  let batchCost: number | undefined;
  try {
    if (prepared) {
      const costs = prepCost(readPrep(), new Map(ingredients.map((stock) => [stock.id, stock])));
      batchCost = costs?.batch;
      if (costs && unit.trim()) costPerUnit = formatStockRate(costs.unit, currency);
    } else {
      const purchase = readPurchase();
      if (purchase && unit.trim()) costPerUnit = formatStockRate(stockUnitCost(purchase), currency);
    }
  } catch {
    // Partial entries can be completed before saving.
  }

  return (
    <RecordSheet
      noun={prepOnly ? "prep recipe" : "stock item"}
      editing={Boolean(item)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim() && unit.trim())}
      onSave={() => void run(() => {
        if (!sameName(item?.name ?? "", name) && stockItems.some((stock) => stock.id !== item?.id && sameName(stock.name, name)))
          throw Error("A stock item already has that name. Open it in Stock items to change how it is costed.");
        if (item && unit.trim() !== item.unit && (recipeUsers.length || ((prepared || item.prep) && users.length)))
          throw Error("Update the recipes that use this item before changing its unit.");
        const purchase = prepared ? undefined : readPurchase();
        return onSave({
          id: item?.id ?? crypto.randomUUID(),
          name: name.trim(),
          unit: unit.trim(),
          ...(purchase ? { purchase } : {}),
          ...(prepared ? { prep: readPrep() } : {}),
        });
      })}
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
            placeholder={prepOnly ? "e.g. Sea Salt Cream" : "e.g. Strawberry pack"}
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
        {!prepOnly && (
          <div className="field">
            <span>Cost source</span>
            <div className="segmented" role="group" aria-label="Cost source">
              <button type="button" aria-pressed={!prepared} onClick={() => setPrepared(false)}>Purchase</button>
              <button type="button" aria-pressed={prepared} onClick={() => setPrepared(true)}>Prep recipe</button>
            </div>
          </div>
        )}
      </div>
      {prepared ? (
        <div className="card card-pad stack gap-14">
          <h3 className="strong">Batch recipe</h3>
          <label className="field">
            <span>Finished yield{unit.trim() ? ` (${unit.trim()})` : ""}</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="e.g. 1"
              value={batchYield}
              onChange={(e) => setBatchYield(decimalEntry(e.target.value))}
            />
          </label>
          <UsesEditor stockItems={ingredients} uses={drafts} currency={currency} batch onChange={setDrafts} />
          <MoneyField label="Other batch cost" value={extraBatchCost} onChange={setExtraBatchCost} currency={currency} placeholder="Optional" />
          {batchCost !== undefined && costPerUnit !== undefined ? (
            <dl className="recipe-cost stack gap-8 label">
              <div className="between"><dt>Batch cost</dt><dd className="strong">{formatMoney(Math.round(batchCost), currency)}</dd></div>
              <div className="between"><dt>Cost per {unit.trim()}</dt><dd className="strong">{costPerUnit}</dd></div>
            </dl>
          ) : (
            <p className="label">Cost incomplete. Enter the finished yield and check ingredient quantities and purchase costs.</p>
          )}
        </div>
      ) : (
        <div className="card card-pad stack gap-14">
          <h3 className="strong">Purchase cost</h3>
          <MoneyField label="Purchase price" value={purchasePrice} onChange={setPurchasePrice} currency={currency} placeholder="Optional" />
          <label className="field">
            <span>Pack quantity{unit.trim() ? ` (${unit.trim()})` : ""}</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="e.g. 50"
              value={packQuantity}
              onChange={(e) => setPackQuantity(decimalEntry(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Usable yield (%)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="100"
              value={yieldPercent}
              onChange={(e) => setYieldPercent(decimalEntry(e.target.value))}
            />
          </label>
          {costPerUnit !== undefined && (
            <p className="between label"><span>Cost per {unit.trim()}</span><strong>{costPerUnit}</strong></p>
          )}
        </div>
      )}
      <p className="label">
        {item
          ? users.length
            ? "Used by " + namesText(users, 3) + "." + (onRemove ? " Removing it stops those items using it." : "")
            : "No menu item uses it yet. Open a menu item and set Stock to Uses stock."
          : "It's counted when a shift opens and closes. Then pick it on the menu items that use it."}
      </p>
      {recipeUsers.length > 0 && <p className="label">Used in {namesText(recipeUsers, 3)}. Remove it from those recipes before deleting it.</p>}
    </RecordSheet>
  );
}

function usedBy(menu: Product[], id: string) {
  return menu.filter((p) => p.uses?.some((u) => u.stockId === id)).map((p) => p.name);
}
function usedInRecipes(items: StockItem[], menu: Product[], id: string) {
  return [
    ...items.filter((item) => item.prep?.uses.some((use) => use.stockId === id)).map((item) => item.name),
    ...menu.filter((item) => item.costing?.batch?.uses.some((use) => use.stockId === id)).map((item) => item.name),
  ];
}

function formatStockRate(rate: number, currency: string) {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: digits + 3,
  }).format(rate / 10 ** digits);
}

/** Things counted when a shift opens and closes, like a pack of strawberries or a kilo of ice. */
export function StockPage({ prepOnly = false, ...props }: RecipesProps & { prepOnly?: boolean }) {
  const business = props.state.business!;
  const list = business.settings.stockItems ?? [];
  const menu = props.state.menu;
  const commit = useCommit(props);
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const rows = prepOnly ? list.filter((item) => item.prep) : list;
  const rates = prepOnly ? stockCostRates(list) : undefined;
  const legacy = prepOnly ? [] : stockModel([], menu).items;
  const count = rows.length + legacy.length;
  return (
    <SubPage
      title={prepOnly ? "Prep recipes" : "Stock items"}
      backLabel="Back to recipes"
      sentence={
        prepOnly ? "Cost the ingredients you make in batches." : count ? (
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
      <RecordAdd label={prepOnly ? "Add prep recipe" : "Add stock item"} disabled={!props.online || list.length >= 100} onClick={() => setEditing("new")} />
      {rows.length > 0 && (
        <RecordGroup title={legacy.length ? "Stock items" : undefined}>
          {rows.map((item) => {
            const users = usedBy(menu, item.id);
            const rate = rates?.get(item.id);
            return (
              <RecordRow
                key={item.id}
                disabled={!props.online}
                onClick={() => setEditing(item)}
                lead={
                  <span className="well">
                    {item.prep ? <CookingPot size={18} strokeWidth={1.8} /> : <Package size={18} strokeWidth={1.8} />}
                  </span>
                }
                title={item.name}
                detail={prepOnly && rate === undefined ? "Cost incomplete" : users.length ? "Used by " + namesText(users, 1) : undefined}
                end={rate === undefined ? item.unit : `${formatStockRate(rate, business.currency)} / ${item.unit}`}
              />
            );
          })}
        </RecordGroup>
      )}
      {!count && (
        <RecordEmpty
          icon={prepOnly ? <CookingPot size={22} strokeWidth={1.6} /> : <Package size={22} strokeWidth={1.6} />}
          title={prepOnly ? "No prep recipes yet" : "No stock items yet"}
          text={prepOnly
            ? "Add a batch recipe, or open an existing item in Stock items and choose Prep recipe."
            : "Add one here, or right from a menu item while you set it up."}
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
        {props.online ? "New stock items are counted from the next shift." : `Connect to edit ${prepOnly ? "prep recipes" : "stock items"}.`}
      </p>
      {editing && (
        <StockSheet
          stockItems={list}
          currency={business.currency}
          prepOnly={prepOnly}
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
            editing === "new" || usedInRecipes(list, menu, editing.id).length
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

export type UseDraft = { key: string; stockId?: string; name: string; amount: string; unit: string };

export const blankUseDraft = (): UseDraft => ({ key: crypto.randomUUID(), name: "", amount: "1", unit: "pack" });

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const decimalEntry = (value: string) => value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 12);

export function stockForUse(draft: UseDraft, stockItems: StockItem[]) {
  return draft.stockId
    ? stockItems.find((item) => item.id === draft.stockId)
    : stockItems.find((item) => sameName(item.name, draft.name));
}

/** Whole steps, or tenths below one so 0.2 kg can still be nudged. */
const stepUp = (n: number) => round(n < 1 ? n + 0.1 : n + 1);
const stepDown = (n: number) => round(n <= 1 ? n - 0.1 : Math.max(1, n - 1));

function useAmount(value: string) {
  const quantity = Number(value);
  const amount = round(quantity);
  return amount > 0 && quantity <= 100_000 ? amount : undefined;
}

export function useDrafts(uses: StockUse[] | undefined, stockItems: StockItem[]): UseDraft[] {
  return (uses ?? []).flatMap((u) => {
    const item = stockItems.find((s) => s.id === u.stockId);
    return item ? [{ key: u.stockId, stockId: u.stockId, name: item.name, amount: String(u.amount), unit: item.unit }] : [];
  });
}

export function stockUseRows(uses: UseDraft[], stockItems: StockItem[], costItems = stockItems) {
  const rates = stockCostRates(costItems);
  const currentUnits = new Map(costItems.map((item) => [item.id, item.unit]));
  return uses.map((draft) => {
    const item = stockForUse(draft, stockItems);
    const amount = useAmount(draft.amount);
    const rate = item && currentUnits.get(item.id) === item.unit ? rates.get(item.id) : undefined;
    const cost = rate !== undefined && amount !== undefined ? rate * amount : undefined;
    return { draft, item, amount, cost };
  });
}

/** Ingredient rows for a batch recipe or stock deducted per sale. */
export function UsesEditor({
  stockItems,
  costItems = stockItems,
  uses,
  currency,
  batch = false,
  showCosts = true,
  onChange,
}: {
  stockItems: StockItem[];
  costItems?: StockItem[];
  uses: UseDraft[];
  currency: string;
  batch?: boolean;
  showCosts?: boolean;
  onChange: (uses: UseDraft[]) => void;
}) {
  const set = (key: string, patch: Partial<UseDraft>) =>
    onChange(uses.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  const rows = stockUseRows(uses, stockItems, costItems);
  const entry = batch ? "ingredient" : "stock item";
  const per = batch ? "batch" : "sale";
  return (
    <div className="stack gap-8">
      {rows.map(({ draft: u, item: known, amount, cost }, i) => (
        <div className="use-row" key={u.key}>
          <div className="row gap-8">
            <SuggestInput
              className="grow"
              label={`${batch ? "Ingredient" : "Stock item"} ${i + 1}`}
              placeholder={batch ? "e.g. Whip Cream" : "e.g. Milk"}
              value={u.name}
              newText={batch ? false : "New stock item"}
              suggestions={stockItems
                .filter((s) => !uses.some((x) => x.key !== u.key && sameName(x.name, s.name)))
                .map((s) => ({ key: s.id, name: s.name, detail: s.prep ? "Prep recipe · " + s.unit : "Counted in " + s.unit }))}
              onChange={(name) => set(u.key, { name, stockId: undefined })}
              onPick={(pick) => {
                buzz.tap();
                set(u.key, { name: pick.name, stockId: pick.key });
              }}
            />
            <button
              type="button"
              className="round flat"
              aria-label={`Remove ${entry} ${i + 1}`}
              onClick={() => onChange(uses.filter((x) => x.key !== u.key))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="use-amount">
            <span>Uses</span>
            <div className="stepper" role="group" aria-label={`How much of ${entry} ${i + 1} each ${per}`}>
              <button
                type="button"
                className="round flat"
                aria-label="Less"
                disabled={amount === undefined || amount <= 0.1}
                onClick={() => {
                  buzz.tap();
                  set(u.key, { amount: String(stepDown(amount!)) });
                }}
              >
                <Minus size={16} />
              </button>
              <input
                className="input count"
                inputMode="decimal"
                aria-label="Amount"
                value={u.amount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => set(u.key, { amount: decimalEntry(e.target.value).slice(0, 8) })}
              />
              <button
                type="button"
                className="round flat"
                aria-label="More"
                disabled={amount !== undefined && amount >= 10_000}
                onClick={() => {
                  buzz.tick();
                  set(u.key, { amount: String(stepUp(amount ?? 0)) });
                }}
              >
                <Plus size={16} />
              </button>
            </div>
            {known || batch || !u.name.trim() ? (
              known && <span className="nowrap">{unitFor(amount, known.unit)}</span>
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
          <p className="label">
            {batch ? "Each batch" : "Each sale"}
            {showCosts && u.name.trim() && (cost === undefined ? " · no cost yet" : " · " + formatMoney(Math.round(cost), currency))}
          </p>
        </div>
      ))}
      <button
        type="button"
        className="btn secondary compact"
        disabled={uses.length >= 20}
        onClick={() => onChange([...uses, blankUseDraft()])}
      >
        <Plus size={16} /> {batch ? "Ingredient" : "Stock item"}
      </button>
    </div>
  );
}

export function CostPreview({ currency, total, batch }: {
  currency: string;
  total: ReturnType<typeof menuRecipeCost>;
  batch: boolean;
}) {
  const [target, setTarget] = useState("70");
  const [increment, setIncrement] = useState(currency === "PHP" ? "5" : "1");
  let suggested: number | undefined;
  if (total && target && increment) {
    try {
      suggested = suggestedPrice(total.cost, Number(target), parseMoney(increment, currency));
    } catch {
      // The preview updates once the rounding amount is valid.
    }
  }
  const formatCost = (value: number) => formatMoney(Math.round(value), currency);
  return (
    <div className="stack gap-8 recipe-cost" aria-live="polite">
      {total ? (
        <dl className="stack gap-8 label">
          {batch && <div className="between"><dt>Batch material cost</dt><dd className="strong">{formatCost(total.batchMaterialCost)}</dd></div>}
          <div className="between"><dt>Material cost per serving</dt><dd className="strong">{formatCost(total.materialPerServing)}</dd></div>
          <div className="between"><dt>Total cost per serving</dt><dd className="strong">{formatCost(total.cost)}</dd></div>
          <div className="between"><dt>Gross profit per serving</dt><dd className="strong">{total.profit === undefined ? "—" : formatCost(total.profit)}</dd></div>
          <div className="between">
            <dt>Gross margin</dt>
            <dd className="strong">{total.margin === undefined ? "—" : new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(total.margin)}</dd>
          </div>
        </dl>
      ) : (
        <p className="label">Cost incomplete. Check recipe quantities, serving costs, and the costs of the ingredients.</p>
      )}
      {total && (
        <details className="label">
          <summary className="strong">Suggested price{suggested === undefined ? "" : ` · ${formatMoney(suggested, currency)}`}</summary>
          <div className="grid-2 recipe-price-fields">
            <label className="field">
              <span>Target margin (%)</span>
              <input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(decimalEntry(e.target.value))} />
            </label>
            <MoneyField label="Round up to" value={increment} onChange={setIncrement} currency={currency} />
          </div>
        </details>
      )}
    </div>
  );
}

/** Matches typed names to stock items, and makes the ones that don't exist yet. */
export function resolveUses(drafts: UseDraft[], stockItems: StockItem[], allowCreate = true) {
  const created: StockItem[] = [];
  const uses: StockUse[] = [];
  for (const d of drafts) {
    const name = d.name.trim().slice(0, 60);
    if (!name) continue;
    const amount = useAmount(d.amount);
    if (amount === undefined) throw Error("Enter how much " + name + " to use, from 0.001 to 100,000.");
    let item = stockForUse(d, stockItems) ?? created.find((s) => sameName(s.name, name));
    if (!item) {
      if (d.stockId) throw Error(name + " is no longer in Stock items.");
      if (!allowCreate) throw Error("Choose an existing ingredient for " + name + ".");
      item = { id: crypto.randomUUID(), name, unit: d.unit.trim().slice(0, 16) || "piece" };
      created.push(item);
    }
    if (uses.some((u) => u.stockId === item!.id)) throw Error(name + " is listed twice.");
    uses.push({ stockId: item.id, amount });
  }
  return { uses, created };
}

export function usesText(p: Product, stockItems: StockItem[] | undefined) {
  return (p.uses ?? [])
    .map((u) => stockItems?.find((s) => s.id === u.stockId)?.name)
    .filter(Boolean)
    .join(", ");
}
