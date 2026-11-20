"use client";

import { useState } from "react";
import { Calculator, ChevronRight, SlidersHorizontal } from "lucide-react";
import { amountText, parseMoney } from "@/lib/domain";
import { catalogSku, menuCostingOverview, pricingRules, readTargetMargin } from "@/lib/stock";
import type { Business, Product } from "@/lib/types";
import type { RecipesProps } from "./recipes";
import { Row, SubPage, useCommit } from "./settings";
import { useRecordSave } from "./records";
import { EmptyState, Explain, formatMoney, MoneyField } from "./ui";
import styles from "./settings.module.css";
import { blocked, OFFLINE } from "@/lib/reject";

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });
const asPercent = (value: number | undefined) => value === undefined ? "—" : percent.format(value);

export function MenuCostingOverview({ business, menu, online, onEdit, onPricing, onMenu }: {
  business: Business;
  menu: Product[];
  online: boolean;
  onEdit: (item: Product) => void;
  onPricing: () => void;
  onMenu: () => void;
}) {
  const { currency, settings } = business;
  const pricing = pricingRules(currency, settings.pricing);
  const overview = menuCostingOverview(menu, settings.stockItems ?? [], pricing);
  const money = (value: number | undefined) => value === undefined ? "—" : formatMoney(Math.round(value), currency);
  const rulesRow = (
    <div className="card card-list">
      <Row
        icon={<SlidersHorizontal size={18} />}
        title="Pricing rules"
        description="Defaults for suggested prices"
        detail={`${pricing.targetMargin}% · ${money(pricing.roundingIncrement)}`}
        onClick={onPricing}
      />
    </div>
  );
  return (
    <>
      {menu.length ? (
        <>
          <dl className="card card-pad costing-grid costing-summary" aria-label="Menu cost summary">
            <div className={styles.primaryMetric}><dt>Avg. gross margin</dt><dd>{asPercent(overview.averageMargin)}</dd></div>
            <div><dt>Items costed</dt><dd>{overview.costed} of {menu.length}</dd></div>
            <div><dt>Avg. cost per serving</dt><dd>{money(overview.averageCost)}</dd></div>
            <div><dt>Avg. cost % of price</dt><dd>{asPercent(overview.averageCostRatio)}</dd></div>
          </dl>
          {rulesRow}
          <div className="card card-list">
            {overview.rows.map(({ item, cost, suggested }) => (
              <article className="costing-entry" key={item.id}>
                <button className="costing-title between gap-8" {...blocked(!online && OFFLINE)} onClick={() => onEdit(item)}>
                  <span className="stack grow gap-4">
                    <span className="strong">{item.name}</span>
                    <span className="label">{[item.costing?.sku ?? catalogSku("product", item.id), item.category].filter(Boolean).join(" · ")}</span>
                  </span>
                  <ChevronRight size={18} className="chev" aria-hidden="true" />
                </button>
                {cost ? (
                  <dl className="costing-grid">
                    <div><dt>Price</dt><dd>{money(item.price)}</dd></div>
                    <div><dt>Unit cost</dt><dd>{money(cost.cost)}</dd></div>
                    <div><dt>Cost %</dt><dd>{asPercent(cost.costRatio)}</dd></div>
                    <div><dt>Gross profit</dt><dd>{money(cost.profit)}</dd></div>
                    <div><dt>Gross margin</dt><dd>{asPercent(cost.margin)}</dd></div>
                    <div><dt>Suggested price</dt><dd>{money(suggested)}</dd></div>
                  </dl>
                ) : (
                  <p className="label between gap-8"><span>Cost incomplete</span><strong>{money(item.price)}</strong></p>
                )}
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <EmptyState icon={<Calculator size={22} />} title="No menu items yet" text="Add a menu item to see its cost and margin here." />
          <button type="button" className="btn" onClick={onMenu}>Go to menu items</button>
          {rulesRow}
        </>
      )}
    </>
  );
}

export function PricingRulesPage(props: RecipesProps) {
  const business = props.state.business!;
  const { currency } = business;
  const current = pricingRules(currency, business.settings.pricing);
  const [target, setTarget] = useState(String(current.targetMargin));
  const [increment, setIncrement] = useState(amountText(current.roundingIncrement, currency));
  const back = () => props.onPage("costing");
  const { busy, error, run } = useRecordSave(back);
  const commit = useCommit(props);
  const dirty = target !== String(current.targetMargin) || increment !== amountText(current.roundingIncrement, currency);
  return (
    <SubPage title="Pricing rules" backLabel="Back to menu costing" onBack={back}>
      <form className="stack gap-14" aria-busy={busy} onSubmit={(event) => {
        event.preventDefault();
        if (busy || !props.online || !dirty) return;
        void run(() => {
          const targetMargin = readTargetMargin(target);
          const roundingIncrement = parseMoney(increment, currency);
          if (!roundingIncrement) throw Error("Enter a rounding increment greater than zero.");
          return commit.settings({ pricing: { targetMargin, roundingIncrement } }, "Pricing rules saved");
        });
      }}>
        <div className="card card-pad stack gap-14">
          <label className="field">
            <span className="field-head">
              Default target margin (%)
              <Explain title="Default target margin">Menu items can override the target margin.</Explain>
            </span>
            <input className="input" inputMode="decimal" maxLength={12} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <MoneyField label="Round suggested prices up to" value={increment} onChange={setIncrement} currency={currency} />
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
        <button type="submit" className="btn block" disabled={busy || !props.online || !dirty}>
          {busy ? "Saving…" : props.online ? "Save" : "Connect to save"}
        </button>
      </form>
    </SubPage>
  );
}
