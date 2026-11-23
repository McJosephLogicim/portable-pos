"use client";

import { useMemo, useRef, useState } from "react";
import { Image as ImageIcon, ListPlus, Plus, ShoppingBag, Tag as TagIcon, Trash2, X } from "lucide-react";
import type { OptionGroup, PricingRules, Product, ProductCosting, StockItem } from "@/lib/types";
import { amountText, parseMoney, saveMenuItem, stockLeft } from "@/lib/domain";
import { menuCategoryNames } from "@/lib/menu-categories";
import { isSimpleMode } from "@/lib/settings";
import { batchStockUses, catalogSku, maxBatchServings, menuRecipeCost, pricingRules, readTargetMargin, unitFor } from "@/lib/stock";
import { SetupDetails, SubPage, useCommit } from "./settings";
import type { RecipesProps } from "./recipes";
import { MenuCostingOverview } from "./recipe-costing";
import { blankUseDraft, costGap, CostPreview, resolveUses, stockForUse, stockUseRows, UsesEditor, useDrafts, usesText } from "./stock-settings";
import { countOf, StockCount } from "./stock-count";
import { SuggestInput, type Suggestion } from "./combobox";
import { MultiSelect } from "./multi-select";
import { AddButton, AddMenu } from "./add-menu";
import { buzz, currencySymbol, EmptyState, Explain, formatMoney, Money, MoneyField, PhotoPicker, usePin } from "./ui";
import {
  matches,
  andText,
  namesText,
  plural,
  RecordGroup,
  RecordNoMatch,
  RecordRow,
  RecordSearch,
  RecordSelectBar,
  RecordSelectToggle,
  RecordSheet,
  useRecordSave,
  useRecordSelect,
} from "./records";
import { blocked, OFFLINE } from "@/lib/reject";

/* ---------- shared pieces ---------- */

type OptionDraft = { id: string; name: string; price: string };
type GroupDraft = Omit<OptionGroup, "options"> & { options: OptionDraft[] };

/** "30" rather than "30.00", so a short price field shows the whole number. */
const priceText = (minor: number, currency: string) => (minor ? amountText(minor, currency).replace(/\.0+$/, "") : "");

const blankOption = (): OptionDraft => ({ id: crypto.randomUUID(), name: "", price: "" });

/** A choice's identity across the menu: the same name, kind and options. */
function choiceKey(g: Omit<OptionGroup, "id">) {
  return (
    (g.required ? "1" : "0") +
    g.name.trim().toLocaleLowerCase() +
    "|" +
    g.options.map((o) => o.name.trim().toLocaleLowerCase() + ":" + o.price).join(",")
  );
}

/** Categories, choices and options already on the menu, so they're picked instead of retyped. */
function reusable(menu: Product[], skip: string | undefined, currency: string) {
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
  return { groups: [...groups.values()], options: [...options.values()] };
}

function parseOptions(options: OptionDraft[], currency: string) {
  if (options.length > 64) throw Error("A choice can have up to 64 options.");
  if (!options.length || options.some((o) => !o.name.trim())) throw Error("Name every option, or remove the empty ones.");
  return options.map((o) => ({ id: o.id, name: o.name.trim(), price: parseMoney(o.price || "0", currency) }));
}

function draftChoices(groups: OptionGroup[], currency: string): GroupDraft[] {
  return groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({ ...option, price: priceText(option.price, currency) })),
  }));
}

function parseChoices(groups: GroupDraft[], currency: string): OptionGroup[] {
  if (groups.length > 32) throw Error("An item can have up to 32 choices.");
  return groups.map((group) => {
    const name = group.name.trim();
    if (!name) throw Error("Name each choice, like Size or Extras.");
    return { ...group, name, options: parseOptions(group.options, currency) };
  });
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
            {...blocked(options.length === 1 && "Keep at least one option in this choice.")}
            onClick={() => onChange(options.filter((r) => r.id !== o.id))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn secondary compact" aria-label="Add option" {...blocked(options.length >= 64 && "A choice can have up to 64 options.")} onClick={() => onChange([...options, blankOption()])}>
        <Plus size={16} /> Add
      </button>
    </div>
  );
}

