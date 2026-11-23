"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Ban, CalendarDays, Camera, Check, ChevronDown, ChevronRight, CloudOff, Minus, Plus, Search, ShoppingBag, Trash2, Volume2, VolumeX, X } from "lucide-react";
import type {
  CartLine,
  Product,
  ReceiptLine,
  RegisterState,
  Sale,
  Shift,
  Tender,
} from "@/lib/types";
import { canMake, shiftStock } from "@/lib/stock";
import { shiftName } from "@/lib/shift-name";
import {
  makeSale,
  parseMoney,
  priceLines,
  priceOrder,
  proofsNeeded,
  saveMenuItem,
  stockLeft,
  totalLines,
} from "@/lib/domain";
import { menuCategoryNames, type MenuCategoryChange } from "@/lib/menu-categories";
import { ItemSheet } from "./menu-settings";
import { MultiSelect } from "./multi-select";
import { blobToDataUrl, compressPhoto } from "@/lib/photo";
import { currencyDigits, isSimpleMode } from "@/lib/settings";
import { ReceiptSheet, receiptNumber } from "./receipt";
import { Popo } from "./popo";
import { ConfirmSaleSlider, saleSlideSound } from "./confirm-sale-slider";
import { collapseOnExit, fadeOnExit } from "@/lib/exit";
import {
  buzz,
  CategoryTabs,
  ConfirmSheet,
  DoneCheck,
  EmptyState,
  GlossyObject,
  ItemFaces,
  errorText,
  usePin,
  formatMoney,
  haptic,
  MethodIcon,
  Money,
  MoneyField,
  Notice,
  Sheet,
  Explain,
} from "./ui";
import { blocked as blockedBy } from "@/lib/reject";
import styles from "./sell.module.css";

/* Bills in major units. Quick cash buttons round the total up to the next bill. */
const bills: Record<string, number[]> = {
  PHP: [20, 50, 100, 200, 500, 1000],
  USD: [1, 5, 10, 20, 50, 100],
  EUR: [5, 10, 20, 50, 100],
  GBP: [5, 10, 20, 50],
  SGD: [2, 5, 10, 50, 100],
  MYR: [1, 5, 10, 20, 50, 100],
  IDR: [2000, 5000, 10000, 20000, 50000, 100000],
  THB: [20, 50, 100, 500, 1000],
  VND: [10000, 20000, 50000, 100000, 200000, 500000],
  JPY: [1000, 5000, 10000],
  AUD: [5, 10, 20, 50, 100],
  CAD: [5, 10, 20, 50, 100],
};

