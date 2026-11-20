"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, LayoutGrid, ListPlus, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import type { OptionGroup, Product, ProductCosting, StockItem } from "@/lib/types";
import { amountText, parseMoney, saveMenuItem } from "@/lib/domain";
import { isSimpleMode } from "@/lib/settings";
import { maxBatchServings, menuRecipeCost } from "@/lib/stock";
import { SubPage, useCommit } from "./settings";
import type { RecipesProps } from "./recipes";
import { blankUseDraft, costGap, CostPreview, countOf, resolveUses, StockCount, stockForUse, stockUseRows, UsesEditor, useDrafts, usesText } from "./stock-settings";
import { SuggestInput, type Suggestion } from "./combobox";
import { buzz, Explain, formatMoney, Money, MoneyField, PhotoPicker, Switch } from "./ui";
import {
  namesText,
  PickChips,
  plural,
  RecordAdd,
  RecordEmpty,
  RecordGroup,
  RecordRow,
  RecordSheet,
  useRecordSave,
} from "./records";

/* ---------- shared pieces ---------- */

type OptionDraft = { id: string; name: string; price: string };
type GroupDraft = Omit<OptionGroup, "options"> & { options: OptionDraft[] };

/** "30" rather than "30.00", so a short price field shows the whole number. */
const priceText = (minor: number, currency: string) => (minor ? amountText(minor, currency).replace(/\.0+$/, "") : "");

const blankOption = (): OptionDraft => ({ id: crypto.randomUUID(), name: "", price: "" });

/** A choice's identity across the menu: the same name, kind and options. */
function choiceKey(g: OptionGroup) {
  return (
    (g.required ? "1" : "0") +
    g.name.trim().toLocaleLowerCase() +
    "|" +
    g.options.map((o) => o.name.trim().toLocaleLowerCase() + ":" + o.price).join(",")
  );
}

/** Categories, choices and options already on the menu, so they're picked instead of retyped. */
function reusable(menu: Product[], skip: string | undefined, currency: string) {
  const categories = Array.from(new Set(menu.map((m) => m.category.trim()).filter(Boolean)));
  const groups = new Map<string, { key: string; name: string; required: boolean; detail: string; options: { name: string; price: string }[] }>();
  const options = new Map<string, Suggestion & { price: string }>();
  for (const item of menu) {
    if (item.id === skip) continue;
    for (const g of item.groups ?? []) {
      const key = choiceKey(g);
      if (!groups.has(key))
        groups.set(key, {
          key,
          name: g.name,
          required: g.required,
          options: g.options.map((o) => ({ name: o.name, price: priceText(o.price, currency) })),
          detail: `${g.options.map((o) => o.name).join(", ")} · from ${item.name}`,
        });
      for (const o of g.options) {
        const okey = o.name.toLocaleLowerCase() + "|" + o.price;
        if (!options.has(okey))
          options.set(okey, {
            key: okey,
            name: o.name,
            price: priceText(o.price, currency),
            detail: o.price ? "+" + formatMoney(o.price, currency) : "No extra charge",
          });
      }
    }
  }
  return { categories, groups: [...groups.values()], options: [...options.values()] };
}

function parseOptions(options: OptionDraft[], currency: string) {
  if (!options.length || options.some((o) => !o.name.trim())) throw Error("Name every option, or remove the empty ones.");
  return options.map((o) => ({ id: o.id, name: o.name.trim(), price: parseMoney(o.price || "0", currency) }));
}