function ItemChoices({ groups, reuse, currency, onChange }: {
  groups: GroupDraft[];
  reuse: ReturnType<typeof reusable>;
  currency: string;
  onChange: (groups: GroupDraft[]) => void;
}) {
  function update(id: string, patch: Partial<GroupDraft>) {
    onChange(groups.map((group) => group.id === id ? { ...group, ...patch } : group));
  }
  function add(required: boolean) {
    onChange([...groups, { id: crypto.randomUUID(), name: "", required, options: [blankOption()] }]);
  }
  return (
    <>
      {groups.map((group) => (
        <div className="card card-pad stack gap-12" key={group.id}>
          <div className="between">
            <span className="strong">{group.required ? "Pick one" : "Add-ons"}</span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onChange(groups.filter((choice) => choice.id !== group.id))}
            >
              Remove
            </button>
          </div>
          <SuggestInput
            label="Choice name"
            placeholder={group.required ? "e.g. Size" : "e.g. Extras"}
            value={group.name}
            newText="New choice"
            suggestions={reuse.groups
              .filter((choice) => choice.required === group.required && !groups.some((other) => other.name.trim() === choice.name && other.id !== group.id))
              .map(({ key, name, detail }) => ({ key, name, detail }))}
            onChange={(name) => update(group.id, { name })}
            onPick={(pick) => {
              const choice = reuse.groups.find((choice) => choice.key === pick.key)!;
              buzz.tick();
              update(group.id, {
                name: choice.name,
                options: choice.options.map((option) => ({ ...option, id: crypto.randomUUID() })),
              });
            }}
          />
          <OptionRows
            options={group.options}
            required={group.required}
            currency={currency}
            suggestions={reuse.options}
            onChange={(options) => update(group.id, { options })}
          />
        </div>
      ))}
      <div className="grid-2">
        <button type="button" className="btn secondary compact" {...blocked(groups.length >= 32 && "An item can have up to 32 choices.")} onClick={() => add(true)}>
          <Plus size={16} /> Pick one
        </button>
        <button type="button" className="btn secondary compact" {...blocked(groups.length >= 32 && "An item can have up to 32 choices.")} onClick={() => add(false)}>
          <Plus size={16} /> Add-ons
        </button>
      </div>
    </>
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

function MenuCategoryField({ value, onChange, menu, saved, skip, label = "Category", inputLabel = label, placeholder, onAdd }: {
  value: string;
  onChange: (category: string) => void;
  menu: Product[];
  saved?: string[];
  skip?: string;
  label?: string;
  inputLabel?: string;
  placeholder: string;
  onAdd?: (category: string, itemIds: string[]) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const names = menuCategoryNames(menu, saved);
  return (
    <div className="field">
      <div className="between">
        <span className="field-label">{label}</span>
        {onAdd && (
          <button type="button" className="link small-link" aria-haspopup="dialog" onClick={() => setAdding(true)}>
            New category
          </button>
        )}
      </div>
      <SuggestInput
        label={inputLabel}
        maxLength={60}
        placeholder={placeholder}
        value={value}
        newText="New category"
        suggestions={names.map((name) => ({
          key: name,
          name,
          detail: plural(menu.filter((item) => item.category.trim() === name && item.id !== skip).length, "item"),
        }))}
        onChange={onChange}
      />
      {adding && onAdd && (
        <CategorySheet
          defaultName={names.includes(value.trim()) ? "" : value}
          menu={menu}
          onClose={() => setAdding(false)}
          onSave={async (name, itemIds) => {
            const saved = await onAdd(name, itemIds);
            if (saved) onChange(name);
            return saved;
          }}
        />
      )}
    </div>
  );
}

/* ---------- menu item ---------- */

type StockMode = "off" | "count" | "uses";

export function ItemSheet({
  product,
  category: startCategory = "",
  currency,
  menu,
  menuCategories,
  onAddCategory,
  simple = false,
  liveShift = false,
  counted = [],
  stockItems = [],
  costItems,
  pricing: savedPricing,
  canCreateStock = false,
  onSave,
  onRemove,
  onClose,
}: {
  product?: Product;
  /** A new item's category, when it is added from a category tab. */
  category?: string;
  simple?: boolean;
  /** What the item can use up with each sale. */
  stockItems?: StockItem[];
  /** Current cost sources when the till limits selection to its opening stock. */
  costItems?: StockItem[];
  pricing?: PricingRules;
  /** New stock item names typed here can be added to Settings when the item saves. */
  canCreateStock?: boolean;
  currency: string;
  /** The rest of the menu, whose categories, choices and options can be reused. */
  menu: Product[];
  menuCategories?: string[];
  onAddCategory?: (name: string, itemIds: string[]) => Promise<boolean>;
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
  const generatedSku = catalogSku("product", itemId);
  const [sku, setSku] = useState(product?.costing?.sku ?? generatedSku);
  const [notes, setNotes] = useState(product?.costing?.notes ?? "");
  const [marginOverride, setMarginOverride] = useState(String(product?.costing?.targetMargin ?? ""));
  const pricing = pricingRules(currency, savedPricing);
  const [name, setName] = useState(product?.name ?? "");
  const [mode, setMode] = useState<StockMode>(product?.uses?.length ? "uses" : product?.stock ? "count" : "off");
  const [uses, setUses] = useState(() => {
    const drafts = product?.costing?.batch?.deductFromStock ? [] : useDrafts(product?.uses, stockItems);
    return drafts.length ? drafts : [blankUseDraft()];
  });
  const batchItems = costItems ?? stockItems;
  const [batchOn, setBatchOn] = useState(Boolean(product?.costing?.batch));
  // Batches only apply to items that use stock.
  const batchEnabled = !simple && mode === "uses" && batchOn;
  const [deductBatch, setDeductBatch] = useState(() => product?.costing?.batch?.deductFromStock ?? !product?.costing?.batch);
  const deductFromStock = batchEnabled && deductBatch;
  const [batchServings, setBatchServings] = useState(String(product?.costing?.batch?.servings ?? ""));
  const servings = Number(batchServings);
  const validServings = Number.isInteger(servings) && servings >= 1 && servings <= maxBatchServings;
  const [batchUses, setBatchUses] = useState(() => {
    const drafts = useDrafts(product?.costing?.batch?.uses, batchItems);
    return drafts.length ? drafts : [blankUseDraft()];
  });
  const [labor, setLabor] = useState(priceText(product?.costing?.laborPerServing ?? 0, currency));
  const [other, setOther] = useState(priceText(product?.costing?.otherPerServing ?? 0, currency));
  const [count, setCount] = useState("");
  const askCount = mode === "count" && liveShift && !counted.includes(itemId);
  // A new item that uses a stock item the shift didn't count at opening needs that count
  // now, or its sales would never draw it down.
  const [useCounts, setUseCounts] = useState<Record<string, string>>({});
  const stockDrafts = deductFromStock ? batchUses : uses;
  const availableStock = deductFromStock ? batchItems : stockItems;
  const uncountedUses = liveShift && !simple && mode === "uses"
    ? stockDrafts.filter((u, i) => {
        if (!u.name.trim()) return false;
        const item = stockForUse(u, availableStock);
        if (item ? counted.includes(item.id) || item.onHand !== undefined : deductFromStock || !canCreateStock) return false;
        // The same stock item typed twice is asked once.
        return stockDrafts.findIndex((o) => o.name.trim().toLocaleLowerCase() === u.name.trim().toLocaleLowerCase()) === i;
      })
    : [];
  const [price, setPrice] = useState(product ? priceText(product.price, currency) || "0" : "");
  let sellingPrice: number | undefined;
  if (price) {
    try {
      sellingPrice = parseMoney(price, currency);
    } catch {
      // Wait for a complete selling price before previewing margins.
    }
  }
  const [category, setCategory] = useState(product?.category ?? startCategory);
  const [image, setImage] = useState(product?.image);
  const reuse = useMemo(() => reusable(menu, product?.id, currency), [menu, product?.id, currency]);
  const [groups, setGroups] = useState(() => draftChoices(product?.groups ?? [], currency));
  const { busy, error, run } = useRecordSave(onClose);
  const costRows = simple ? [] : batchEnabled
    ? stockUseRows(batchUses, batchItems)
    : mode === "uses" ? stockUseRows(uses, stockItems, costItems) : [];
  const batchDeductions = deductFromStock && validServings ? batchStockUses({
    servings,
    deductFromStock: true,
    uses: costRows.flatMap(({ item, amount }) => item && amount !== undefined ? [{ stockId: item.id, amount }] : []),
  }) : [];
  const recipeCosts = costRows.filter(({ draft }) => draft.name.trim()).map(({ cost }) => cost);
  const showCostPreview = !simple && (batchEnabled || recipeCosts.length > 0 || Boolean(labor || other));
  const optionalMoney = (value: string) => value === "" ? undefined : parseMoney(value, currency);
  const readMarginOverride = () => marginOverride.trim() ? readTargetMargin(marginOverride) : undefined;
  let previewTarget: number | undefined;
  try {
    previewTarget = readMarginOverride() ?? pricing.targetMargin;
  } catch {
    // Keep the cost visible while the margin override is being edited.
  }
  let totalCost: ReturnType<typeof menuRecipeCost>;
  if (showCostPreview) {
    try {
      totalCost = menuRecipeCost(
        recipeCosts, batchEnabled ? servings : 1,
        optionalMoney(labor) ?? 0, optionalMoney(other) ?? 0, sellingPrice,
      );
    } catch {
      // Recalculate when a serving cost is valid.
    }
  }

  const costMissing = costGap(costRows, batchEnabled ? "batch" : "sale")
    ?? (batchEnabled && !validServings
      ? "Enter how many servings one batch makes."
      : !costRows.some(({ draft }) => draft.name.trim())
        ? batchEnabled ? "Add what goes into the batch." : "Pick the stock items one sale uses."
        : undefined);

  function readCosting(): ProductCosting | undefined {
    const laborPerServing = optionalMoney(labor);
    const otherPerServing = optionalMoney(other);
    const targetMargin = readMarginOverride();
    const savedSku = sku.trim() && sku.trim() !== generatedSku ? sku.trim() : undefined;
    const savedNotes = notes.trim() || undefined;
    let batch: ProductCosting["batch"];
    if (batchEnabled) {
      if (!validServings)
        throw Error("Enter a whole number of servings per batch, from 1 to 100,000.");
      const { uses } = resolveUses(batchUses, batchItems, false);
      if (!uses.length) throw Error("Add at least one ingredient to the batch recipe.");
      batch = { servings, uses, ...(deductFromStock ? { deductFromStock } : {}) };
    }
    if (!batch && laborPerServing === undefined && otherPerServing === undefined && targetMargin === undefined && !savedSku && !savedNotes) return undefined;
    return {
      ...(batch ? { batch } : {}),
      ...(laborPerServing !== undefined ? { laborPerServing } : {}),
      ...(otherPerServing !== undefined ? { otherPerServing } : {}),
      ...(targetMargin !== undefined ? { targetMargin } : {}),
      ...(savedSku ? { sku: savedSku } : {}),
      ...(savedNotes ? { notes: savedNotes } : {}),
    };
  }

  function save() {
    void run(async () => {
      const saved = parseChoices(groups, currency);
      const costing = simple ? product?.costing : readCosting();
      const editUses = !simple && mode === "uses";
      const { uses: picked, created } = deductFromStock
        ? { uses: batchStockUses(costing?.batch), created: [] }
        : editUses ? resolveUses(uses, stockItems) : { uses: simple ? product?.uses ?? [] : [], created: [] };
      if (editUses && !picked.length) throw Error("Type the stock items it uses, or set Stock to Off.");
      if (created.length && !canCreateStock)
        throw Error("Add " + created.map((c) => c.name).join(", ") + " in Recipes › Stock items first, or pick one from the list.");
      const { stock: _, image: _image, uses: _uses, costing: _costing, ...rest } = product ?? ({} as Partial<Product>);
      let counts: Record<string, number> | undefined;
      if (askCount) counts = { [itemId]: Number(count) };
      else if (uncountedUses.length) {
        counts = {};
        for (const u of uncountedUses) {
          const item = stockForUse(u, availableStock) ?? created.find((c) => c.name.toLocaleLowerCase() === u.name.trim().toLocaleLowerCase());
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
      saveBlocked={!name.trim() ? "Enter an item name." : !price.trim() ? "Enter a price." : askCount && !count.trim() && "Enter the available stock count."}
      onSave={save}
      removeLabel="Remove from menu"
      removeDetail={product && (liveShift
        ? `${product.name} will come off Sell now. You can undo the removal from the toast.`
        : `${product.name} will be removed from the menu. You can undo the removal from the toast.`)}
      onRemove={onRemove}
      onClose={onClose}
    >
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
        <MenuCategoryField
          value={category}
          onChange={setCategory}
          menu={menu}
          saved={menuCategories}
          skip={product?.id}
          placeholder="e.g. Drinks"
          onAdd={onAddCategory}
        />
        <PhotoPicker value={image} onChange={setImage} label="item photo" />
      </div>

      {(!simple || !product?.uses?.length) && <div className="card card-pad stack gap-14">
        <span className="strong title-help">
          Stock
          <Explain title="Stock">
            <p><strong>Off</strong> is for things you don't keep count of, like drinks made to order. They never sell out.</p>
            <p><strong>Count it</strong> is for a set supply, like bread or pastries. You count it when the shift opens, and it sells out at zero.</p>
            <p><strong>Uses stock</strong> takes from your stock items with every sale, like 1 cup and 0.2 kg of ice for an iced latte. It only takes from what the shift is keeping track of, and it never stops a sale.</p>
          </Explain>
        </span>
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
        {mode !== "uses" && (
          <p className="label">
            {mode === "off" ? "Not counted. It never sells out." : "Counted when the shift opens. It sells out at zero."}
          </p>
        )}
        {!simple && mode === "uses" && (
          <div className="field">
            <span className="field-head">
              How it's made
              <Explain title="How it's made">
                <p><strong>One at a time</strong>: you make each one when it's ordered, like a latte. List what one sale uses.</p>
                <p><strong>In batches</strong>: you make a lot at once, like a pitcher of lemonade that fills 10 cups. List what goes into the whole batch and how many servings it makes. Each sale then takes its share, so one cup takes a tenth of every ingredient.</p>
                <p>Make something ahead that you count on its own, like syrup? Add it under Prep, then pick it here as a stock item.</p>
              </Explain>
            </span>
            <div className="segmented" role="group" aria-label="How it's made">
              <button type="button" aria-pressed={!batchOn} onClick={() => { buzz.tap(); setBatchOn(false); }}>One at a time</button>
              <button type="button" aria-pressed={batchOn} onClick={() => { buzz.tap(); setBatchOn(true); }}>In batches</button>
            </div>
          </div>
        )}
        {mode === "uses" && !batchEnabled && (
          <div className="field">
            <span>Each sale uses</span>
            <UsesEditor stockItems={stockItems} costItems={costItems} uses={uses} currency={currency} onChange={setUses} />
          </div>
        )}
        {batchEnabled && (
          <>
            <label className="field">
              <span>One batch makes (servings)</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="e.g. 10"
                value={batchServings}
                maxLength={9}
                onChange={(e) => setBatchServings(e.target.value)}
              />
            </label>
            <div className="field">
              <span>What goes into one batch</span>
              <UsesEditor stockItems={batchItems} uses={batchUses} currency={currency} batch onChange={setBatchUses} />
            </div>
            {deductFromStock ? (
              <div className="stack gap-8 batch-share">
                <span className="field-label">Each sale uses</span>
                {batchDeductions.length > 0 ? (
                  <dl className="stack gap-8 label">
                    {batchDeductions.map(({ stockId, amount }, i) => {
                      const item = batchItems.find((item) => item.id === stockId)!;
                      return (
                        <div className="between gap-8" key={`${stockId}-${i}`}>
                          <dt>{item.name}</dt>
                          <dd className="strong">{amount.toLocaleString("en", { maximumSignificantDigits: 5 })} {unitFor(amount, item.unit)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : (
                  <p className="label">
                    {validServings ? "Its share of the batch shows here once you add what goes in." : "Enter how many servings one batch makes."}
                  </p>
                )}
              </div>
            ) : (
              <div className="field batch-share">
                <span>Each sale uses</span>
                <UsesEditor stockItems={stockItems} costItems={costItems} uses={uses} currency={currency} showCosts={false} onChange={setUses} />
                <button type="button" className="btn ghost small" onClick={() => { buzz.tap(); setDeductBatch(true); }}>
                  Use its share of the batch instead
                </button>
              </div>
            )}
          </>
        )}
        {uncountedUses.length > 0 && (
          <div className="stack gap-8">
            <span className="field-label row gap-6">
              How much do you have now?
              <Explain title="How much do you have now?">
                Optional. Enter it and sales take from it from now on. Leave it blank and it isn't tracked this shift.
              </Explain>
            </span>
            <div>
              {uncountedUses.map((u) => (
                <StockCount
                  key={u.key}
                  item={stockForUse(u, availableStock) ?? { id: u.key, name: u.name.trim(), unit: u.unit.trim() || "piece" }}
                  value={useCounts[u.key] ?? ""}
                  onChange={(v) => setUseCounts((all) => ({ ...all, [u.key]: v }))}
                />
              ))}
            </div>
          </div>
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
      </div>}

      {!simple && (
        <div className="card card-pad stack gap-14">
          <span className="strong title-help">
            Cost
            <Explain title="Cost">
              <p>Worked out from the stock it uses and what you pay for each stock item, plus labor and other costs per serving.</p>
            </Explain>
          </span>
          {showCostPreview ? (
            <CostPreview currency={currency} total={totalCost} batch={batchEnabled} missing={costMissing} pricing={pricing} target={previewTarget} />
          ) : (
            <p className="label">Set Stock to Uses stock, or add labor or other costs, to see what one costs you.</p>
          )}
          <SetupDetails title="Cost adjustments" description="Labor, packaging and target margin">
            <div className="stack gap-14">
              <div className="grid-2">
                <MoneyField label="Labor per serving" value={labor} onChange={setLabor} currency={currency} />
                <MoneyField
                  label="Other cost per serving"
                  value={other}
                  onChange={setOther}
                  currency={currency}
                  help={{
                    title: "Other cost per serving",
                    body: <p>Enter extra costs for one serving, such as cups, lids or takeaway bags. Leave out anything already included in the recipe used for costing.</p>,
                  }}
                />
              </div>
              <label className="field">
                <span>Target margin override (%)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  maxLength={12}
                  placeholder={`Business default (${pricing.targetMargin}%)`}
                  value={marginOverride}
                  onChange={(e) => setMarginOverride(e.target.value)}
                />
              </label>
            </div>
          </SetupDetails>
        </div>
      )}

      {!simple && <SetupDetails title="Recipe details" description="SKU and notes" className="card card-pad">
        <div className="stack gap-14">
          <label className="field">
            <span>SKU</span>
            <input className="input" maxLength={64} value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea className="input" aria-label="Notes" rows={2} maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </SetupDetails>}

      <ItemChoices groups={groups} reuse={reuse} currency={currency} onChange={setGroups} />
    </RecordSheet>
  );
}

export function MenuPage({ costingView = false, onPreview, ...props }: RecipesProps & {
  costingView?: boolean;
  onPreview?: () => void;
}) {
  const business = props.state.business!;
  const simple = isSimpleMode(business.settings);
  const menu = props.state.menu;
  const commit = useCommit(props);
  const withPin = usePin();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<Product[] | null>(null);
  const [newCategory, setNewCategory] = useState(false);
  const select = useRecordSelect(menu.map((p) => p.id));
  const [picked, setTab] = useState<string | null>(null);
  const categories = menuCategoryNames(menu, business.settings.menuCategories);
  const [query, setQuery] = useState("");
  const tab = picked && categories.includes(picked) ? picked : null;
  const detailOf = (p: Product) =>
    [
      !simple && p.uses?.length ? "Uses " + usesText(p, business.settings.stockItems) : p.stock ? "Counted each shift" : "",
      ...p.groups.map((x) => x.name),
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
  const shown = menu.filter((p) => matches(query, p.name, p.category, detailOf(p)));
  const addCategory = (name: string, itemIds?: string[]) =>
    commit.run((pin) => props.onMenuCategory({ action: "saveMenuCategory", name, itemIds }, pin), "Added " + name);
  const grouped = [...categories, ""]
    .filter((c) => tab === null || c === tab)
    .map((c) => ({ name: c, items: shown.filter((m) => m.category.trim() === c) }));
  const live = Boolean(props.state.shift && !props.state.shift.closedAt);
  const shownIds = grouped.flatMap((g) => g.items.map((p) => p.id));
  const selecting = select.on && !costingView;
  const addItems = (
    <AddMenu
      singleLabel="Add an item"
      blockedReason={!props.online ? OFFLINE : menu.length >= 1000 && "The menu can hold up to 1,000 items."}
      onSingle={() => setEditing("new")}
      onBulk={() => setAdding(true)}
    />
  );
  return (
    <SubPage
      title={costingView ? "Menu costing" : "Menu items"}
      action={costingView || menu.length < 2 ? undefined : <RecordSelectToggle select={select} disabled={!props.online} />}
      help={costingView ? undefined : (
        <>
          <p>Changes go live on Sell right away. Completed sales keep their original prices and ingredient quantities.</p>
          <p>To change or remove several at once, tap Select, or hold an item.</p>
        </>
      )}
      backLabel={props.backLabel}
      sentence={!costingView && menu.length > 0 && (
        <>
          {plural(menu.length, "item")} <span className="g">for sale.</span>
        </>
      )}
      sentenceAction={!costingView && !selecting && menu.length > 0 && addItems}
      onBack={props.onBack}
    >
      {costingView ? (
        <MenuCostingOverview
          business={business}
          menu={menu}
          online={props.online}
          onEdit={setEditing}
          onPricing={() => props.onPage("pricing")}
          onMenu={() => props.onPage("menu")}
        />
      ) : (
        <>
          {onPreview && !selecting && (
            <button type="button" className="btn secondary" onClick={onPreview}>
              <ShoppingBag size={17} aria-hidden="true" /> See menu in action
            </button>
          )}
          <RecordSearch
            count={menu.length}
            noun="items"
            query={query}
            onQuery={setQuery}
            filters={{
              label: "Categories",
              options: categories,
              value: tab,
              onChange: setTab,
              onNew: () => setNewCategory(true),
              newDisabled: !props.online,
            }}
          />
          {!menu.length && (
            <EmptyState
              pose="menu"
              object="itemsSold"
              title={tab ? `No items in ${tab} yet` : "No items yet"}
              text="Add what you sell, with a photo and a price. Sizes and add-ons come after."
            >
              {addItems}
            </EmptyState>
          )}
          {menu.length > 0 && !grouped.some((g) => g.items.length) && (
            tab && !query.trim() ? (
              <EmptyState pose="menu" object="itemsSold" title={`No items in ${tab} yet`} />
            ) : (
              <RecordNoMatch
                query={query}
                onClear={() => {
                  setQuery("");
                  setTab(null);
                }}
              />
            )
          )}
          {grouped
            .filter((g) => g.items.length)
            .map((g) => (
              <RecordGroup key={g.name || "none"} title={tab ? undefined : g.name || (categories.length ? "No category" : undefined)}>
                {g.items.map((p) => (
                  <RecordRow
                    key={p.id}
                    disabled={!props.online}
                    onClick={() => setEditing(p)}
                    select={select.row(p.id)}
                    lead={<Thumb src={p.image} />}
                    title={p.name}
                    detail={detailOf(p)}
                    end={<Money value={p.price} currency={business.currency} />}
                  />
                ))}
              </RecordGroup>
            ))}
          {selecting && (
            <RecordSelectBar
              select={select}
              shown={shownIds}
              noun="item"
              onEdit={() => setBulkEdit(menu.filter((p) => select.picked.includes(p.id)))}
              removeDetail={(ids) => {
                const names = andText(menu.filter((p) => ids.includes(p.id)).map((p) => p.name), 3);
                return live
                  ? `${names} will come off the menu and Sell now.`
                  : `${names} will come off the menu.`;
              }}
              onRemove={(ids) => commit.menu(menu.filter((p) => !ids.includes(p.id)), "Removed " + plural(ids.length, "item"))}
            />
          )}
          {(!props.online || !live) && (
            <p className="label">
              {!props.online
                ? "Connect to edit the menu."
                : props.state.shift
                  ? "Changes reach the register when the next shift opens."
                  : "Changes reach the register when you open the next shift."}
            </p>
          )}
        </>
      )}
      {editing && (
        <ItemSheet
          key={simple ? "simple" : "advanced"}
          simple={simple}
          product={editing === "new" ? undefined : editing}
          category={tab ?? undefined}
          currency={business.currency}
          menu={menu}
          menuCategories={categories}
          onAddCategory={addCategory}
          liveShift={live}
          counted={props.state.shift ? Object.keys(stockLeft(props.state.shift, [])) : []}
          stockItems={business.settings.stockItems}
          pricing={business.settings.pricing}
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
            editing === "new" ? undefined : () => withPin((pin) => props.onRemoveMenuItem(editing.id, pin))
          }
        />
      )}
      {adding && (
        <QuickAddSheet
          category={tab ?? undefined}
          menu={menu}
          menuCategories={categories}
          onAddCategory={addCategory}
          currency={business.currency}
          onClose={() => setAdding(false)}
          onSave={(items) => commit.menu(items.reduce(saveMenuItem, menu), "Added " + plural(items.length, "item"))}
        />
      )}
      {bulkEdit && (
        <BulkEditSheet
          items={bulkEdit}
          menu={menu}
          menuCategories={categories}
          onAddCategory={addCategory}
          currency={business.currency}
          onClose={() => setBulkEdit(null)}
          onSave={async (items) => {
            const byId = new Map(items.map((p) => [p.id, p]));
            const saved = await commit.menu(menu.map((p) => byId.get(p.id) ?? p), "Saved " + plural(items.length, "item"));
            if (saved) select.done();
            return saved;
          }}
        />
      )}
      {newCategory && (
        <CategorySheet
          menu={menu}
          onClose={() => setNewCategory(false)}
          onSave={async (name, ids) => {
            const saved = await addCategory(name, ids);
            if (saved) setTab(name);
            return saved;
          }}
        />
      )}
    </SubPage>
  );
}

/* ---------- several items at once ---------- */

type QuickRow = { id: string; name: string; price: string };
const blankQuick = (): QuickRow => ({ id: crypto.randomUUID(), name: "", price: "" });
const startedQuickRow = (row: QuickRow) => Boolean(row.name.trim() || row.price.trim());

/** Type a list of names and prices, one item per line. A new line appears as the last one is filled. */
function QuickAddSheet({
  category: startCategory = "",
  menu,
  menuCategories,
  onAddCategory,
  currency,
  onSave,
  onClose,
}: {
  category?: string;
  menu: Product[];
  menuCategories: string[];
  onAddCategory: (name: string, itemIds: string[]) => Promise<boolean>;
  currency: string;
  onSave: (items: Product[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<QuickRow[]>(() => [blankQuick()]);
  const [category, setCategory] = useState(startCategory);
  const [groups, setGroups] = useState<GroupDraft[]>([]);
  const { busy, error, run } = useRecordSave(onClose);
  const list = useRef<HTMLDivElement>(null);
  const reuse = useMemo(() => reusable(menu, undefined, currency), [menu, currency]);
  const filled = rows.filter(startedQuickRow);
  const savedIds = new Set(menu.map((item) => item.id));
  const remaining = Math.max(0, 1000 - menu.length);
  const exceedsLimit = filled.filter((row) => !savedIds.has(row.id)).length > remaining;
  const ready = filled.length > 0 && filled.every((r) => r.name.trim() && r.price.trim());
  function setRow(id: string, patch: Partial<QuickRow>) {
    setRows((all) => {
      const next = all.map((r) => (r.id === id ? { ...r, ...patch } : r));
      return startedQuickRow(next.at(-1)!) ? [...next, blankQuick()] : next;
    });
  }
  function focus(index: number, field: "name" | "price") {
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLInputElement>(`[data-row="${index}"][data-field="${field}"]`)?.focus(),
    );
  }
  function save() {
    if (!ready || exceedsLimit) return;
    void run(() => {
      const choices = parseChoices(groups, currency);
      return onSave(
        filled.map((r) => {
          const name = r.name.trim();
          let price: number;
          try {
            price = parseMoney(r.price, currency);
          } catch {
            throw Error(`Check the price of ${name}.`);
          }
          // Prefix the draft IDs with the item ID so choices are unique per item and stable on retry.
          const itemChoices = choices.map((group) => ({
            ...group,
            id: `${r.id}:${group.id}`,
            options: group.options.map((option) => ({ ...option, id: `${r.id}:${option.id}` })),
          }));
          return { id: r.id, name, category: category.trim(), price, groups: itemChoices };
        }),
      );
    });
  }
  return (
    <RecordSheet
      noun="items"
      title="Add menu items in bulk"
      help={
        <>
          <p>Each line becomes a menu item. A new line appears as you fill the last one.</p>
          <p>Category and choices apply to every item in the batch. Add photos and stock after saving.</p>
          <p>New items go live on Sell right away.</p>
        </>
      }
      editing={false}
      busy={busy}
      error={exceedsLimit ? `The menu can hold up to 1,000 items. You can add ${plural(remaining, "more item")}.` : error}
      saveBlocked={exceedsLimit ? "The menu can hold up to 1,000 items." : !ready && "Enter a name and price for each item."}
      saveText={filled.length ? "Add " + plural(filled.length, "item") : "Add"}
      saveLabel={filled.length ? "Add " + plural(filled.length, "item") : "Add items"}
      onSave={save}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <MenuCategoryField
          inputLabel="Category for these items"
          value={category}
          onChange={setCategory}
          menu={menu}
          saved={menuCategories}
          placeholder="None"
          onAdd={onAddCategory}
        />
      </div>
      <div className="card card-pad stack gap-10" ref={list}>
        <div className="quick-row label">
          <span>Name</span>
          <span>Price</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const last = i === rows.length - 1;
          return (
            <div className="quick-row" key={r.id}>
              <input
                className="input"
                aria-label={`Item ${i + 1} name`}
                placeholder={i === 0 ? "e.g. Iced latte" : last ? "Next item" : ""}
                maxLength={80}
                enterKeyHint="next"
                autoComplete="off"
                data-row={i}
                data-field="name"
                value={r.name}
                onChange={(e) => setRow(r.id, { name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  focus(i, "price");
                }}
              />
              <span className="money-input quick-price">
                <input
                  className="input"
                  aria-label={`Item ${i + 1} price`}
                  inputMode="decimal"
                  placeholder="0"
                  enterKeyHint={last ? "done" : "next"}
                  autoComplete="off"
                  data-row={i}
                  data-field="price"
                  value={r.price}
                  onChange={(e) => setRow(r.id, { price: e.target.value.replace(/[^\d.]/g, "") })}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (r.name.trim()) focus(i + 1, "name");
                  }}
                />
                <span className="prefix">{currencySymbol(currency)}</span>
              </span>
              {last ? (
                <span aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="round flat quick-remove"
                  aria-label={`Remove item ${i + 1}`}
                  onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <section className="stack gap-12" aria-label="Choices for all items">
        <h3 className="group-title">Choices for all items</h3>
        <ItemChoices groups={groups} reuse={reuse} currency={currency} onChange={setGroups} />
      </section>
    </RecordSheet>
  );
}

type PriceChange = "set" | "up" | "down";

/** One change to several items: move them to a category, or set, raise or lower their prices. */
function BulkEditSheet({
  items,
  menu,
  menuCategories,
  onAddCategory,
  currency,
  onSave,
  onClose,
}: {
  items: Product[];
  menu: Product[];
  menuCategories: string[];
  onAddCategory: (name: string, itemIds: string[]) => Promise<boolean>;
  currency: string;
  onSave: (items: Product[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [change, setChange] = useState<PriceChange>("set");
  const [amount, setAmount] = useState("");
  const { busy, error, run } = useRecordSave(onClose);
  let value: number | undefined;
  try {
    if (amount) value = parseMoney(amount, currency);
  } catch {
    // Wait for a complete amount before previewing.
  }
  const priceOf = (p: Product) =>
    value === undefined ? p.price : change === "set" ? value : change === "up" ? p.price + value : p.price - value;
  const next = items.map((p) => ({ ...p, ...(category.trim() ? { category: category.trim() } : {}), price: priceOf(p) }));
  const changed = next.filter((p, i) => p.price !== items[i].price || p.category !== items[i].category);
  const negative = next.filter((p) => p.price < 0);
  const what = plural(items.length, "item");
  const before = new Map(items.map((p) => [p.id, p]));
  return (
    <RecordSheet
      noun="items"
      title={"Edit " + what}
      help={
        <>
          <p>Fill in only what should change. Anything left blank keeps each item's own value.</p>
          <p>Changes go live on Sell right away. Photos, choices and stock are set on each item.</p>
        </>
      }
      editing
      busy={busy}
      error={error || (negative.length ? `That takes ${namesText(negative.map((p) => p.name))} below zero.` : "")}
      saveBlocked={amount && value === undefined ? "Enter a valid amount." : negative.length ? "Prices must be zero or higher." : !changed.length && "Change a price or category first."}
      saveLabel={"Save " + what}
      onSave={() => void run(() => onSave(next))}
      onClose={onClose}
    >
      <div className="card card-pad stack gap-14">
        <MenuCategoryField
          label="Move to category"
          value={category}
          onChange={setCategory}
          menu={menu}
          saved={menuCategories}
          placeholder="Keep as is"
          onAdd={onAddCategory}
        />
      </div>
      <div className="card card-pad stack gap-12">
        <span className="strong">Price</span>
        <div className="segmented" role="group" aria-label="How to change the price">
          {(
            [
              ["set", "Set to"],
              ["up", "Raise by"],
              ["down", "Lower by"],
            ] as const
          ).map(([id, text]) => (
            <button key={id} type="button" aria-pressed={change === id} onClick={() => setChange(id)}>
              {text}
            </button>
          ))}
        </div>
        <MoneyField
          label={change === "set" ? "New price" : change === "up" ? "Raise each by" : "Lower each by"}
          placeholder={change === "set" ? "Keep as is" : "0"}
          value={amount}
          onChange={setAmount}
          currency={currency}
        />
      </div>
      {changed.length > 0 && (
        <RecordGroup title={"What changes · " + plural(changed.length, "item")}>
          {changed.slice(0, 5).map((p) => {
            const old = before.get(p.id)!;
            return (
              <div className="list-row" key={p.id}>
                <span className="grow stack">
                  <span className="ellipsis">{p.name}</span>
                  {old.category !== p.category && (
                    <span className="label ellipsis">{(old.category || "No category") + " → " + p.category}</span>
                  )}
                </span>
                <span className="record-end">
                  {old.price === p.price ? (
                    formatMoney(p.price, currency)
                  ) : (
                    <>
                      <span className="g">{formatMoney(old.price, currency)} → </span>
                      <span className="num">{formatMoney(Math.max(0, p.price), currency)}</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
          {changed.length > 5 && <p className="label list-more">and {plural(changed.length - 5, "more item")}</p>}
        </RecordGroup>
      )}
    </RecordSheet>
  );
}

/* ---------- categories ---------- */

function categoriesOf(menu: Product[], saved: string[] | undefined) {
  const itemsByCategory = new Map<string, Product[]>();
  for (const item of menu) {
    const name = item.category.trim();
    if (!name) continue;
    const items = itemsByCategory.get(name);
    if (items) items.push(item);
    else itemsByCategory.set(name, [item]);
  }
  return menuCategoryNames(menu, saved).map((name) => ({ name, items: itemsByCategory.get(name) ?? [] }));
}

function useMenuOptions(menu: Product[]) {
  return useMemo(() => menu.map((item) => ({
    id: item.id,
    name: item.name,
    image: item.image,
    detail: item.category.trim() || "Uncategorized",
    searchText: item.costing?.sku,
  })), [menu]);
}

function CategorySheet({
  category,
  defaultName = "",
  menu,
  onSave,
  onRemove,
  onClose,
}: {
  category?: { name: string; items: Product[] };
  defaultName?: string;
  menu: Product[];
  onSave: (name: string, ids: string[]) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? defaultName);
  const [picked, setPicked] = useState(category?.items.map((p) => p.id) ?? []);
  const options = useMenuOptions(menu);
  const { busy, error, run } = useRecordSave(onClose);
  const selected = new Set(picked);
  const moving = menu.filter((p) => selected.has(p.id) && p.category.trim() && p.category.trim() !== category?.name);
  return (
    <RecordSheet
      noun="category"
      help={
        <>
          <p>Save a category now and assign items whenever you’re ready.</p>
          <p>Removing a category keeps its items on the menu, with no category.</p>
        </>
      }
      editing={Boolean(category)}
      busy={busy}
      error={error}
      saveBlocked={!name.trim() && "Enter a category name."}
      onSave={() => void run(() => onSave(name.trim(), picked))}
      onRemove={onRemove}
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
        {menu.length > 0 && (
          <div className="field">
            <span>Items (optional)</span>
            <MultiSelect label="Items in this category" searchNoun="menu items" items={options} picked={picked} onChange={setPicked} showThumbnails disabled={busy} />
            {moving.length > 0 && (
              <p className="label">
                {namesText(moving.map((p) => p.name)) + " will move here from " + namesText([...new Set(moving.map((p) => p.category.trim()))]) + "."}
              </p>
            )}
          </div>
        )}
      </div>
    </RecordSheet>
  );
}

export function CategoriesPage(props: RecipesProps) {
  const menu = props.state.menu;
  const commit = useCommit(props);
  const list = categoriesOf(menu, props.state.business?.settings.menuCategories);
  const [editing, setEditing] = useState<(typeof list)[number] | "new" | null>(null);
  const [query, setQuery] = useState("");
  const shown = list.filter((c) => matches(query, c.name, ...c.items.map((p) => p.name)));
  const loose = menu.filter((p) => !p.category.trim()).length;
  const select = useRecordSelect(list.map((c) => c.name));
  const addCategory = !select.on && (
    <AddButton blockedReason={!props.online && OFFLINE} onClick={() => setEditing("new")} />
  );
  return (
    <SubPage
      title="Categories"
      action={list.length < 2 ? undefined : <RecordSelectToggle select={select} disabled={!props.online} />}
      help={<p>Save categories ahead of time. They appear on Sell when they contain items. Items with no category show last.</p>}
      backLabel={props.backLabel}
      sentence={list.length > 0 && (
        <>
          {plural(list.length, "category", "categories")} <span className="g">for your menu.</span>
        </>
      )}
      sentenceAction={list.length > 0 && addCategory}
      onBack={props.onBack}
    >
      <RecordSearch count={list.length} noun="categories" query={query} onQuery={setQuery} />
      {list.length > 0 && !shown.length ? (
        <RecordNoMatch query={query} onClear={() => setQuery("")} />
      ) : list.length > 0 ? (
        <RecordGroup>
          {shown.map((c) => (
            <RecordRow
              key={c.name}
              disabled={!props.online}
              onClick={() => setEditing(c)}
              select={select.row(c.name)}
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
        <EmptyState
          pose="plan"
          object="categoryTag"
          title="No categories yet"
          text="Add a category like Drinks or Pastries. You can assign items later."
        >
          {addCategory}
        </EmptyState>
      )}
      {select.on && (
        <RecordSelectBar
          select={select}
          shown={shown.map((c) => c.name)}
          noun="category"
          nouns="categories"
          removeDetail={(names) => {
            const items = menu.filter((p) => names.includes(p.category.trim())).length;
            return `${andText(names, 3)} will come off Sell. ${plural(items, "item")} ${items === 1 ? "stays" : "stay"} on the menu, with no category.`;
          }}
          onRemove={(names) =>
            commit.run(
              (pin) => props.onMenuCategory({ action: "removeMenuCategories", names }, pin),
              "Removed " + plural(names.length, "category", "categories"),
            )
          }
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
            const previous = editing === "new" ? undefined : editing.name;
            return commit.run(
              (pin) => props.onMenuCategory({ action: "saveMenuCategory", name, previous, itemIds: ids }, pin),
              (previous ? "Saved " : "Added ") + name,
            );
          }}
          onRemove={
            editing === "new"
              ? undefined
              : () =>
                  commit.run(
                    (pin) => props.onMenuCategory({ action: "removeMenuCategories", names: [editing.name] }, pin),
                    "Removed " + editing.name,
                  )
          }
        />
      )}
    </SubPage>
  );
}

/* ---------- choices ---------- */

const choiceKinds = [
  { title: "Pick one", required: true, empty: "No Pick one choices yet" },
  { title: "Add-ons", required: false, empty: "No add-ons yet" },
];

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
        if (found.items.at(-1) !== p) found.items.push(p);
      } else map.set(key, { key, name: g.name, required: g.required, options: g.options, items: [p] });
    }
  return [...map.values()];
}

function ChoiceSheet({
  choice,
  menu,
  currency,
  defaultRequired = true,
  onSave,
  onRemove,
  onClose,
}: {
  choice?: Choice;
  menu: Product[];
  currency: string;
  defaultRequired?: boolean;
  onSave: (group: Omit<OptionGroup, "id">, ids: string[]) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(choice?.name ?? "");
  const [required, setRequired] = useState(choice?.required ?? defaultRequired);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    choice ? choice.options.map((o) => ({ id: o.id, name: o.name, price: priceText(o.price, currency) })) : [blankOption()],
  );
  const [picked, setPicked] = useState(choice?.items.map((p) => p.id) ?? []);
  const menuOptions = useMenuOptions(menu);
  const reuse = useMemo(() => reusable(menu, undefined, currency), [menu, currency]);
  const { busy, error, run } = useRecordSave(onClose);
  return (
    <RecordSheet
      noun="choice"
      editing={Boolean(choice)}
      busy={busy}
      error={error}
      saveBlocked={!name.trim() ? "Enter a choice name." : !picked.length && "Choose at least one item."}
      onSave={() =>
        void run(() => onSave({ name: name.trim(), required, options: parseOptions(options, currency) }, picked))
      }
      onRemove={onRemove}
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
        <MultiSelect label="Items that offer this choice" searchNoun="menu items" items={menuOptions} picked={picked} onChange={setPicked} showThumbnails disabled={busy} />
      </div>
    </RecordSheet>
  );
}

function applyChoice(menu: Product[], group: Omit<OptionGroup, "id">, ids: string[], key?: string) {
  const selected = new Set(ids);
  return menu.map((p) => {
    const at = key ? p.groups.findIndex((g) => choiceKey(g) === key) : -1;
    if (!selected.has(p.id)) return at < 0 ? p : { ...p, groups: p.groups.filter((_, i) => i !== at) };
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

export function ChoicesPage(props: RecipesProps) {
  const business = props.state.business!;
  const menu = props.state.menu;
  const commit = useCommit(props);
  const list = choicesOf(menu);
  const [editing, setEditing] = useState<Choice | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<string | null>(null);
  const activeKind = choiceKinds.find(({ title }) => title === tab);
  const inTab = activeKind ? list.filter((choice) => choice.required === activeKind.required) : list;
  const optionsText = (c: Choice) =>
    c.options.map((o) => o.name + (o.price ? " +" + formatMoney(o.price, business.currency) : "")).join(", ");
  const shown = inTab.filter((c) => matches(query, c.name, optionsText(c), ...c.items.map((p) => p.name)));
  const kinds = choiceKinds.map(({ title, required }) => ({
    title,
    items: shown.filter((choice) => choice.required === required),
  })).filter(({ items }) => items.length);
  const select = useRecordSelect(list.map((c) => c.key));
  const addButton = !select.on && menu.length > 0 && (
    <AddButton
      blockedReason={!props.online && OFFLINE}
      onClick={() => setEditing("new")}
    />
  );

  return (
    <SubPage
      title="Choices"
      action={list.length < 2 ? undefined : <RecordSelectToggle select={select} disabled={!props.online} />}
      help={
        <>
          <p><strong>Pick one</strong> choices, like Size, make the cashier choose. <strong>Add-ons</strong>, like an extra shot, are optional.</p>
          <p>Set a choice up once and pick the items that offer it. Changes go live on Sell right away.</p>
        </>
      }
      backLabel={props.backLabel}
      sentence={list.length > 0 && (
        <>
          {plural(list.length, "choice")} <span className="g">asked at checkout.</span>
        </>
      )}
      sentenceAction={inTab.length > 0 && addButton}
      onBack={props.onBack}
    >
      <RecordSearch
        count={list.length}
        noun="choices"
        query={query}
        onQuery={setQuery}
        filters={{ label: "Choice types", options: choiceKinds.map(({ title }) => title), value: tab, onChange: setTab }}
      />
      {inTab.length > 0 && !shown.length && (
        <RecordNoMatch query={query} onClear={() => {
          setQuery("");
          setTab(null);
        }} />
      )}
      {kinds.map((k) => (
        <RecordGroup key={k.title} title={activeKind ? undefined : k.title}>
          {k.items.map((c) => (
            <RecordRow
              key={c.key}
              disabled={!props.online}
              onClick={() => setEditing(c)}
              select={select.row(c.key)}
              lead={
                <span className="well">
                  <ListPlus size={18} strokeWidth={1.8} />
                </span>
              }
              title={c.name}
              detail={optionsText(c)}
              end={plural(c.items.length, "item")}
            />
          ))}
        </RecordGroup>
      ))}
      {!inTab.length && (
        <EmptyState
          pose={activeKind?.required === false ? "sale" : "welcome"}
          object={menu.length ? "choiceTiles" : "itemsSold"}
          title={menu.length ? activeKind?.empty ?? "No choices yet" : "Add menu items first"}
          text={
            !menu.length ? "Choices are asked when an item is added to the order."
              : activeKind?.required === true ? "Add a required choice like size or milk."
              : activeKind?.required === false ? "Add an optional extra like a shot or a topping."
              : "Set up a choice and pick the menu items that offer it."
          }
        >
          {menu.length ? addButton : (
            <button type="button" className="btn compact" onClick={() => props.onPage("menu")}>Go to Menu Items</button>
          )}
        </EmptyState>
      )}
      {select.on && (
        <RecordSelectBar
          select={select}
          shown={shown.map((c) => c.key)}
          noun="choice"
          removeDetail={(keys) =>
            `${andText(list.filter((c) => keys.includes(c.key)).map((c) => c.name), 3)} will no longer be asked on any item.`
          }
          onRemove={(keys) =>
            commit.menu(
              menu.map((p) => ({ ...p, groups: p.groups.filter((g) => !keys.includes(choiceKey(g))) })),
              "Removed " + plural(keys.length, "choice"),
            )
          }
        />
      )}
      {!props.online && <p className="label">Connect to edit choices.</p>}
      {editing && (
        <ChoiceSheet
          choice={editing === "new" ? undefined : editing}
          menu={menu}
          currency={business.currency}
          defaultRequired={activeKind?.required}
          onClose={() => setEditing(null)}
          onSave={(group, ids) =>
            commit.menu(
              applyChoice(menu, group, ids, editing === "new" ? undefined : editing.key),
              (editing === "new" ? "Added " : "Saved ") + group.name,
            )
          }
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