export function quickCash(total: number, currency: string) {
  const unit = 10 ** currencyDigits(currency);
  const list = (bills[currency] ?? [1, 5, 10, 20, 50, 100]).map(
    (b) => b * unit,
  );
  const options = new Set<number>();
  for (const bill of list) {
    const up = Math.ceil(total / bill) * bill;
    if (up > total) options.add(up);
  }
  return [...options].sort((a, b) => a - b).slice(0, 3);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function Stepper({
  value,
  name,
  onChange,
  disabled,
  removable,
}: {
  value: number;
  name: string;
  onChange: (n: number) => void;
  disabled?: boolean;
  removable?: boolean;
}) {
  return (
    <div className={`stepper ${styles.stepper}`} role="group" aria-label={name + " quantity"}>
      <button
        type="button"
        aria-label={value === 1 && removable ? "Remove " + name : "One less " + name}
        disabled={disabled || (value <= 1 && !removable)}
        onClick={() => onChange(value - 1)}
      >
        {value === 1 && removable ? <Trash2 size={15} /> : <Minus size={16} />}
      </button>
      <span aria-live="polite">{value}</span>
      <button
        type="button"
        aria-label={"One more " + name}
        disabled={disabled || value >= 999}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function OrderLines({
  lines,
  currency,
  busy,
  onQuantity,
}: {
  lines: ReceiptLine[];
  currency: string;
  busy: boolean;
  onQuantity: (index: number, value: number) => void;
}) {
  return (
    <div className="card card-list" ref={collapseOnExit}>
      {lines.map((line, index) => (
        <div
          className="order-line"
          ref={collapseOnExit}
          key={line.productId + ":" + line.optionIds.join(",")}
        >
          <div className="grow stack">
            <span className="strong ellipsis">{line.name}</span>
            <span className="label ellipsis">
              {line.options.length ? line.options.join(", ") + " · " : ""}
              {formatMoney(line.unitPrice * line.quantity, currency)}
            </span>
          </div>
          <Stepper
            value={line.quantity}
            name={line.name}
            disabled={busy}
            removable
            onChange={(v) => onQuantity(index, v)}
          />
        </div>
      ))}
    </div>
  );
}

function ItemOptions({
  product,
  currency,
  soldOut,
  busy,
  onAdd,
  onClose,
}: {
  product: Product;
  currency: string;
  soldOut: string[];
  busy: boolean;
  onAdd: (options: string[], quantity: number) => Promise<boolean>;
  onClose: () => void;
}) {
  // Required choices start on their first available option: one tap adds the usual order.
  const [selected, setSelected] = useState<string[]>(() =>
    product.groups.flatMap((g) => {
      if (!g.required) return [];
      const first = g.options.find((o) => !soldOut.includes(o.id));
      return first ? [first.id] : [];
    }),
  );
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const optionGroupId = useId();
  const unit =
    product.price +
    product.groups
      .flatMap((g) => g.options)
      .reduce((s, o) => s + (selected.includes(o.id) ? o.price : 0), 0);
  const complete = product.groups.every(
    (g) => !g.required || g.options.some((o) => selected.includes(o.id)),
  );
  return (
    <Sheet
      title={product.name}
      onClose={onClose}
      busy={busy}
      footer={
        <div className="row gap-12">
          <Stepper
            value={quantity}
            name={product.name}
            onChange={setQuantity}
            disabled={busy}
          />
          <button
            className="btn grow"
            disabled={!complete || busy}
            onClick={async () => {
              if (await onAdd(selected, quantity)) onClose();
              else setError("Couldn't add that. Try again.");
            }}
          >
            Add <Money value={unit * quantity} currency={currency} />
          </button>
        </div>
      }
    >
      {product.groups.map((group) => (
        <fieldset
          key={group.id}
          className="stack gap-8"
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <legend className="between" style={{ width: "100%", marginBottom: 8 }}>
            <span className="strong">{group.name}</span>
            <span className="label">
              {group.required ? "Pick one" : "Optional"}
            </span>
          </legend>
          {group.required ? (
            <div className="card card-list">
              {group.options.map((option) => {
                const out = soldOut.includes(option.id);
                return (
                  <label key={option.id} className={`list-row ${styles.option}`} {...blockedBy(out && `${option.name} is sold out.`)}>
                    <input
                      className="sr-only"
                      type="radio"
                      name={`${optionGroupId}-${group.id}`}
                      checked={selected.includes(option.id)}
                      disabled={out || busy}
                      onChange={() => setSelected((prev) => [
                        ...prev.filter((id) => !group.options.some((o) => o.id === id)),
                        option.id,
                      ])}
                    />
                    <span className={styles.optionMark} aria-hidden="true">
                      <Check size={15} />
                    </span>
                    <span className={"grow" + (out ? " g" : "")}>{option.name}</span>
                    <span className="label end">
                      {out ? "Sold out" : option.price ? "+" + formatMoney(option.price, currency) : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <MultiSelect
              label={group.name}
              searchNoun="add-ons"
              items={group.options.map((option) => {
                const out = soldOut.includes(option.id);
                return {
                  id: option.id,
                  name: option.name,
                  disabled: out,
                  note: out ? "Sold out" : option.price ? "+" + formatMoney(option.price, currency) : undefined,
                };
              })}
              picked={selected.filter((id) => group.options.some((option) => option.id === id))}
              onChange={(picked) => setSelected((prev) => [
                ...prev.filter((id) => !group.options.some((option) => option.id === id)),
                ...picked,
              ])}
              disabled={busy}
            />
          )}
        </fieldset>
      ))}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function OptionAvailability({
  product,
  soldOut,
  busy,
  onToggle,
  onClose,
}: {
  product: Product;
  soldOut: string[];
  busy: boolean;
  onToggle: (id: string, out: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const row = (id: string, name: string, strong = false) => {
    const out = soldOut.includes(id);
    return (
      <div className="list-row" key={id}>
        <span className={"grow" + (strong ? " strong" : "")}>{name}</span>
        <span className={"label" + (out ? " danger" : "")}>
          {out ? "Sold out" : "Available"}
        </span>
        <span className="switch-hit">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={!out}
            aria-label={name + " available"}
            disabled={busy}
            onClick={() => void onToggle(id, !out)}
          />
        </span>
      </div>
    );
  };
  return (
    <Sheet
      title={product.name}
      onClose={onClose}
      busy={busy}
      footer={
        <button className="btn block" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="card card-list">{row(product.id, "Whole item", true)}</div>
      {product.groups.map((g) => (
        <div className="stack gap-8" key={g.id}>
          <p className="group-title" style={{ marginBottom: 0 }}>
            {g.name}
          </p>
          <div className="card card-list">
            {g.options.map((o) => row(o.id, o.name))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

type Done = { sale: Sale; shiftNumber: number };

/** A photo taken at checkout. It stays on the phone until the sale syncs. */
function ProofShot({
  label,
  hint,
  required,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  required: boolean;
  value?: string;
  onChange: (url: string | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={"proof" + (value ? " has" : required ? " needed" : "")}>
      <button
        type="button"
        className="proof-slot"
        aria-label={(value ? "Retake " : "Take ") + label}
        aria-busy={busy}
        disabled={busy}
        onClick={() => {
          buzz.tap();
          input.current?.click();
        }}
      >
        {value ? <img src={value} alt="" /> : <Camera size={20} strokeWidth={1.7} />}
      </button>
      <span className="grow stack">
        <span className="strong-ish">
          {label}
          {required && !value ? <span className="proof-tag">Needed</span> : null}
        </span>
        <span className="label" role="status">
          {error || (busy ? "Preparing photo…" : value ? "Photo ready. Tap to retake." : hint)}
        </span>
      </span>
      {value && (
        <button type="button" className="round flat" aria-label={"Remove " + label} disabled={busy} onClick={() => onChange(undefined)}>
          <X size={16} />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          try {
            onChange(await blobToDataUrl(await compressPhoto(file, 1000, 0.7)));
            buzz.success();
          } catch (err) {
            setError(errorText(err));
            buzz.error();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function Checkout({
  state,
  lines,
  busy,
  blocked,
  preview = false,
  onQuantity,
  onClear,
  onPay,
  onClose,
  onReceipt,
  practice = false,
}: {
  state: RegisterState;
  lines: ReceiptLine[];
  busy: boolean;
  blocked: boolean;
  preview?: boolean;
  practice?: boolean;
  onQuantity: (index: number, value: number) => Promise<void>;
  onClear: () => void;
  onPay: (tender: Tender, received: number, discountId?: string, proofs?: string[]) => Promise<Sale | null>;
  onClose: () => void;
  onReceipt: (sale: Sale) => void;
}) {
  const shift = state.shift!;
  const currency = shift.settings.currency;
  const methods = shift.settings.payments.filter((p) => p.on);
  const discounts = shift.settings.discounts.filter((d) => d.on);
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  const [discountId, setDiscountId] = useState<string | undefined>();
  const [cash, setCash] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [saved, setSaved] = useState<Done | null>(null);
  const [slideSound, setSlideSound] = useState(() => {
    try {
      return localStorage.getItem("pop-pos-sale-sound") !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setDone(saved), 320);
    return () => window.clearTimeout(timer);
  }, [saved]);
  /** Cash received, once a payment is picked. The sale is saved only after confirmation. */
  const [review, setReview] = useState<number | null>(null);
  const chosen = methods.find((m) => m.id === method);
  const stage = done ? "done" : review !== null && chosen ? "review" : "charge";
  const previousStage = useRef(stage);
  const stageTarget = useRef<HTMLDivElement>(null);
  const discountDetails = useRef<HTMLDetailsElement>(null);
  const discountChoices = useRef<HTMLDivElement>(null);
  const chargePosition = useRef({ top: 0, discountOpen: false, discountLeft: 0 });
  useLayoutEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const target = stageTarget.current;
    if (stage === "charge") {
      const { top, discountOpen, discountLeft } = chargePosition.current;
      if (discountDetails.current) discountDetails.current.open = discountOpen;
      if (discountChoices.current) discountChoices.current.scrollLeft = discountLeft;
      target?.closest(".sheet-body")?.scrollTo({ top, behavior: "instant" });
    } else {
      target?.closest(".sheet-body")?.scrollTo({ top: 0, behavior: "instant" });
    }
    target?.focus({ preventScroll: true });
  }, [stage]);
  const reviewedLines = saved?.sale.lines ?? lines;
  const order = saved?.sale ?? (lines.length ? priceOrder(shift, lines, discountId) : null);
  const total = order?.total ?? 0;
  const [payPhoto, setPayPhoto] = useState<string>();
  const [idPhoto, setIdPhoto] = useState<string>();
  const discount = discounts.find((d) => d.id === discountId);
  const nonCash = Boolean(chosen && chosen.kind !== "cash");
  const proofs = [nonCash ? payPhoto : undefined, discount?.proof ? idPhoto : undefined].filter(
    (p): p is string => Boolean(p),
  );
  const missing = chosen ? proofsNeeded(shift, chosen.id, discountId) > proofs.length : false;
  const missingText = discount?.proof && !idPhoto
    ? `Take a photo of the ${discount.name} ID first.`
    : `Take a photo of the ${chosen?.name ?? ""} payment first.`;
  const canPay = !busy && !blocked && lines.length > 0 && !missing;
  // Why Charge can't go ahead, said when the button is tapped anyway.
  const payRefusal = blocked ? "Remove the sold-out item to charge." : missing ? missingText : !lines.length && "The order is empty.";

  let typed: number | undefined;
  if (cash.trim()) {
    try {
      typed = parseMoney(cash, currency);
    } catch {
      /* still typing */
    }
  }

  function ask(received: number) {
    if (!chosen || !canPay) return;
    chargePosition.current = {
      top: stageTarget.current?.closest(".sheet-body")?.scrollTop ?? 0,
      discountOpen: discountDetails.current?.open ?? false,
      discountLeft: discountChoices.current?.scrollLeft ?? 0,
    };
    setError("");
    buzz.tap();
    setReview(received);
  }

  function backToCharge() {
    setReview(null);
    setError("");
  }

  async function pay(received: number) {
    if (!chosen || !canPay || saved || received < total) return;
    setError("");
    try {
      const sale = await onPay(chosen.id, received, discountId, proofs);
      if (sale) {
        buzz.success();
        if (slideSound) saleSlideSound("saved");
        const result = { sale, shiftNumber: shift.number };
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) setDone(result);
        else setSaved(result);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  const faces = (list: { productId: string; name: string }[]) => {
    const seen = new Set<string>();
    return list.flatMap((l) =>
      seen.has(l.productId)
        ? []
        : (seen.add(l.productId), [{ id: l.productId, name: l.name, image: shift.menu.find((p) => p.id === l.productId)?.image }]),
    );
  };

  if (done) {
    const { sale } = done;
    const cash = sale.payment.kind === "cash";
    const showChange = cash && sale.change > 0;
    const number = receiptNumber(done.shiftNumber, sale.sequence);
    const itemCount = sale.lines.reduce((n, l) => n + l.quantity, 0);
    const resultLabel = showChange ? "Change to give" : cash ? "Exact cash, no change" : "Paid with " + sale.payment.name;
    return (
      <Sheet
        title={preview ? "Test sale complete" : "Sale complete"}
        onClose={onClose}
        footer={
          <>
            <button className="btn block" onClick={onClose}>
              {practice ? "Continue" : "New sale"}
            </button>
            <button type="button" className="btn ghost block compact" onClick={() => onReceipt(sale)}>
              <GlossyObject className="action-object" object="salesReceipt" />
              View receipt
            </button>
          </>
        }
      >
        <div key="done" className="confirm-sale">
          <div
            className={`hero sale-hero ${styles.stageFocus} ${styles.resultHero}`}
            ref={stageTarget}
            tabIndex={-1}
            role="group"
            aria-label={`Sale complete. Receipt ${number}. ${resultLabel}. ${formatMoney(showChange ? sale.change : sale.total, currency)}.`}
          >
            <div className="stack gap-8">
              <span className="row gap-8 hero-label">
                <DoneCheck small />
                {preview ? "Preview" : "Saved"} · {number}
              </span>
              <span className="hero-label sale-hero-what">
                {resultLabel}
              </span>
              <Money value={showChange ? sale.change : sale.total} currency={currency} className="due-num" />
              <span className="hero-label">
                {showChange
                  ? `From ${formatMoney(sale.received, currency)} cash for ${formatMoney(sale.total, currency)}`
                  : new Intl.DateTimeFormat("en", { timeZone: state.business!.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(sale.createdAt))}
              </span>
            </div>
            <Popo pose="sale" motion="victoryHop" size={74} className={styles.resultMascot} />
          </div>
          <div className={`row gap-10 sale-items ${styles.resultDetails}`}>
            <ItemFaces items={faces(sale.lines)} />
            <span className="label">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </span>
          </div>
        </div>
      </Sheet>
    );
  }

  if (review !== null && chosen) {
    const isCash = chosen.kind === "cash";
    const change = review - total;
    const finishing = busy || Boolean(saved);
    return (
      <Sheet
        title={preview ? "Confirm test sale" : "Confirm sale"}
        onClose={backToCharge}
        busy={finishing}
        action={
          <button
            type="button"
            className="round flat"
            aria-label="Checkout sounds"
            aria-pressed={slideSound}
            disabled={finishing}
            onClick={() => {
              setSlideSound(!slideSound);
              try {
                localStorage.setItem("pop-pos-sale-sound", slideSound ? "off" : "on");
              } catch {
                // The toggle still applies to the current checkout.
              }
              if (!slideSound) saleSlideSound("grab");
            }}
          >
            {slideSound ? <Volume2 size={19} aria-hidden /> : <VolumeX size={19} aria-hidden />}
          </button>
        }
        footer={
          <>
            <ConfirmSaleSlider
              preview={Boolean(preview)}
              phase={saved ? "saved" : busy ? "saving" : "idle"}
              refusal={!finishing && (payRefusal || (review < total && "That's less than the total."))}
              sound={slideSound}
              onConfirm={() => void pay(review)}
            />
            <button
              className="btn ghost block compact"
              disabled={finishing}
              onClick={backToCharge}
            >
              Back
            </button>
          </>
        }
      >
        <div key="review" className="confirm-sale">
          <div className={`stack gap-8 confirm-main ${styles.stageFocus}`} ref={stageTarget} tabIndex={-1}>
            <p className="headline">
              <Money value={isCash && change > 0 ? change : total} currency={currency} />{" "}
              <span className="g">
                {!isCash ? "to receive in " + chosen.name + "." : change > 0 ? "change to give." : "exact, no change."}
              </span>
            </p>
          </div>
          <div className="card card-list">
            <div className="list-row">
              <span className="grow">Items</span>
              <ItemFaces items={faces(reviewedLines)} />
            </div>
            <div className="list-row">
              <span className="grow">
                Total
                {order?.discount && <span className="label"> · {order.discount.name}</span>}
              </span>
              <Money value={total} currency={currency} />
            </div>
            <div className="list-row">
              <span className="grow">{isCash ? "Cash received" : chosen.name + " received"}</span>
              <Money value={review} currency={currency} />
            </div>
          </div>
          {!preview && !isCash && (
            <p className="label">
              Check that {formatMoney(total, currency)} arrived in {chosen.name} first.
            </p>
          )}
        </div>
        {blocked && <Notice tone="danger" live="assertive">An item sold out. Go back and remove it to charge.</Notice>}
        {review < total && <Notice tone="warn" live="assertive">The total changed. Go back to review the new total.</Notice>}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  }

  const quick = quickCash(total, currency);
  return (
    <Sheet
      title={preview ? "Test checkout" : "Charge"}
      onClose={onClose}
      busy={busy}
      action={
        <button className="btn ghost compact" disabled={busy} onClick={onClear}>
          Clear
        </button>
      }
      footer={
        chosen && chosen.kind !== "cash" ? (
          <button
            className="btn block"
            disabled={busy}
            {...blockedBy(payRefusal)}
            onClick={() => ask(total)}
          >
            {missing ? "Take the photo first ·" : preview ? "Simulate payment ·" : `${chosen.name} received ·`}
            {!busy && <Money value={total} currency={currency} />}
          </button>
        ) : chosen && typed !== undefined ? (
          <button
            className="btn block"
            disabled={busy}
            {...blockedBy(payRefusal || (typed < total && "That's less than the total."))}
            onClick={() => ask(typed)}
          >
            {typed < total ? (
              <>
                Short by <Money value={total - typed} currency={currency} />
              </>
            ) : typed === total ? "Next · exact cash" : (
              <>
                Next · change{" "}
                <Money value={typed - total} currency={currency} />
              </>
            )}
          </button>
        ) : undefined
      }
    >
      <div key="charge">
        <OrderLines
          lines={lines}
          currency={currency}
          busy={busy}
          onQuantity={(index, value) => {
            setError("");
            void onQuantity(index, value).catch((error) => setError(errorText(error)));
          }}
        />
      </div>
      {blocked && <Notice tone="danger" live="assertive">Remove the sold-out item to charge.</Notice>}
      <div className={`due ${styles.stageFocus}`} ref={stageTarget} tabIndex={-1}>
        <span className="stack">
          <span className="strong">Total</span>
          {order?.discount && (
            <span className="label">
              <span className="struck">
                {formatMoney(order.subtotal, currency)}
              </span>{" "}
              − {formatMoney(order.discount.amount, currency)}
            </span>
          )}
        </span>
        <Money value={total} currency={currency} />
      </div>
      {discounts.length > 0 && (
        <details className={styles.discount} ref={discountDetails}>
          <summary>
            {discount ? `Discount · ${discount.name}` : "Discount"}
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className={`chips ${styles.discountChoices}`} ref={discountChoices} role="group" aria-label="Discount">
            <button
              type="button"
              aria-pressed={!discountId}
              disabled={busy}
              onClick={() => {
                setDiscountId(undefined);
                setError("");
              }}
            >
              No discount
            </button>
            {discounts.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={discountId === d.id}
                disabled={busy}
                onClick={() => {
                  setDiscountId(d.id);
                  setError("");
                }}
              >
                {d.name} ·{" "}
                {d.type === "percent"
                  ? d.value + "%"
                  : formatMoney(d.value, currency)}
              </button>
            ))}
          </div>
        </details>
      )}
      <div
        className={"methods" + (methods.length % 3 === 0 ? " three" : "")}
        role="group"
        aria-label="Payment method"
      >
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`method ${styles.paymentMethod}`}
            aria-pressed={method === m.id}
            disabled={busy}
            onClick={() => {
              setMethod(m.id);
              setError("");
            }}
          >
            <MethodIcon kind={m.kind} />
            <span className="ellipsis">{m.name}</span>
          </button>
        ))}
      </div>
      {(discount?.proof || nonCash) && (
        <div className="card card-list proofs">
          {discount?.proof && (
            <ProofShot
              label={discount.name + " ID"}
              hint="Photo of the ID, kept with the receipt."
              required
              value={idPhoto}
              onChange={setIdPhoto}
            />
          )}
          {nonCash && chosen && (
            <ProofShot
              label={chosen.name + " payment"}
              hint={chosen.proof ? "Photo of the payment screen." : "Optional. A photo of the payment screen."}
              required={Boolean(chosen.proof)}
              value={payPhoto}
              onChange={setPayPhoto}
            />
          )}
        </div>
      )}
      {chosen?.kind === "cash" && (
        <div className="stack gap-10">
          <p className="label">{missing ? missingText : "Cash received"}</p>
          <div className={`quick ${styles.quickCash}`} role="group" aria-label="Cash received">
            <button
              type="button"
              disabled={busy}
              {...blockedBy(payRefusal)}
              onClick={() => ask(total)}
            >
              Exact
            </button>
            {quick.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={busy}
                {...blockedBy(payRefusal)}
                onClick={() => ask(amount)}
              >
                {formatMoney(amount, currency)}
              </button>
            ))}
          </div>
          <MoneyField
            label="Other amount"
            value={cash}
            onChange={setCash}
            currency={currency}
          />
        </div>
      )}
      {!preview && chosen && chosen.kind !== "cash" && (
        <p className="label">
          Check that {formatMoney(total, currency)} arrived in {chosen.name}.
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

export interface SellProps {
  preview?: boolean;
  onEditMenu?: () => void;
  onPracticeDone?: () => void;
  state: RegisterState;
  status: string;
  online: boolean;
  pending: boolean;
  onCart: (cart: CartLine[]) => Promise<void>;
  onCheckout: (
    tender: Tender,
    received: number,
    discountId?: string,
    proofs?: string[],
  ) => Promise<Sale>;
  onAvailability: (targetId: string, soldOut: boolean) => Promise<void>;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onMenuCategory?: (change: MenuCategoryChange, pin: string) => Promise<void>;
  onMenu: (menu: Product[], pin: string, stock?: Record<string, number>) => Promise<void>;
  onSaved: (text: string) => void;
  /** Opens the Till, where the shift is run and closed. */
  onTill: () => void;
}

/** Which shift this till is selling for. Tapping it opens the Till. */
/**
 * Which scheduled shift this till is selling for, as a strip at the top of Sell and Till.
 * On Sell it opens the Till; on the Till it opens the shift, or links one if there isn't one.
 */
export function ShiftStrip({ state, onTill, onTillPage = false }: { state: RegisterState; onTill: () => void; onTillPage?: boolean }) {
  const shift = state.shift!;
  const zone = state.business!.timeZone;
  const booking = state.bookings?.find((b) => b.id === shift.bookingId);
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  if (!booking)
    return (
      <button type="button" className="shift-strip" onClick={onTill}>
        <span className="dot" aria-hidden="true" />
        <span className="grow ellipsis">{onTillPage ? "Not on a shift yet. Tap to add it." : "Not on a shift yet. Add it on the Till."}</span>
        <ChevronRight size={16} className="chev" />
      </button>
    );
  const people = booking.staff.map((s) => s.name.split(" ")[0]).join(", ");
  const name = shiftName(booking, state);
  return (
    <button type="button" className="shift-strip" onClick={onTill} aria-label={`Selling for ${name}. ${onTillPage ? "Open the shift." : "Open the Till."}`}>
      <CalendarDays size={16} strokeWidth={1.9} />
      <span className="grow" style={{ paddingBlock: 6, overflowWrap: "anywhere" }}>
        <span className="strong">{name}</span>
        <span className="g">
          {" · "}until {time.format(new Date(booking.endsAt))}
          {people ? " · " + people : ""}
        </span>
      </span>
      <ChevronRight size={16} className="chev" />
    </button>
  );
}

export function ClosedSellScreen({ otherTillOpen, onTill }: { otherTillOpen: boolean; onTill: () => void }) {
  return (
    <>
      <div className="page-top">
        <h1 className="headline">Sell</h1>
      </div>
      <EmptyState
        pose={otherTillOpen ? "connect" : "close"}
        object="cashDrawer"
        title={otherTillOpen ? "A shift is already open" : "Till closed"}
        text={otherTillOpen ? "Choose the open shift to sell on this device." : "Open the till to start selling."}
      >
        <button type="button" className="btn compact" onClick={onTill}>{otherTillOpen ? "Go to Till" : "Open till"}</button>
      </EmptyState>
    </>
  );
}

export function SellScreen({
  preview = false,
  onEditMenu,
  onPracticeDone,
  state,
  status,
  online,
  pending,
  onCart,
  onCheckout,
  onAvailability,
  onReverse,
  onMenu,
  onMenuCategory,
  onSaved,
  onTill,
}: SellProps) {
  const [adding, setAdding] = useState(false);
  const withPin = usePin();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [picked, setPicked] = useState<Product | null>(null);
  const [charging, setCharging] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  /** The sale just went through: keep the sheet up for its change and receipt though the cart is empty. */
  const [paid, setPaid] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [addingProduct, setAddingProduct] = useState<string | null>(null);
  const lock = useRef(false);
  const shift = state.shift!;
  const business = state.business!;
  const simple = isSimpleMode(business.settings);
  const practice = Boolean(onPracticeDone);
  const canEdit = !preview && !practice && (!state.me || state.me.owner);
  const addItemReason = !online ? "Connect to the internet to add items." : state.menu.length >= 1000 && "The menu can hold up to 1,000 items.";
  const currency = shift.settings.currency;
  const menu = shift.menu;
  const categories = useMemo(
    () => {
      const used = new Set(menuCategoryNames(menu));
      return menuCategoryNames(menu, business.settings.menuCategories).filter((name) => used.has(name));
    },
    [menu, business.settings.menuCategories],
  );
  const activeCategory = category && categories.includes(category) ? category : null;
  const busy = working || pending;
  let lines: ReceiptLine[] = [];
  let total = 0;
  let cartMenuError = false;
  try {
    lines = priceLines(menu, state.cart);
    total = totalLines(lines);
  } catch {
    cartMenuError = true;
  }
  let count = 0;
  const quantities = new Map<string, number>();
  for (const line of state.cart) {
    count += line.quantity;
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.quantity);
  }
  const blocked = state.cart.some((l) =>
    [l.productId, ...l.optionIds].some((id) => state.soldOut.includes(id)),
  );
  const q = query.trim().toLocaleLowerCase();
  const items = menu.filter(
    (i) =>
      (!activeCategory || i.category.trim() === activeCategory) &&
      (!q || (i.name + " " + i.category).toLocaleLowerCase().includes(q)),
  );
  const shiftSales = state.sales.filter(
    (s) => s.shiftId === shift.id && !s.reversedAt,
  );

  async function write(op: () => Promise<void>, reportOnPage = true) {
    if (lock.current || pending) return false;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await op();
      return true;
    } catch (e) {
      if (!reportOnPage) throw e;
      setError(errorText(e));
      return false;
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }
  function add(product: Product, optionIds: string[], quantity = 1) {
    const choices = [...optionIds].sort();
    const same = state.cart.findIndex(
      (l) =>
        l.productId === product.id &&
        l.optionIds.length === choices.length &&
        choices.every((id) => l.optionIds.includes(id)),
    );
    const cart =
      same < 0
        ? [...state.cart, { productId: product.id, optionIds: choices, quantity }]
        : state.cart.map((l, i) =>
            i === same ? { ...l, quantity: l.quantity + quantity } : l,
          );
    return write(async () => {
      haptic();
      setAddingProduct(product.id);
      try {
        await onCart(cart);
      } finally {
        setAddingProduct(null);
      }
    });
  }
  async function setQuantity(index: number, value: number, reportOnPage = true) {
    const next =
      value === 0
        ? state.cart.filter((_, i) => i !== index)
        : state.cart.map((l, i) => (i === index ? { ...l, quantity: value } : l));
    const saved = await write(() => onCart(next), reportOnPage);
    if (saved && !next.length) setCharging(false);
  }
  const left = stockLeft(shift, state.sales);
  const model = shiftStock(shift);
  // What the cart already takes, so a tile shows how many more can be made.
  const afterCart = { ...left };
  for (const line of state.cart)
    for (const use of model.uses.get(line.productId) ?? [])
      if (use.stockId in afterCart) afterCart[use.stockId] -= line.quantity * use.amount;
  const isOut = (p: Product) =>
    canMake(model, left, p.id) === 0 ||
    state.soldOut.includes(p.id) ||
    p.groups.some(
      (g) => g.required && g.options.every((o) => state.soldOut.includes(o.id)),
    );

  return (
    <>
      <div className="sell-head">
        <div className="page-top">
          <div className="grow stack" style={{ minWidth: 0 }}>
            <div className="page-title">
              {preview ? <h2 className="headline">Menu preview</h2> : <h1 className="headline">Sell</h1>}
              <Explain title="Selling" label="How selling works">
                <p>Tap an item to add it to the order, then {preview ? "Test checkout" : "Charge"}.</p>
                {!preview && !practice && (
                  <p>
                    Something ran out? Tap <Ban size={13} strokeWidth={2.2} className="inline-icon" aria-label="Mark sold out" /> at the
                    top, then the item. It shows Sold out until you tap it again.
                  </p>
                )}
              </Explain>
            </div>
            {preview ? (
              <p className="label">Try taking an order. Test sales aren’t saved.</p>
            ) : (
              <span className="label row gap-6">
                {!online ? <CloudOff size={13} strokeWidth={2} className="sync-mark" aria-hidden="true" />
                  : status !== "Online" && <span className="dot" />}
                <span className="ellipsis">
                  {shiftSales.length === 1 ? "1 sale" : shiftSales.length + " sales"}
                  {status !== "Online" ? " · " + status : ""}
                </span>
              </span>
            )}
          </div>
          {menu.length > 8 && (
            <button
              className="round"
              aria-label="Search menu"
              aria-pressed={searching}
              onClick={() => {
                setSearching(!searching);
                setQuery("");
              }}
            >
              {searching ? <X size={19} /> : <Search size={19} />}
            </button>
          )}
          {!preview && !practice && (
            <button
              className="round"
              aria-label="Mark items sold out"
              aria-pressed={marking}
              onClick={() => setMarking(!marking)}
            >
              <Ban size={19} />
            </button>
          )}
        </div>
        {!preview && !practice && <ShiftStrip state={state} onTill={onTill} />}
        {marking && (
          <div className="mode-bar" role="status">
            <span className="grow">Tap what ran out. Tap again to bring it back.</span>
            <button className="btn compact" onClick={() => setMarking(false)}>
              Done
            </button>
          </div>
        )}
        {searching && (
          <input
            className="input"
            type="search"
            autoFocus
            aria-label="Search menu"
            placeholder="Search items"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {categories.length > 1 && <CategoryTabs categories={categories} value={activeCategory} onChange={setCategory} />}
      </div>
      {error && (
        <Notice tone="danger" live="assertive">
          {error}
        </Notice>
      )}
      <span className="sr-only" role="status" aria-atomic="true">
        {cartMenuError ? "" : count ? `Order: ${count} ${count === 1 ? "item" : "items"}. Total ${formatMoney(total, currency)}.` : "Order empty."}
      </span>
      {cartMenuError && (
        <Notice
          tone="warn"
          live="assertive"
          action={
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirmClear(true)}>
              Clear
            </button>
          }
        >
          The menu changed. Clear the order and add its items again.
        </Notice>
      )}
      {blocked && (
        <Notice tone="danger" live="assertive">
          Something in this order just sold out. Remove it to charge.
        </Notice>
      )}
      <div>
        {items.length ? (
          <div className="items">
            {items.map((product) => {
              const out = isOut(product);
              const making = canMake(model, afterCart, product.id);
              const qty = quantities.get(product.id) ?? 0;
              const adding = addingProduct === product.id;
              return (
                <button
                  key={product.id}
                  className={`item ${styles.product}` + (out ? " out" : "")}
                  aria-label={
                    (marking
                      ? out
                        ? "Mark available: "
                        : "Mark sold out: "
                      : "Add ") +
                    product.name +
                    ", " +
                    formatMoney(product.price, currency) +
                    (!marking && qty ? `, ${qty} in order` : "")
                  }
                  aria-busy={adding}
                  disabled={busy}
                  {...blockedBy(!marking && out && (canMake(model, left, product.id) === 0
                    ? `No stock left for ${product.name}.`
                    : `${product.name} is sold out.`))}
                  onClick={() => {
                    if (marking) {
                      if (product.groups.length) setPicked(product);
                      else
                        void write(() =>
                          onAvailability(
                            product.id,
                            !state.soldOut.includes(product.id),
                          ),
                        );
                    } else if (product.groups.length) setPicked(product);
                    else void add(product, []);
                  }}
                >
                  {product.image ? (
                    <img className="photo" src={product.image} alt="" draggable={false} />
                  ) : (
                    <span className="initials" aria-hidden="true">
                      {initials(product.name)}
                    </span>
                  )}
                  <span className="name">{product.name}</span>
                  <span className="price">{formatMoney(product.price, currency)}</span>
                  {out && <span className="out-tag">Sold out</span>}
                  {!out && making !== undefined && (
                    <span className={"stock-tag" + (making <= 3 ? " low" : "")}>
                      {Math.max(0, making)} left
                    </span>
                  )}
                  {!marking && (qty > 0 || adding) && (
                    <span className="badge qty" aria-hidden="true">{adding ? "…" : qty}</span>
                  )}
                </button>
              );
            })}
            {canEdit && !marking && !q && !category && (
              <button
                type="button"
                className="item add-tile"
                {...blockedBy(addItemReason)}
                onClick={() => setAdding(true)}
                aria-label="Add an item to the menu"
                aria-haspopup="dialog"
              >
                <span className="add-plus" aria-hidden="true"><Plus size={22} /></span>
                <span className="name">Add</span>
                <span className="price">{online ? "Sells from now" : "Connect to add"}</span>
              </button>
            )}
          </div>
        ) : menu.length ? (
          <EmptyState
            icon={<Search size={22} />}
            title={query.trim() ? `Nothing matches “${query.trim()}”` : "Nothing matches"}
            text="Try another name or category."
          />
        ) : (
          <EmptyState
            pose="menu"
            motion="curiousPeek"
            object="itemsSold"
            title={preview ? "Your menu is empty" : "No items on this shift"}
            text={preview ? "Add an item to your menu to try it here." : canEdit ? "Add your first item. It goes on sale right away." : "Ask the owner to add items."}
          >
            {onEditMenu && <button type="button" className="btn compact" onClick={onEditMenu}>Go to menu items</button>}
            {canEdit && (
              <button
                type="button"
                className="btn compact"
                {...blockedBy(addItemReason)}
                onClick={() => setAdding(true)}
                aria-haspopup="dialog"
              >
                <Plus size={16} aria-hidden="true" /> Add
              </button>
            )}
          </EmptyState>
        )}
      </div>
      {count > 0 && !marking && !cartMenuError && (
        <button
          className={`charge-bar ${styles.chargeBar}`}
          ref={fadeOnExit}
          disabled={busy}
          onClick={() => { setPaid(false); setCharging(true); }}
          aria-label={blocked ? "Review order with sold-out items" : preview ? "Test checkout" : `Charge ${formatMoney(total, currency)} for ${count} ${count === 1 ? "item" : "items"}`}
        >
          <span className="badge">{count}</span>
          <span className="grow" style={{ textAlign: "left" }}>
            {blocked ? "Review order" : preview ? "Test checkout" : "Charge"}
          </span>
          <Money value={total} currency={currency} />
          <span style={{ width: 8 }} />
        </button>
      )}
      {picked &&
        (marking ? (
          <OptionAvailability
            product={picked}
            soldOut={state.soldOut}
            busy={busy}
            onToggle={(id, out) => write(() => onAvailability(id, out))}
            onClose={() => setPicked(null)}
          />
        ) : (
          <ItemOptions
            product={picked}
            currency={currency}
            soldOut={state.soldOut}
            busy={busy}
            onAdd={(ids, qty) => add(picked, ids, qty)}
            onClose={() => setPicked(null)}
          />
        ))}
      {charging && (paid || (!cartMenuError && (count > 0 || busy))) && (
        <Checkout
          preview={preview}
          practice={practice}
          key={shift.menuVersion ?? "opening"}
          state={state}
          lines={lines}
          busy={busy}
          blocked={blocked}
          onQuantity={(index, value) => setQuantity(index, value, false)}
          onClear={() => setConfirmClear(true)}
          onPay={async (tender, received, discountId, proofs) => {
            if (lock.current || pending) return null;
            lock.current = true;
            setWorking(true);
            try {
              const sale = await onCheckout(tender, received, discountId, proofs);
              setPaid(true);
              return sale;
            } finally {
              lock.current = false;
              setWorking(false);
            }
          }}
          onClose={() => {
            setCharging(false);
            setPaid(false);
            if (paid) onPracticeDone?.();
          }}
          onReceipt={(sale) => {
            setCharging(false);
            setPaid(false);
            setReceipt(sale);
          }}
        />
      )}
      {adding && (
        <ItemSheet
          key={simple ? "simple" : "advanced"}
          simple={simple}
          currency={currency}
          menu={state.menu}
          menuCategories={business.settings.menuCategories}
          onAddCategory={onMenuCategory && (async (name, itemIds) => {
            const saved = await withPin((pin) => onMenuCategory({ action: "saveMenuCategory", name, itemIds }, pin));
            if (saved) onSaved("Added " + name);
            return saved;
          })}
          liveShift
          counted={Object.keys(left)}
          stockItems={shift.settings.stockItems}
          costItems={business.settings.stockItems}
          pricing={business.settings.pricing}
          onClose={() => setAdding(false)}
          onSave={async (item, counts) => {
            const done = await withPin((pin) => onMenu(saveMenuItem(state.menu, item), pin, counts));
            if (done) onSaved("Added " + item.name);
            return done;
          }}
        />
      )}
      {confirmClear && (
        <ConfirmSheet
          title="Clear this order?"
          detail="All items in the current order will be removed."
          confirmLabel="Clear"
          onClose={() => setConfirmClear(false)}
          onConfirm={async () => {
            const cleared = await write(() => onCart([]), false);
            if (cleared) setCharging(false);
            return cleared;
          }}
        />
      )}
      {receipt && (
        <ReceiptSheet
          preview={preview}
          sale={state.sales.find((s) => s.id === receipt.id) ?? receipt}
          shift={shift}
          business={business}
          pending={state.pending.some((e) => e.id === receipt.id)}
          canReverse={false}
          onReverse={(reason, pin) => onReverse(receipt.id, reason, pin)}
          onClose={() => {
            setReceipt(null);
            onPracticeDone?.();
          }}
        />
      )}
    </>
  );
}


/** The real Sell screen with a temporary till and no register writes. */
export function MenuPreview({ state, onEditMenu }: { state: RegisterState; onEditMenu: () => void }) {
  const business = state.business!;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [openedAt] = useState(() => new Date().toISOString());
  const shift: Shift = {
    id: "menu-preview",
    number: 1,
    businessId: business.id,
    deviceId: "menu-preview",
    openedAt,
    closedAt: null,
    openingCash: 0,
    menu: state.menu,
    settings: {
      ...business.settings,
      currency: business.currency,
      payments: business.settings.payments.map((method) => ({ ...method, proof: false })),
      discounts: business.settings.discounts.map((discount) => ({ ...discount, proof: false })),
    },
  };
  return (
    <SellScreen
      preview
      onEditMenu={onEditMenu}
      state={{ business, menu: state.menu, deviceId: shift.deviceId, shift, shifts: [shift], cart, sales, pending: [], soldOut: [] }}
      status="Online"
      online
      pending={false}
      onCart={async (next) => setCart(next)}
      onCheckout={async (tender, received, discountId) => {
        const sale = makeSale({
          id: crypto.randomUUID(), shift, sequence: sales.length + 1, cart,
          soldOut: [], tender, received, discountId, createdAt: new Date().toISOString(),
        });
        setSales((previous) => [...previous, sale]);
        setCart([]);
        return sale;
      }}
      onAvailability={async () => {}}
      onReverse={async () => {}}
      onMenu={async () => {}}
      onSaved={() => {}}
      onTill={() => {}}
    />
  );
}