/** The options of one choice: a name, an extra price and a remove button each. */
function OptionRows({
  options,
  required,
  currency,
  suggestions,
  onChange,
}: {
  options: OptionDraft[];
  required: boolean;
  currency: string;
  suggestions: (Suggestion & { price: string })[];
  onChange: (options: OptionDraft[]) => void;
}) {
  const set = (id: string, patch: Partial<OptionDraft>) =>
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  return (
    <div className="stack gap-8">
      {options.map((o, i) => (
        <div className="option-row" key={o.id}>
          <SuggestInput
            className="grow"
            label={`Option ${i + 1} name`}
            placeholder={required ? (i ? "Large" : "Regular") : "Extra shot"}
            value={o.name}
            newText="New option"
            suggestions={suggestions.filter((r) => !options.some((x) => x.name.trim() === r.name))}
            onChange={(name) => set(o.id, { name })}
            onPick={(pick) => {
              const r = suggestions.find((x) => x.key === pick.key)!;
              set(o.id, { name: r.name, price: r.price });
            }}
          />
          <span className="money-input option-price">
            <input
              className="input"
              aria-label={`Option ${i + 1} extra price`}
              inputMode="decimal"
              placeholder="0"
              value={o.price}
              onChange={(e) => set(o.id, { price: e.target.value.replace(/[^\d.]/g, "") })}
            />
            <span className="prefix">+</span>
          </span>
          <button
            type="button"
            className="round flat"
            aria-label={`Remove option ${i + 1}`}
            disabled={options.length === 1}
            onClick={() => onChange(options.filter((r) => r.id !== o.id))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn secondary compact" onClick={() => onChange([...options, blankOption()])}>
        <Plus size={16} /> Option
      </button>
    </div>
  );
}

function Thumb({ src }: { src?: string }) {
  return src ? (
    <img className="thumb" src={src} alt="" width={40} height={40} />
  ) : (
    <span className="well">
      <ImageIcon size={18} strokeWidth={1.6} className="g" />
    </span>
  );
}

/* ---------- menu item ---------- */

type StockMode = "off" | "count" | "uses";

export function ItemSheet({
  product,
  currency,
  menu,
  simple = false,
  liveShift = false,
  counted = [],
  stockItems = [],
  costItems,
  canCreateStock = false,
  onSave,
  onRemove,
  onClose,
}: {
  product?: Product;
  simple?: boolean;
  /** What the item can use up with each sale. */
  stockItems?: StockItem[];
  /** Current cost sources when the till limits selection to its opening stock. */
  costItems?: StockItem[];
  /** New stock item names typed here can be added to Settings when the item saves. */
  canCreateStock?: boolean;
  currency: string;
  /** The rest of the menu, whose categories, choices and options can be reused. */
  menu: Product[];
  /** A new item goes on sale on the shift open on this phone, so ask how many there are. */
  liveShift?: boolean;
  /** Stock items the open shift already counts. */
  counted?: string[];
  /**
   * counts: how many there are now, by stock item id (or the item's own id when it is
   * counted itself), for what the open shift doesn't count yet.
   * created: stock items typed here that don't exist yet.
   */
  onSave: (p: Product, counts?: Record<string, number>, created?: StockItem[]) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [itemId] = useState(() => product?.id ?? crypto.randomUUID());
  const [name, setName] = useState(product?.name ?? "");
  const [mode, setMode] = useState<StockMode>(product?.uses?.length ? "uses" : product?.stock ? "count" : "off");
  const [uses, setUses] = useState(() => {
    const drafts = useDrafts(product?.uses, stockItems);
    return drafts.length ? drafts : [blankUseDraft()];
  });
  const batchItems = costItems ?? stockItems;
  const [batchEnabled, setBatchEnabled] = useState(Boolean(product?.costing?.batch));
  const [batchServings, setBatchServings] = useState(String(product?.costing?.batch?.servings ?? 1));
  const [batchUses, setBatchUses] = useState(() => {
    const drafts = useDrafts(product?.costing?.batch?.uses, batchItems);
    return drafts.length ? drafts : [blankUseDraft()];
  });
  const [labor, setLabor] = useState(priceText(product?.costing?.laborPerServing ?? 0, currency));
  const [other, setOther] = useState(priceText(product?.costing?.otherPerServing ?? 0, currency));
  const [count, setCount] = useState("");
  const askCount = mode === "count" && liveShift && !product;
  // A new item that uses a stock item the shift didn't count at opening needs that count
  // now, or its sales would never draw it down.
  const [useCounts, setUseCounts] = useState<Record<string, string>>({});
  const uncountedUses = liveShift && !product && !simple && mode === "uses"
    ? uses.filter((u, i) => {
        if (!u.name.trim()) return false;
        const item = stockForUse(u, stockItems);
        if (item ? counted.includes(item.id) : !canCreateStock) return false;
        // The same stock item typed twice is asked once.
        return uses.findIndex((o) => o.name.trim().toLocaleLowerCase() === u.name.trim().toLocaleLowerCase()) === i;
      })
    : [];
  const useCountsReady = uncountedUses.every((u) => countOf(useCounts[u.key]) !== undefined);
  const [price, setPrice] = useState(product ? priceText(product.price, currency) || "0" : "");
  let sellingPrice: number | undefined;
  if (price) {
    try {
      sellingPrice = parseMoney(price, currency);
    } catch {
      // Wait for a complete selling price before previewing margins.
    }
  }
  const [category, setCategory] = useState(product?.category ?? "");
  const [image, setImage] = useState(product?.image);
  const reuse = useMemo(() => reusable(menu, product?.id, currency), [menu, product?.id, currency]);
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    (product?.groups ?? []).map((g) => ({
      ...g,
      options: g.options.map((o) => ({ ...o, price: priceText(o.price, currency) })),
    })),
  );
  const { busy, error, run } = useRecordSave(onClose);
  const setGroup = (id: string, fn: (g: GroupDraft) => GroupDraft) =>
    setGroups((all) => all.map((g) => (g.id === id ? fn(g) : g)));
  const usesChanged =
    JSON.stringify(useDrafts(product?.uses, stockItems).map((u) => [u.stockId, u.amount])) !==
    JSON.stringify(mode === "uses"
      ? uses.filter((u) => u.name.trim()).map((u) => [stockForUse(u, stockItems)?.id ?? u.name.trim(), u.amount])
      : []);
  const costRows = simple ? [] : batchEnabled
    ? stockUseRows(batchUses, batchItems)
    : mode === "uses" ? stockUseRows(uses, stockItems, costItems) : [];
  const recipeCosts = costRows.filter(({ draft }) => draft.name.trim()).map(({ cost }) => cost);
  const showCostPreview = !simple && (batchEnabled || recipeCosts.length > 0 || Boolean(labor || other));
  const optionalMoney = (value: string) => value === "" ? undefined : parseMoney(value, currency);
  let totalCost: ReturnType<typeof menuRecipeCost>;
  if (showCostPreview) {
    try {
      totalCost = menuRecipeCost(
        recipeCosts, batchEnabled ? Number(batchServings) : 1,
        optionalMoney(labor) ?? 0, optionalMoney(other) ?? 0, sellingPrice,
      );
    } catch {
      // Recalculate when a serving cost is valid.
    }
  }

  const costMissing = costGap(costRows, batchEnabled ? "batch" : "sale")
    ?? (batchEnabled && !(Number.isInteger(Number(batchServings)) && Number(batchServings) >= 1)
      ? "Enter how many servings one batch makes."
      : !costRows.some(({ draft }) => draft.name.trim())
        ? batchEnabled ? "Add what goes into the batch." : "Pick the stock items one sale uses, under Stock."
        : undefined);

  function readCosting(): ProductCosting | undefined {
    const laborPerServing = optionalMoney(labor);
    const otherPerServing = optionalMoney(other);
    let batch: ProductCosting["batch"];
    if (batchEnabled) {
      const servings = Number(batchServings);
      if (!Number.isInteger(servings) || servings < 1 || servings > maxBatchServings)
        throw Error("Enter a whole number of servings per batch, from 1 to 100,000.");
      const { uses } = resolveUses(batchUses, batchItems, false);
      if (!uses.length) throw Error("Add at least one ingredient to the batch recipe.");
      batch = { servings, uses };
    }
    if (!batch && laborPerServing === undefined && otherPerServing === undefined) return undefined;
    return {
      ...(batch ? { batch } : {}),
      ...(laborPerServing !== undefined ? { laborPerServing } : {}),
      ...(otherPerServing !== undefined ? { otherPerServing } : {}),
    };
  }

  function save() {
    void run(async () => {
      const saved = groups.map((g) => {
        if (!g.name.trim()) throw Error("Name each choice, like Size or Extras.");
        return { id: g.id, name: g.name.trim(), required: g.required, options: parseOptions(g.options, currency) };
      });
      const editUses = !simple && mode === "uses";
      const { uses: picked, created } = editUses
        ? resolveUses(uses, stockItems)
        : { uses: simple ? product?.uses ?? [] : [], created: [] };
      if (editUses && !picked.length) throw Error("Type the stock items it uses, or set Stock to Off.");
      if (created.length && !canCreateStock)
        throw Error("Add " + created.map((c) => c.name).join(", ") + " in Recipes › Stock items first, or pick one from the list.");
      const costing = simple ? product?.costing : readCosting();
      const { stock: _, image: _image, uses: _uses, costing: _costing, ...rest } = product ?? ({} as Partial<Product>);
      let counts: Record<string, number> | undefined;
      if (askCount) counts = { [itemId]: Number(count) };
      else if (uncountedUses.length) {
        counts = {};
        for (const u of uncountedUses) {
          const item = stockForUse(u, stockItems) ?? created.find((c) => c.name.toLocaleLowerCase() === u.name.trim().toLocaleLowerCase());
          const n = countOf(useCounts[u.key]);
          if (item && n !== undefined) counts[item.id] = n;
        }
      }
      return onSave(
        {
          ...rest,
          id: itemId,
          name: name.trim(),
          category: category.trim(),
          price: parseMoney(price, currency),
          groups: saved,
          ...(image ? { image } : {}),
          ...(picked.length ? { uses: picked } : mode === "count" ? { stock: true } : {}),
          ...(costing ? { costing } : {}),
        },
        counts,
        created,
      );
    });
  }

  return (
    <RecordSheet
      noun="item"
      editing={Boolean(product)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim() && price.trim() && (!askCount || count.trim()) && useCountsReady)}
      onSave={save}
      removeLabel="Remove from menu"
      onRemove={onRemove && (() => void run(onRemove))}
      onClose={onClose}
    >
      <div className="card card-pad">
        <PhotoPicker value={image} onChange={setImage} label="item photo" />
      </div>
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={80}
            autoFocus={!product}
            placeholder="e.g. Iced Spanish latte"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <MoneyField label="Price" value={price} onChange={setPrice} currency={currency} />
        <div className="field">
          <span>Category</span>
          <SuggestInput
            label="Category"
            maxLength={60}
            placeholder="e.g. Drinks"
            value={category}
            newText="New category"
            suggestions={reuse.categories.map((c) => ({
              key: c,
              name: c,
              detail: plural(menu.filter((m) => m.category.trim() === c && m.id !== product?.id).length, "item"),
            }))}
            onChange={setCategory}
          />
        </div>
      </div>

      {(!simple || !product?.uses?.length) && <div className="card card-pad stack gap-12">
        <span className="strong">Stock</span>
        <div className="segmented" role="group" aria-label="How this item is counted">
          {(
            [
              ["off", "Off"],
              ["count", "Count it"],
              ["uses", "Uses stock"],
            ] as const
          ).filter(([id]) => !simple || id !== "uses").map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => {
                buzz.tap();
                setMode(id);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <p className="label">
          {mode === "off"
            ? "Not counted. It sells without limit, like drinks made to order."
            : mode === "count"
              ? "For a set supply, like bread or pastries. You count it when the shift opens, and it sells out at zero."
              : "Each sale takes this much off a stock item, like 1 strawberry pack or 0.2 kg of ice."}
        </p>
        {mode === "uses" && (
          <UsesEditor stockItems={stockItems} costItems={costItems} uses={uses} currency={currency} showCosts={!batchEnabled} onChange={setUses} />
        )}
        {uncountedUses.length > 0 && (
          <div className="stack gap-8">
            <span className="field-label">How much do you have now?</span>
            <div>
              {uncountedUses.map((u) => (
                <StockCount
                  key={u.key}
                  item={stockForUse(u, stockItems) ?? { id: u.key, name: u.name.trim(), unit: u.unit.trim() || "piece" }}
                  value={useCounts[u.key] ?? ""}
                  onChange={(v) => setUseCounts((all) => ({ ...all, [u.key]: v }))}
                />
              ))}
            </div>
          </div>
        )}
        {uncountedUses.length > 0 && (
          <p className="label">The till didn't count {uncountedUses.length === 1 ? "this" : "these"} at opening. It counts from now and asks for what's left at closing.</p>
        )}
        {askCount && (
          <label className="field">
            <span>How many do you have now?</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="0"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 5))}
            />
          </label>
        )}
        {product && liveShift && (usesChanged || Boolean(product.stock) !== (mode === "count")) && (
          <p className="label">Stock changes apply from the next shift.</p>
        )}
      </div>}

      {!simple && <section className="card card-pad stack gap-14" aria-label="Cost and margin">
        <h3 className="strong">Cost and margin</h3>
        <div className="between gap-12">
          <span className="row-text">
            <span>Made in batches</span>
            <span className="label">Like a pitcher that pours 10 cups</span>
          </span>
          <Switch checked={batchEnabled} onChange={setBatchEnabled} label="Made in batches" />
        </div>
        {batchEnabled && (
          <>
            <label className="field">
              <span>One batch makes (servings)</span>
              <input
                className="input"
                inputMode="numeric"
                value={batchServings}
                maxLength={9}
                onChange={(e) => setBatchServings(e.target.value)}
              />
            </label>
            <div className="field">
              <span className="field-head">
                What goes into the whole batch
                <Explain title="Batch costing">
                  This is for costing only. What the till takes off per sale is set under Stock.
                </Explain>
              </span>
              <UsesEditor stockItems={batchItems} uses={batchUses} currency={currency} batch onChange={setBatchUses} />
            </div>
          </>
        )}
        <div className="grid-2">
          <MoneyField label="Labor per serving" value={labor} onChange={setLabor} currency={currency} />
          <MoneyField label="Cups, lids, other" value={other} onChange={setOther} currency={currency} />
        </div>
        {showCostPreview ? (
          <CostPreview currency={currency} total={totalCost} batch={batchEnabled} missing={costMissing} />
        ) : (
          <p className="cost-missing">Set Stock to Uses stock, or turn on Made in batches, to see what it costs you.</p>
        )}
      </section>}

      {groups.map((g) => (
        <div className="card card-pad stack gap-12" key={g.id}>
          <div className="between">
            <span className="strong">{g.required ? "Pick one" : "Add-ons"}</span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setGroups((all) => all.filter((x) => x.id !== g.id))}
            >
              Remove
            </button>
          </div>
          <SuggestInput
            label="Choice name"
            placeholder={g.required ? "e.g. Size" : "e.g. Extras"}
            value={g.name}
            newText="New choice"
            suggestions={reuse.groups
              .filter((r) => r.required === g.required && !groups.some((x) => x.name.trim() === r.name && x.id !== g.id))
              .map((r) => ({ key: r.key, name: r.name, detail: r.detail }))}
            onChange={(name) => setGroup(g.id, (x) => ({ ...x, name }))}
            onPick={(pick) => {
              const r = reuse.groups.find((x) => x.key === pick.key)!;
              buzz.tick();
              setGroup(g.id, (x) => ({
                ...x,
                name: r.name,
                options: r.options.map((o) => ({ id: crypto.randomUUID(), name: o.name, price: o.price })),
              }));
            }}
          />
          <OptionRows
            options={g.options}
            required={g.required}
            currency={currency}
            suggestions={reuse.options}
            onChange={(options) => setGroup(g.id, (x) => ({ ...x, options }))}
          />
        </div>
      ))}
      <div className="grid-2">
        {[true, false].map((required) => (
          <button
            key={String(required)}
            type="button"
            className="btn secondary compact"
            onClick={() =>
              setGroups((all) => [...all, { id: crypto.randomUUID(), name: "", required, options: [blankOption()] }])
            }
          >
            <Plus size={16} /> {required ? "Pick one" : "Add-ons"}
          </button>
        ))}
      </div>
    </RecordSheet>
  );
}

export function MenuPage(props: RecipesProps) {
  const business = props.state.business!;
  const simple = isSimpleMode(business.settings);
  const menu = props.state.menu;
  const commit = useCommit(props);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const categories = Array.from(new Set(menu.map((m) => m.category).filter(Boolean)));
  const grouped = [...categories, ""].map((c) => ({ name: c, items: menu.filter((m) => (m.category || "") === c) }));
  const live = Boolean(props.state.shift && !props.state.shift.closedAt);
  return (
    <SubPage
      title="Menu items"
      help={
        <>
          <p>New items and changes to names, prices and options go live on Sell right away.</p>
          <p>Removing an item, or changing the stock it uses, takes effect when the next shift opens. To stop selling something now, mark it sold out on Sell.</p>
        </>
      }
      backLabel="Back to recipes"
      sentence={
        <>
          {plural(menu.length, "item")} <span className="g">for sale.</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <RecordAdd label="Add item" disabled={!props.online} onClick={() => setEditing("new")} />
      {!menu.length && (
        <RecordEmpty
          icon={<LayoutGrid size={22} strokeWidth={1.6} />}
          title="No items yet"
          text="Add what you sell, with a photo and a price. Sizes and add-ons come after."
        />
      )}
      {grouped
        .filter((g) => g.items.length)
        .map((g) => (
          <RecordGroup key={g.name || "none"} title={g.name || (categories.length ? "No category" : undefined)}>
            {g.items.map((p) => (
              <RecordRow
                key={p.id}
                disabled={!props.online}
                onClick={() => setEditing(p)}
                lead={<Thumb src={p.image} />}
                title={p.name}
                detail={
                  [
                    !simple && p.uses?.length ? "Uses " + usesText(p, business.settings.stockItems) : p.stock ? "Counted each shift" : "",
                    ...p.groups.map((x) => x.name),
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                end={<Money value={p.price} currency={business.currency} />}
              />
            ))}
          </RecordGroup>
        ))}
      {(!props.online || !live) && (
        <p className="label">
          {!props.online
            ? "Connect to edit the menu."
            : props.state.shift
              ? "Changes reach the register when the next shift opens."
              : "Changes reach the register when you open the next shift."}
        </p>
      )}
      {editing && (
        <ItemSheet
          key={simple ? "simple" : "advanced"}
          simple={simple}
          product={editing === "new" ? undefined : editing}
          currency={business.currency}
          menu={menu}
          liveShift={live}
          counted={Object.keys(props.state.shift?.stock ?? {})}
          stockItems={business.settings.stockItems}
          canCreateStock
          onClose={() => setEditing(null)}
          onSave={(item, counts, created = []) =>
            commit.run(async (pin) => {
              // Stock items typed for the first time are added before the item that uses them.
              if (created.length)
                await props.onSave(
                  commit.input({ stockItems: [...(business.settings.stockItems ?? []), ...created] }),
                  pin,
                );
              await props.onMenu(saveMenuItem(menu, item), pin, counts);
            }, editing === "new" ? "Added " + item.name : "Saved " + item.name)
          }
          onRemove={
            editing === "new" ? undefined : () => commit.menu(menu.filter((p) => p.id !== editing.id), "Removed " + editing.name)
          }
        />
      )}
    </SubPage>
  );
}

/* ---------- categories ---------- */

export function categoriesOf(menu: Product[]) {
  const map = new Map<string, Product[]>();
  for (const p of menu) {
    const c = p.category.trim();
    if (c) map.set(c, [...(map.get(c) ?? []), p]);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

function CategorySheet({
  category,
  menu,
  onSave,
  onRemove,
  onClose,
}: {
  category?: { name: string; items: Product[] };
  menu: Product[];
  onSave: (name: string, ids: string[]) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [picked, setPicked] = useState(category?.items.map((p) => p.id) ?? []);
  const { busy, error, run } = useRecordSave(onClose);
  const moving = menu.filter((p) => picked.includes(p.id) && p.category.trim() && p.category.trim() !== category?.name);
  return (
    <RecordSheet
      noun="category"
      help={
        <>
          <p>Sell groups items by category, in this order.</p>
          <p>Removing a category keeps its items on the menu, with no category.</p>
        </>
      }
      editing={Boolean(category)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim() && picked.length)}
      onSave={() => void run(() => onSave(name.trim(), picked))}
      onRemove={onRemove && (() => void run(onRemove))}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={60}
            autoFocus={!category}
            placeholder="e.g. Drinks"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Items in it</span>
          <PickChips label="Items in this category" items={menu} picked={picked} onChange={setPicked} />
          {moving.length > 0 && (
            <p className="label">
              {namesText(moving.map((p) => p.name)) + " will move here from " + namesText([...new Set(moving.map((p) => p.category.trim()))]) + "."}
            </p>
          )}
        </div>
      </div>
    </RecordSheet>
  );
}

export function CategoriesPage(props: RecipesProps) {
  const menu = props.state.menu;
  const commit = useCommit(props);
  const list = categoriesOf(menu);
  const [editing, setEditing] = useState<(typeof list)[number] | "new" | null>(null);
  const loose = menu.filter((p) => !p.category.trim()).length;
  return (
    <SubPage
      title="Categories"
      help={<p>Categories are the tabs on Sell, in this order. Changes go live on Sell right away. Items with no category show last.</p>}
      backLabel="Back to recipes"
      sentence={
        list.length ? (
          <>
            {plural(list.length, "category", "categories")} <span className="g">on the Sell screen.</span>
          </>
        ) : (
          <>
            No categories. <span className="g">Group items so they're quick to find.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      <RecordAdd label="Add category" disabled={!props.online || !menu.length} onClick={() => setEditing("new")} />
      {list.length > 0 ? (
        <RecordGroup>
          {list.map((c) => (
            <RecordRow
              key={c.name}
              disabled={!props.online}
              onClick={() => setEditing(c)}
              lead={
                <span className="well">
                  <TagIcon size={18} strokeWidth={1.8} />
                </span>
              }
              title={c.name}
              detail={namesText(c.items.map((p) => p.name))}
              end={plural(c.items.length, "item")}
            />
          ))}
        </RecordGroup>
      ) : (
        <RecordEmpty
          icon={<TagIcon size={22} strokeWidth={1.6} />}
          title={menu.length ? "No categories yet" : "Add menu items first"}
          text={menu.length ? "Like Drinks, Pastries or Bundles. Pick the items that go in each." : "Categories group the items on your menu."}
        />
      )}
      {(loose > 0 || !props.online) && (
        <p className="label">
          {loose ? plural(loose, "item") + " with no category show last. " : ""}
          {props.online ? "" : "Connect to edit categories."}
        </p>
      )}
      {editing && (
        <CategorySheet
          category={editing === "new" ? undefined : editing}
          menu={menu}
          onClose={() => setEditing(null)}
          onSave={(name, ids) => {
            const before = editing === "new" ? "" : editing.name;
            const next = menu.map((p) =>
              ids.includes(p.id)
                ? p.category === name
                  ? p
                  : { ...p, category: name }
                : before && p.category.trim() === before
                  ? { ...p, category: "" }
                  : p,
            );
            return commit.menu(next, (editing === "new" ? "Added " : "Saved ") + name);
          }}
          onRemove={
            editing === "new"
              ? undefined
              : () =>
                  commit.menu(
                    menu.map((p) => (p.category.trim() === editing.name ? { ...p, category: "" } : p)),
                    "Removed " + editing.name,
                  )
          }
        />
      )}
    </SubPage>
  );
}

/* ---------- choices ---------- */

interface Choice {
  key: string;
  name: string;
  required: boolean;
  options: { id: string; name: string; price: number }[];
  items: Product[];
}

export function choicesOf(menu: Product[]): Choice[] {
  const map = new Map<string, Choice>();
  for (const p of menu)
    for (const g of p.groups) {
      const key = choiceKey(g);
      const found = map.get(key);
      if (found) {
        if (!found.items.includes(p)) found.items.push(p);
      } else map.set(key, { key, name: g.name, required: g.required, options: g.options, items: [p] });
    }
  return [...map.values()];
}

function ChoiceSheet({
  choice,
  menu,
  currency,
  onSave,
  onRemove,
  onClose,
}: {
  choice?: Choice;
  menu: Product[];
  currency: string;
  onSave: (group: Omit<OptionGroup, "id">, ids: string[]) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(choice?.name ?? "");
  const [required, setRequired] = useState(choice?.required ?? true);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    choice ? choice.options.map((o) => ({ id: o.id, name: o.name, price: priceText(o.price, currency) })) : [blankOption()],
  );
  const [picked, setPicked] = useState(choice?.items.map((p) => p.id) ?? []);
  const reuse = useMemo(() => reusable(menu, undefined, currency), [menu, currency]);
  const { busy, error, run } = useRecordSave(onClose);
  return (
    <RecordSheet
      noun="choice"
      editing={Boolean(choice)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim() && picked.length)}
      onSave={() =>
        void run(() => onSave({ name: name.trim(), required, options: parseOptions(options, currency) }, picked))
      }
      onRemove={onRemove && (() => void run(onRemove))}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <div className="segmented" role="group" aria-label="Kind of choice">
          <button type="button" aria-pressed={required} onClick={() => setRequired(true)}>
            Pick one
          </button>
          <button type="button" aria-pressed={!required} onClick={() => setRequired(false)}>
            Add-ons
          </button>
        </div>
        <p className="label">
          {required
            ? "The cashier must pick one, like a size or a flavor."
            : "Optional extras. The cashier can pick any, or none."}
        </p>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={60}
            autoFocus={!choice}
            placeholder={required ? "e.g. Size" : "e.g. Extras"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <div className="card card-pad stack gap-12">
        <span className="strong">Options</span>
        <OptionRows
          options={options}
          required={required}
          currency={currency}
          suggestions={reuse.options}
          onChange={setOptions}
        />
      </div>
      <div className="card card-pad stack gap-12">
        <span className="strong title-help">
          Offered on
          <Explain title="Offered on">Saving updates the choice on every item picked here.</Explain>
        </span>
        <PickChips label="Items that offer this choice" items={menu} picked={picked} onChange={setPicked} />
      </div>
    </RecordSheet>
  );
}

export function ChoicesPage(props: RecipesProps) {
  const business = props.state.business!;
  const menu = props.state.menu;
  const commit = useCommit(props);
  const list = choicesOf(menu);
  const [editing, setEditing] = useState<Choice | "new" | null>(null);
  const kinds = [
    { title: "Pick one", items: list.filter((c) => c.required) },
    { title: "Add-ons", items: list.filter((c) => !c.required) },
  ].filter((k) => k.items.length);

  function apply(group: Omit<OptionGroup, "id">, ids: string[]) {
    const key = editing && editing !== "new" ? editing.key : null;
    return menu.map((p) => {
      const at = key ? p.groups.findIndex((g) => choiceKey(g) === key) : -1;
      const wanted = ids.includes(p.id);
      if (!wanted) return at < 0 ? p : { ...p, groups: p.groups.filter((_, i) => i !== at) };
      const old = at >= 0 ? p.groups[at] : undefined;
      const next: OptionGroup = {
        ...group,
        id: old?.id ?? crypto.randomUUID(),
        // Keep option ids that still exist, so carts and sold-out marks keep pointing at them.
        options: group.options.map((o) => ({
          ...o,
          id: old?.options.find((x) => x.name.toLocaleLowerCase() === o.name.toLocaleLowerCase())?.id ?? crypto.randomUUID(),
        })),
      };
      return { ...p, groups: at >= 0 ? p.groups.map((g, i) => (i === at ? next : g)) : [...p.groups, next] };
    });
  }

  return (
    <SubPage
      title="Choices"
      help={
        <>
          <p><strong>Pick one</strong> choices, like Size, make the cashier choose. <strong>Add-ons</strong>, like an extra shot, are optional.</p>
          <p>Set a choice up once and pick the items that offer it. Changes go live on Sell right away.</p>
        </>
      }
      backLabel="Back to recipes"
      sentence={
        list.length ? (
          <>
            {plural(list.length, "choice")} <span className="g">asked at checkout.</span>
          </>
        ) : (
          <>
            No choices. <span className="g">Add sizes, flavors or extras.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      <RecordAdd label="Add choice" disabled={!props.online || !menu.length} onClick={() => setEditing("new")} />
      {kinds.map((k) => (
        <RecordGroup key={k.title} title={k.title}>
          {k.items.map((c) => (
            <RecordRow
              key={c.key}
              disabled={!props.online}
              onClick={() => setEditing(c)}
              lead={
                <span className="well">
                  <ListPlus size={18} strokeWidth={1.8} />
                </span>
              }
              title={c.name}
              detail={c.options.map((o) => o.name + (o.price ? " +" + formatMoney(o.price, business.currency) : "")).join(", ")}
              end={plural(c.items.length, "item")}
            />
          ))}
        </RecordGroup>
      ))}
      {!list.length && (
        <RecordEmpty
          icon={<ListPlus size={22} strokeWidth={1.6} />}
          title={menu.length ? "No choices yet" : "Add menu items first"}
          text={
            menu.length
              ? "A Pick one choice like Size, or Add-ons like an extra shot. Pick the items that offer it."
              : "Choices are asked when an item is added to the order."
          }
        />
      )}
      {!props.online && <p className="label">Connect to edit choices.</p>}
      {editing && (
        <ChoiceSheet
          choice={editing === "new" ? undefined : editing}
          menu={menu}
          currency={business.currency}
          onClose={() => setEditing(null)}
          onSave={(group, ids) => commit.menu(apply(group, ids), (editing === "new" ? "Added " : "Saved ") + group.name)}
          onRemove={
            editing === "new"
              ? undefined
              : () =>
                  commit.menu(
                    menu.map((p) => ({ ...p, groups: p.groups.filter((g) => choiceKey(g) !== editing.key) })),
                    "Removed " + editing.name,
                  )
          }
        />
      )}
    </SubPage>
  );
}
