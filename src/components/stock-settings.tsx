"use client";

import { useState } from "react";
import { CookingPot, Minus, Package, Plus, StickyNote, Tags, Trash2 } from "lucide-react";
import { SuggestInput } from "./combobox";
import { amountText, parseMoney } from "@/lib/domain";
import { matchesFilters, type FilterFacets, type FilterSelection } from "@/lib/filters";
import { currencyDigits } from "@/lib/settings";
import { stockListFields, stockListKey, stockListsOf } from "@/lib/stock-lists";
import { catalogSku, menuRecipeCost, prepCost, round, stockCostRates, stockModel, stockUnitCost, suggestedPrice, unitFor, units } from "@/lib/stock";
import type { PricingRules, Product, StockItem, StockItemDetails, StockListField, StockPrep, StockPurchase, StockUse } from "@/lib/types";
import { SetupDetails, SubPage, useCommit } from "./settings";
import { RecordFilters } from "./filter-controls";
import type { RecipesProps } from "./recipes";
import { buzz, Explain, formatMoney, MoneyField, Sheet } from "./ui";
import { matches, namesText, plural, RecordAdd, RecordEmpty, RecordGroup, RecordNoMatch, RecordRow, RecordSearch, RecordSheet, useRecordSave } from "./records";

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
  stockLists,
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
  stockLists: Record<StockListField, string[]>;
  prepOnly?: boolean;
  onSave: (item: StockItem) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [itemId] = useState(() => item?.id ?? crypto.randomUUID());
  const generatedSku = catalogSku("stock", itemId);
  function listName(field: StockListField, value?: string) {
    const key = stockListKey(value);
    return stockLists[field].find((name) => stockListKey(name) === key) ?? value?.trim();
  }
  const [details, setDetails] = useState<StockItemDetails>(() => ({
    ...item?.details,
    category: listName("category", item?.details?.category),
    kind: listName("kind", item?.details?.kind),
    supplier: listName("supplier", item?.details?.supplier),
  }));
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
  const unitName = unit.trim() || "unit";
  const missing = costPerUnit !== undefined
    ? undefined
    : prepared
      ? !ingredients.length
        ? "Add what goes into it in Stock items first, like cream or sugar, with what you pay for it."
        : !(Number(batchYield) > 0)
          ? "Enter how much one batch makes to see its cost per " + unitName + "."
          : costGap(stockUseRows(drafts, ingredients), "batch") ?? "Add what goes into one batch."
      : !purchasePrice
        ? "Enter what you pay to see what one " + unitName + " costs you."
        : !(Number(packQuantity) > 0)
          ? "Enter how much you get for that price."
          : "Check the usable amount. It goes from 1 to 100%.";

  return (
    <RecordSheet
      noun={prepOnly || item?.prep ? "prep item" : "stock item"}
      help={
        <>
          <p>
            {prepared
              ? "It's counted when a shift opens and closes, like other stock. Menu items that use it pick up its cost."
              : "It's counted when a shift opens and closes. Then pick it on the menu items that use it."}
          </p>
          <p>New names under {prepared ? "Recipe details" : "Purchasing details"} are added to Stock lists when you save.</p>
        </>
      }
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
        const sku = details.sku?.trim();
        const savedDetails = {
          sku: sku && sku !== generatedSku ? sku : undefined,
          category: listName("category", details.category) || undefined,
          kind: listName("kind", details.kind) || undefined,
          packDescription: details.packDescription?.trim() || undefined,
          supplier: listName("supplier", details.supplier) || undefined,
          costUpdatedOn: details.costUpdatedOn || undefined,
          notes: details.notes?.trim() || undefined,
        };
        return onSave({
          id: itemId,
          name: name.trim(),
          unit: unit.trim(),
          ...(purchase ? { purchase } : {}),
          ...(prepared ? { prep: readPrep() } : {}),
          ...(Object.values(savedDetails).some((value) => value !== undefined) ? { details: savedDetails } : {}),
        });
      })}
      onRemove={onRemove}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={60}
            autoFocus={!item}
            placeholder={prepOnly ? "e.g. Sea salt cream" : "e.g. Fresh milk"}
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
            <span>How you get it</span>
            <div className="segmented" role="group" aria-label="How you get it">
              <button type="button" aria-pressed={!prepared} onClick={() => setPrepared(false)}>Buy it</button>
              <button type="button" aria-pressed={prepared} onClick={() => setPrepared(true)}>Make it</button>
            </div>
            {prepared && !item?.prep && <span className="label">Once saved, it moves to Prep.</span>}
          </div>
        )}
      </div>
      {prepared ? (
        <div className="card card-pad stack gap-14">
          <h3 className="strong">One batch</h3>
          <label className="field">
            <span>Makes{unit.trim() ? ` (${unit.trim()})` : ""}</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="e.g. 1"
              value={batchYield}
              onChange={(e) => setBatchYield(decimalEntry(e.target.value))}
            />
          </label>
          <div className="field">
            <span>What goes in</span>
            <UsesEditor stockItems={ingredients} uses={drafts} currency={currency} batch onChange={setDrafts} />
          </div>
          <MoneyField label="Other costs per batch" value={extraBatchCost} onChange={setExtraBatchCost} currency={currency} placeholder="Optional, like gas" />
          {batchCost !== undefined && costPerUnit !== undefined ? (
            <div className="cost-result" aria-live="polite">
              <span className="label">{formatMoney(Math.round(batchCost), currency)} a batch</span>
              <span className="num">{costPerUnit} / {unitName}</span>
            </div>
          ) : (
            <p className="cost-missing" aria-live="polite">{missing}</p>
          )}
        </div>
      ) : (
        <div className="card card-pad stack gap-14">
          <h3 className="strong">What you pay</h3>
          <div className="grid-2">
            <MoneyField label="Price" value={purchasePrice} onChange={setPurchasePrice} currency={currency} placeholder="e.g. 95" />
            <label className="field">
              <span>For ({unitName})</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="e.g. 1"
                value={packQuantity}
                onChange={(e) => setPackQuantity(decimalEntry(e.target.value))}
              />
            </label>
          </div>
          <div className="field">
            <span className="field-head">
              Usable (%)
              <Explain title="Usable amount">
                <p>Some of what you buy never reaches a cup or plate: peels, trimmings, spills.</p>
                <p>If 1 kg of mangoes gives you 800 g you can use, enter <strong>80</strong>. The cost of what you use goes up to cover the waste.</p>
                <p>Leave it at 100 if nothing is lost.</p>
              </Explain>
            </span>
            <input
              className="input"
              inputMode="decimal"
              aria-label="Usable (%)"
              placeholder="100"
              value={yieldPercent}
              onChange={(e) => setYieldPercent(decimalEntry(e.target.value))}
            />
          </div>
          {costPerUnit !== undefined ? (
            <div className="cost-result" aria-live="polite">
              <span className="label">Costs you</span>
              <span className="num">{costPerUnit} / {unitName}</span>
            </div>
          ) : (
            <p className="cost-missing" aria-live="polite">{missing}</p>
          )}
        </div>
      )}
      <SetupDetails
        title={prepared ? "Recipe details" : "Purchasing details"}
        description={prepared ? "SKU, category and notes" : "SKU, supplier and notes"}
        className="card card-pad"
      >
        <div className="stack gap-14">
          <label className="field">
            <span>SKU</span>
            <input className="input" maxLength={64} value={details.sku ?? generatedSku} onChange={(e) => setDetails({ ...details, sku: e.target.value })} />
          </label>
          {prepared ? (
            <StockListInput
              field="category"
              label="Prep category"
              value={details.category ?? ""}
              names={stockLists.category}
              onChange={(category) => setDetails({ ...details, category })}
            />
          ) : (
            <>
              <StockListInput
                field="kind"
                label="Stock type"
                value={details.kind ?? ""}
                names={stockLists.kind}
                onChange={(kind) => setDetails({ ...details, kind })}
              />
              <label className="field">
                <span>Purchase / pack description</span>
                <input className="input" maxLength={120} value={details.packDescription ?? ""} onChange={(e) => setDetails({ ...details, packDescription: e.target.value })} />
              </label>
              <StockListInput
                field="supplier"
                label="Supplier / source"
                value={details.supplier ?? ""}
                names={stockLists.supplier}
                onChange={(supplier) => setDetails({ ...details, supplier })}
              />
              <label className="field">
                <span>Cost last updated</span>
                <input className="input" type="date" max="9999-12-31" value={details.costUpdatedOn ?? ""} onChange={(e) => setDetails({ ...details, costUpdatedOn: e.target.value })} />
              </label>
            </>
          )}
          <label className="field">
            <span>Notes</span>
            <textarea className="input" aria-label="Notes" rows={2} maxLength={400} value={details.notes ?? ""} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
          </label>
        </div>
      </SetupDetails>
      {item && (
        <p className="label">
          {users.length
            ? "Used by " + namesText(users, 3) + "." + (onRemove ? " Removing it stops those items using it." : "")
            : "No menu item uses it yet. Open a menu item and set Stock to Uses stock."}
        </p>
      )}
      {recipeUsers.length > 0 && <p className="label">Used in {namesText(recipeUsers, 3)}. Remove it from those recipes before deleting it.</p>}
    </RecordSheet>
  );
}

function StockListInput({ field, label, value, names, onChange }: {
  field: StockListField;
  label: string;
  value: string;
  names: string[];
  onChange: (value: string) => void;
}) {
  const { maxLength, noun, placeholder } = stockListFields[field];
  return (
    <div className="field">
      <span>{label}</span>
      <SuggestInput
        label={label}
        value={value}
        suggestions={names.map((name) => ({ key: stockListKey(name), name }))}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        newText={`New ${noun}`}
      />
    </div>
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

/**
 * Why a recipe's cost can't be worked out yet, as the one thing to do next.
 * Undefined when every named line has a cost.
 */
export function costGap(rows: ReturnType<typeof stockUseRows>, per: "batch" | "sale") {
  for (const { draft, item, cost } of rows) {
    const name = draft.name.trim();
    if (!name || cost !== undefined) continue;
    if (!item) return `Pick ${name} from the list, or add it in Stock items first.`;
    if (!(Number(draft.amount) > 0)) return `Enter how much ${item.name} one ${per} uses.`;
    if (item.prep) return `${item.name} isn't costed yet. Finish its recipe in Prep.`;
    return `${item.name} has no price yet. Add what you pay for it in Stock items.`;
  }
}

const stockFilterNames = { category: "Prep category", kind: "Stock type", supplier: "Supplier", cost: "Cost", menu: "Menu use" };
type StockFilter = keyof typeof stockFilterNames;

/** Things counted when a shift opens and closes, like a pack of strawberries or a kilo of ice. */
export function StockPage({ prepOnly = false, ...props }: RecipesProps & { prepOnly?: boolean }) {
  const business = props.state.business!;
  const list = business.settings.stockItems ?? [];
  const stockLists = stockListsOf(business.settings);
  const menu = props.state.menu;
  const commit = useCommit(props);
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const rows = list.filter((item) => Boolean(item.prep) === prepOnly);
  const rates = stockCostRates(list);
  const legacy = prepOnly ? [] : stockModel([], menu).items;
  const count = rows.length + legacy.length;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterSelection<StockFilter>>({});
  const noun = prepOnly ? "prep" : "stock items";
  function entry(item: StockItem, legacy = false) {
    const users = legacy ? [item.name] : usedBy(menu, item.id);
    const rate = legacy ? undefined : rates.get(item.id);
    const facet = (label?: string) => label ? [{ value: label, label }] : [];
    const detail = (field: StockListField) => {
      const key = stockListKey(item.details?.[field]);
      return facet(stockLists[field].find((name) => stockListKey(name) === key));
    };
    const facets: FilterFacets<StockFilter> = {
      ...(prepOnly ? { category: detail("category") } : { kind: detail("kind"), supplier: detail("supplier") }),
      cost: facet(rate === undefined ? "Not costed yet" : "Costed"),
      menu: facet(users.length ? "On the menu" : "Not on the menu"),
    };
    return { item, users, rate, facets, legacy };
  }
  const entries = [...rows.map((item) => entry(item)), ...legacy.map((item) => entry(item, true))];
  const searched = entries.filter(({ item, users, facets }) => matches(
    query, item.name, item.unit, item.details?.sku, facets.category?.[0]?.label, facets.kind?.[0]?.label, facets.supplier?.[0]?.label, ...users,
  ));
  const shown = searched.filter(({ facets }) => matchesFilters(facets, filter));
  const shownRows = shown.filter((row) => !row.legacy);
  const shownLegacy = shown.filter((row) => row.legacy);
  const sentence = prepOnly
    ? count
      ? <>{plural(count, "thing")} <span className="g">you make ahead, counted like stock.</span></>
      : <>Make it once, <span className="g">cost it per cup.</span></>
    : count
      ? <>{plural(count, "thing")} <span className="g">you buy, counted when a shift opens and closes.</span></>
      : <>Nothing counted yet. <span className="g">Add what runs out, like milk or ice.</span></>;
  return (
    <SubPage
      title={prepOnly ? "Prep" : "Stock items"}
      help={prepOnly ? (
        <>
          <p>Things you make ahead in batches, like syrups and creams. Enter what goes in and how much one batch makes, and you'll see what each unit costs.</p>
          <p>Prep is counted at opening and closing like other stock. Already counting something you make? Open it in Stock items and choose <strong>Make it</strong>.</p>
        </>
      ) : (
        <>
          <p>What you buy and count when a shift opens and closes, like milk or ice. Menu items use them per sale, and an item sells out when its stock runs out.</p>
          <p>New stock items are counted from the next shift. Things you make ahead are in Prep.</p>
        </>
      )}
      backLabel="Back to recipes"
      sentence={sentence}
      onBack={() => props.onPage(null)}
    >
      <div className="row gap-8">
        <RecordAdd label={prepOnly ? "Add prep item" : "Add stock item"} disabled={!props.online || list.length >= 100} onClick={() => setEditing("new")} />
        <button type="button" className="btn ghost" onClick={() => props.onPage("stock-lists")}>
          <Tags size={16} /> Stock lists
        </button>
      </div>
      {count > 0 && (
        <RecordSearch
          count={count}
          noun={noun}
          query={query}
          onQuery={setQuery}
          alwaysSearch
        />
      )}
      <RecordFilters
        noun={noun}
        label={prepOnly ? "Filter by category, cost, menu use…" : "Filter by stock type, supplier, cost…"}
        names={stockFilterNames}
        rows={entries.map(({ facets }) => facets)}
        searched={searched.map(({ facets }) => facets)}
        filter={filter}
        onChange={setFilter}
      />
      {count > 0 && !shownRows.length && !shownLegacy.length && (
        <RecordNoMatch
          query={query}
          onClear={() => {
            setQuery("");
            setFilter({});
          }}
        />
      )}
      {shownRows.length > 0 && (
        <RecordGroup title={shownLegacy.length ? "Stock items" : undefined}>
          {shownRows.map(({ item, users, rate }) => {
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
                detail={prepOnly && rate === undefined ? "Not costed yet" : users.length ? "Used by " + namesText(users, 1) : "Not on the menu yet"}
                end={rate === undefined ? item.unit : `${formatStockRate(rate, business.currency)} / ${item.unit}`}
              />
            );
          })}
        </RecordGroup>
      )}
      {!count && (
        <RecordEmpty
          icon={prepOnly ? <CookingPot size={22} strokeWidth={1.6} /> : <Package size={22} strokeWidth={1.6} />}
          title={prepOnly ? "Nothing made ahead yet" : "No stock items yet"}
          text={prepOnly
            ? "Syrups, creams and sauces you make in batches. Enter what goes in and how much it makes, and you'll see what each unit costs."
            : "Add one here, or right from a menu item while you set it up."}
        />
      )}
      {shownLegacy.length > 0 && (
        <RecordGroup title="Menu items counted themselves">
          {shownLegacy.map(({ item: i }) => {
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
      {!props.online && <p className="label">Connect to edit {prepOnly ? "prep" : "stock items"}.</p>}
      {editing && (
        <StockSheet
          stockItems={list}
          stockLists={stockLists}
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
                stockLists: stockListsOf({ ...business.settings, stockItems: [...list, item] }),
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
                      commit.input({ stockItems: list.filter((i) => i.id !== editing.id), stockLists }),
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

export type UseDraft = { key: string; stockId?: string; name: string; amount: string; unit: string; notes?: string };

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
    return item ? [{ key: u.stockId, stockId: u.stockId, name: item.name, amount: String(u.amount), unit: item.unit, notes: u.notes }] : [];
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
  const [note, setNote] = useState<{ key: string; text: string }>();
  const notedUse = uses.find((use) => use.key === note?.key);
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
            {u.name.trim() && (
              <button
                type="button"
                className="round flat ingredient-note-button"
                data-has-note={u.notes?.trim() ? "true" : undefined}
                aria-label={`Note for ${u.name.trim()}`}
                aria-haspopup="dialog"
                onClick={() => setNote({ key: u.key, text: u.notes ?? "" })}
              >
                <StickyNote size={16} />
              </button>
            )}
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
            <div className="use-amount-group">
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
            </div>
            <div className="use-amount-group">
              {known ? (
                <span className="use-unit">{unitFor(amount, known.unit)}</span>
              ) : !batch && u.name.trim() && (
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
              <span>each {per}</span>
            </div>
          </div>
          {showCosts && u.name.trim() && (
            <p className="label">{cost === undefined ? "No cost yet" : formatMoney(Math.round(cost), currency)}</p>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn secondary compact"
        aria-label={batch ? "Add ingredient" : "Add stock item"}
        disabled={uses.length >= 20}
        onClick={() => onChange([...uses, blankUseDraft()])}
      >
        <Plus size={16} /> Add
      </button>
      {note && notedUse && (
        <Sheet
          title={`Note for ${notedUse.name.trim()}`}
          onClose={() => setNote(undefined)}
          footer={
            <button
              type="button"
              className="btn block"
              onClick={() => {
                set(note.key, { notes: note.text.trim() });
                setNote(undefined);
              }}
            >
              Save
            </button>
          }
        >
          <textarea
            className="input"
            aria-label="Ingredient note"
            rows={3}
            maxLength={160}
            value={note.text}
            onChange={(event) => setNote({ ...note, text: event.target.value })}
          />
        </Sheet>
      )}
    </div>
  );
}

export function CostPreview({ currency, total, batch, missing, pricing, target }: {
  currency: string;
  total: ReturnType<typeof menuRecipeCost>;
  batch: boolean;
  /** What to do next when the cost can't be worked out yet. */
  missing?: string;
  pricing: PricingRules;
  target: number | undefined;
}) {
  const [trialMargin, setTrialMargin] = useState<string>();
  const [trialIncrement, setTrialIncrement] = useState<string>();
  let suggested: number | undefined;
  if (total) {
    try {
      const margin = trialMargin ? Number(trialMargin) : target;
      const increment = trialIncrement ? parseMoney(trialIncrement, currency) : pricing.roundingIncrement;
      if (margin !== undefined) suggested = suggestedPrice(total.cost, margin, increment);
    } catch {
      // The preview updates once the rounding amount is valid.
    }
  }
  const formatCost = (value: number) => formatMoney(Math.round(value), currency);
  const percent = (value: number) => new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 }).format(value);
  if (!total)
    return (
      <p className="cost-missing" aria-live="polite">
        {missing ?? "Check the quantities and costs above."}
      </p>
    );
  return (
    <div className="stack gap-10">
      <div className="cost-result" aria-live="polite" aria-atomic="true">
        <span className="label">Costs you per serving</span>
        <span className="num">{formatCost(total.cost)}</span>
      </div>
      <dl className="stack gap-8 label">
        <div className="between">
          <dt>Cost % of price</dt>
          <dd className="strong">{total.costRatio === undefined ? "—" : percent(total.costRatio)}</dd>
        </div>
        <div className="between">
          <dt>You keep per serving</dt>
          <dd className="strong">{total.profit === undefined ? "—" : formatCost(total.profit)}</dd>
        </div>
        <div className="between">
          <dt className="field-head">
            Margin
            <Explain title="Margin">
              <p>The share of the price you keep after what it costs to make.</p>
              <p>A {formatMoney(currency === "PHP" ? 16000 : 500, currency)} drink that costs {formatMoney(currency === "PHP" ? 4000 : 125, currency)} to make keeps {formatMoney(currency === "PHP" ? 12000 : 375, currency)}: a <strong>75%</strong> margin.</p>
              <p>Rent, salaries and other shift costs aren't counted here. The shift report covers those.</p>
            </Explain>
          </dt>
          <dd className="strong">{total.margin === undefined ? "—" : percent(total.margin)}</dd>
        </div>
        {batch && (
          <div className="between"><dt>Ingredients for the batch</dt><dd className="strong">{formatCost(total.batchMaterialCost)}</dd></div>
        )}
        {batch && (
          <div className="between"><dt>Ingredients per serving</dt><dd className="strong">{formatCost(total.materialPerServing)}</dd></div>
        )}
      </dl>
      <SetupDetails
        title={suggested === undefined ? "Suggested price" : `Suggested price · ${formatMoney(suggested, currency)}`}
        description="Try another margin or rounding amount"
      >
        <div className="grid-2">
          <label className="field">
            <span>Try a margin (%)</span>
            <input className="input" inputMode="decimal" placeholder={target?.toString()} value={trialMargin ?? ""} onChange={(e) => setTrialMargin(decimalEntry(e.target.value))} />
          </label>
          <MoneyField label="Try rounding up to" placeholder={amountText(pricing.roundingIncrement, currency)} value={trialIncrement ?? ""} onChange={setTrialIncrement} currency={currency} />
        </div>
      </SetupDetails>
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
    const notes = d.notes?.trim();
    uses.push({ stockId: item.id, amount, ...(notes ? { notes } : {}) });
  }
  return { uses, created };
}

export function usesText(p: Product, stockItems: StockItem[] | undefined) {
  return (p.uses ?? [])
    .map((u) => stockItems?.find((s) => s.id === u.stockId)?.name)
    .filter(Boolean)
    .join(", ");
}
