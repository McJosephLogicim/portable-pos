"use client";

import { useMemo, useRef, useState } from "react";
import { Ban, CalendarDays, Camera, Check, ChevronDown, ChevronRight, Minus, Plus, Search, Trash2, X } from "lucide-react";
import type {
  CartLine,
  Product,
  ReceiptLine,
  RegisterState,
  Sale,
  Tender,
} from "@/lib/types";
import { canMake, shiftStock } from "@/lib/stock";
import { bookingTitle } from "./shift";
import {
  amountText,
  parseMoney,
  priceLines,
  priceOrder,
  proofsNeeded,
  saveMenuItem,
  stockLeft,
  totalLines,
} from "@/lib/domain";
import { ItemSheet } from "./menu-settings";
import { BusinessMark } from "./businesses";
import { blobToDataUrl, compressPhoto } from "@/lib/photo";
import { currencyDigits, isSimpleMode } from "@/lib/settings";
import { ReceiptSheet, receiptNumber } from "./receipt";
import {
  buzz,
  DoneCheck,
  errorText,
  usePin,
  formatMoney,
  haptic,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
  Tip,
} from "./ui";

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
    <div className="stepper" role="group" aria-label={name + " quantity"}>
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
    <div className="card card-list">
      {lines.map((line, index) => (
        <div
          className="order-line"
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
          <div className="card card-list">
            {group.options.map((option) => {
              const out = soldOut.includes(option.id);
              const on = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className="list-row sell-option"
                  role={group.required ? "radio" : "checkbox"}
                  aria-checked={on}
                  disabled={out || busy}
                  onClick={() =>
                    setSelected((prev) =>
                      group.required
                        ? [
                            ...prev.filter(
                              (id) => !group.options.some((o) => o.id === id),
                            ),
                            option.id,
                          ]
                        : prev.includes(option.id)
                          ? prev.filter((id) => id !== option.id)
                          : [...prev, option.id],
                    )
                  }
                >
                  {on ? (
                    <span className="badge" style={{ width: 26, height: 26, padding: 0 }}>
                      <Check size={15} />
                    </span>
                  ) : (
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        boxShadow: "inset 0 0 0 1.5px var(--line-strong)",
                        flex: "none",
                      }}
                    />
                  )}
                  <span className={"grow" + (out ? " g" : "")}>
                    {option.name}
                  </span>
                  <span className="label end">
                    {out
                      ? "Sold out"
                      : option.price
                        ? "+" + formatMoney(option.price, currency)
                        : ""}
                  </span>
                </button>
              );
            })}
          </div>
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
        <span className="label">{error || (value ? "Tap the photo to retake it." : hint)}</span>
      </span>
      {value && (
        <button type="button" className="round flat" aria-label={"Remove " + label} onClick={() => onChange(undefined)}>
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
  onQuantity,
  onClear,
  onPay,
  onClose,
  onReceipt,
}: {
  state: RegisterState;
  lines: ReceiptLine[];
  busy: boolean;
  onQuantity: (index: number, value: number) => void;
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
  /** Cash received, once a payment is picked. The sale is saved only after Confirm. */
  const [review, setReview] = useState<number | null>(null);
  const chosen = methods.find((m) => m.id === method);
  const order = lines.length ? priceOrder(shift, lines, discountId) : null;
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

  let typed: number | undefined;
  if (cash.trim()) {
    try {
      typed = parseMoney(cash, currency);
    } catch {
      /* still typing */
    }
  }

  function ask(received: number) {
    if (!chosen || busy) return;
    if (missing) {
      setError(missingText);
      buzz.error();
      return;
    }
    setError("");
    buzz.tap();
    setReview(received);
  }

  async function pay(received: number) {
    if (!chosen || busy) return;
    setError("");
    try {
      const sale = await onPay(chosen.id, received, discountId, proofs);
      if (sale) {
        buzz.success();
        setDone({ sale, shiftNumber: shift.number });
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (done) {
    const { sale } = done;
    const showChange = sale.payment.kind === "cash" && sale.change > 0;
    return (
      <Sheet
        title="Sale complete"
        onClose={onClose}
        footer={
          <>
            <button className="btn block" onClick={onClose}>
              New sale
            </button>
            <button
              className="btn ghost block compact"
              onClick={() => onReceipt(sale)}
            >
              View receipt {receiptNumber(done.shiftNumber, sale.sequence)}
            </button>
          </>
        }
      >
        <div
          className="stack gap-12"
          style={{ alignItems: "center", textAlign: "center", padding: "12px 0 8px" }}
        >
          <DoneCheck />
          {showChange ? (
            <>
              <p className="label">Change to give</p>
              <Money
                value={sale.change}
                currency={currency}
                className="due-num"
              />
              <p className="muted">
                From {formatMoney(sale.received, currency)} cash for a{" "}
                {formatMoney(sale.total, currency)} order
              </p>
            </>
          ) : (
            <>
              <p className="label">Paid with {sale.payment.name}</p>
              <Money value={sale.total} currency={currency} className="due-num" />
              {sale.payment.kind === "cash" && (
                <p className="muted">Exact cash, no change</p>
              )}
            </>
          )}
        </div>
      </Sheet>
    );
  }

  if (review !== null && chosen) {
    const isCash = chosen.kind === "cash";
    const change = review - total;
    return (
      <Sheet
        title="Confirm sale"
        onClose={onClose}
        busy={busy}
        footer={
          <>
            <button className="btn block" disabled={busy || !lines.length} onClick={() => void pay(review)}>
              {busy ? "Saving…" : "Confirm sale"}
            </button>
            <button
              className="btn ghost block compact"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError("");
              }}
            >
              Back
            </button>
          </>
        }
      >
        <div className="confirm-sale">
          <div className="stack gap-8 confirm-main">
            <p className="label">
              {!isCash ? "Paid with " + chosen.name : change > 0 ? "Change to give" : "Exact cash, no change"}
            </p>
            <Money value={isCash && change > 0 ? change : total} currency={currency} className="due-num" />
          </div>
          <div className="card card-list">
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
          {!isCash && (
            <p className="label">
              Check that {formatMoney(total, currency)} arrived in {chosen.name} first.
            </p>
          )}
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  }

  const quick = quickCash(total, currency);
  const exactText = amountText(total, currency);
  return (
    <Sheet
      title="Charge"
      onClose={onClose}
      busy={busy}
      action={
        <button className="btn ghost small" disabled={busy} onClick={onClear}>
          Clear order
        </button>
      }
      footer={
        chosen && chosen.kind !== "cash" ? (
          <button
            className="btn block"
            disabled={busy || !lines.length || missing}
            onClick={() => ask(total)}
          >
            {busy ? "Saving…" : missing ? "Take the photo first ·" : `${chosen.name} received ·`}
            {!busy && <Money value={total} currency={currency} />}
          </button>
        ) : typed !== undefined && cash !== exactText ? (
          <button
            className="btn block"
            disabled={busy || typed < total || missing}
            onClick={() => ask(typed!)}
          >
            {typed < total ? (
              <>
                Short by <Money value={total - typed} currency={currency} />
              </>
            ) : (
              <>
                Next · change{" "}
                <Money value={typed - total} currency={currency} />
              </>
            )}
          </button>
        ) : undefined
      }
    >
      <div className="desk-hide">
        <OrderLines
          lines={lines}
          currency={currency}
          busy={busy}
          onQuantity={onQuantity}
        />
      </div>
      {discounts.length > 0 && (
        <div className="chips" role="group" aria-label="Discount">
          <button
            type="button"
            aria-pressed={!discountId}
            onClick={() => setDiscountId(undefined)}
          >
            No discount
          </button>
          {discounts.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={discountId === d.id}
              onClick={() => setDiscountId(d.id)}
            >
              {d.name} ·{" "}
              {d.type === "percent"
                ? d.value + "%"
                : formatMoney(d.value, currency)}
            </button>
          ))}
        </div>
      )}
      <div className="due">
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
      <div
        className={"methods" + (methods.length % 3 === 0 ? " three" : "")}
        role="group"
        aria-label="Payment method"
      >
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            className="method"
            aria-pressed={method === m.id}
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
          <div className="quick">
            <button
              type="button"
              disabled={busy || !total || missing}
              onClick={() => ask(total)}
            >
              Exact
            </button>
            {quick.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={busy || missing}
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
      {chosen && chosen.kind !== "cash" && (
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
  onMenu: (menu: Product[], pin: string, stock?: Record<string, number>) => Promise<void>;
  onSaved: (text: string) => void;
  onBusinesses: () => void;
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
      <button type="button" className="shift-strip warn" onClick={onTill}>
        <CalendarDays size={16} strokeWidth={1.9} />
        <span className="grow ellipsis">{onTillPage ? "Not on a shift yet. Tap to add it." : "Not on a shift yet. Add it on the Till."}</span>
        <ChevronRight size={16} className="chev" />
      </button>
    );
  const people = booking.staff.map((s) => s.name.split(" ")[0]).join(", ");
  return (
    <button type="button" className="shift-strip" onClick={onTill} aria-label={`Selling for ${bookingTitle(booking)}. ${onTillPage ? "Open the shift." : "Open the Till."}`}>
      <CalendarDays size={16} strokeWidth={1.9} />
      <span className="grow ellipsis">
        <span className="strong">{bookingTitle(booking)}</span>
        <span className="g">
          {" · "}until {time.format(new Date(booking.endsAt))}
          {people ? " · " + people : ""}
        </span>
      </span>
      <ChevronRight size={16} className="chev" />
    </button>
  );
}

export function SellScreen({
  state,
  status,
  online,
  pending,
  onCart,
  onCheckout,
  onAvailability,
  onReverse,
  onMenu,
  onSaved,
  onBusinesses,
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
  /** The sale just went through: keep the sheet up for its change and receipt though the cart is empty. */
  const [paid, setPaid] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const shift = state.shift!;
  const business = state.business!;
  const simple = isSimpleMode(business.settings);
  const canEdit = !state.me || state.me.owner;
  const currency = shift.settings.currency;
  const menu = shift.menu;
  const categories = useMemo(
    () => Array.from(new Set(menu.map((i) => i.category).filter(Boolean))),
    [menu],
  );
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
  const count = state.cart.reduce((s, l) => s + l.quantity, 0);
  const inCart = (id: string) =>
    state.cart
      .filter((l) => l.productId === id)
      .reduce((s, l) => s + l.quantity, 0);
  const blocked = state.cart.some((l) =>
    [l.productId, ...l.optionIds].some((id) => state.soldOut.includes(id)),
  );
  const q = query.trim().toLocaleLowerCase();
  const items = menu.filter(
    (i) =>
      (!category || i.category === category) &&
      (!q || (i.name + " " + i.category).toLocaleLowerCase().includes(q)),
  );
  const shiftSales = state.sales.filter(
    (s) => s.shiftId === shift.id && !s.reversedAt,
  );

  async function write(op: () => Promise<void>) {
    if (lock.current || pending) return false;
    lock.current = true;
    setWorking(true);
    setError("");
    try {
      await op();
      return true;
    } catch (e) {
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
    haptic();
    return write(() => onCart(cart));
  }
  function setQuantity(index: number, value: number) {
    const next =
      value === 0
        ? state.cart.filter((_, i) => i !== index)
        : state.cart.map((l, i) => (i === index ? { ...l, quantity: value } : l));
    void write(() => onCart(next));
    if (!next.length) setCharging(false);
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

  const orderSummary = (
    <>
      <div className="between">
        <h2 className="section">Order</h2>
        {count > 0 && (
          <button
            className="btn ghost small"
            disabled={busy}
            onClick={() => void write(() => onCart([]))}
          >
            Clear
          </button>
        )}
      </div>
      <div className="order-scroll">
        {cartMenuError ? (
          <p className="notice" role="alert">The menu changed. Clear the order and add its items again.</p>
        ) : lines.length ? (
          <OrderLines
            lines={lines}
            currency={currency}
            busy={busy}
            onQuantity={setQuantity}
          />
        ) : (
          <p className="label" style={{ padding: "24px 0", textAlign: "center" }}>
            Tap an item to start an order.
          </p>
        )}
      </div>
      <button
        className="btn block"
        disabled={!count || busy || blocked || cartMenuError}
        onClick={() => { setPaid(false); setCharging(true); }}
      >
        Charge {count > 0 && !cartMenuError && <Money value={total} currency={currency} />}
      </button>
    </>
  );

  return (
    <>
      <div className="sell-head">
        <div className="page-top">
          <button type="button" className="grow sell-brand" onClick={onBusinesses} aria-label={"Switch business, now " + business.name}>
            <BusinessMark name={business.name} logo={business.settings.logo} brand={business.settings.brand} size={38} />
            <span className="grow stack" style={{ minWidth: 0 }}>
            <span className="sell-title ellipsis row gap-4">
              <span className="ellipsis">{business.name}</span>
              <ChevronDown size={16} className="chev-down" />
            </span>
            <span className="label row gap-6">
              {status !== "Online" && (
                <span className={"dot" + (online ? "" : " danger")} />
              )}
              <span className="ellipsis">
                Shift {shift.number} ·{" "}
                {shiftSales.length === 1 ? "1 sale" : shiftSales.length + " sales"}
                {status !== "Online" ? " · " + status : ""}
              </span>
            </span>
            </span>
          </button>
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
          <button
            className="round"
            aria-label="Mark items sold out"
            aria-pressed={marking}
            onClick={() => setMarking(!marking)}
          >
            <Ban size={19} />
          </button>
        </div>
        {!simple && <ShiftStrip state={state} onTill={onTill} />}
        {menu.length > 0 && !marking && (
          <Tip id="sold-out" title="Something ran out?">
            Tap <Ban size={13} strokeWidth={2.2} className="inline-icon" aria-label="Mark sold out" /> at the top, then the item. It shows Sold out until you tap it again.
          </Tip>
        )}
        {marking && (
          <div className="mode-bar" role="status">
            <span className="grow">Tap what ran out. Tap again to bring it back.</span>
            <button className="btn small" onClick={() => setMarking(false)}>
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
        {categories.length > 1 && (
          <div className="chips" role="group" aria-label="Categories">
            <button
              type="button"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <p className="notice alert" role="alert">
          {error}
        </p>
      )}
      {blocked && (
        <p className="notice" role="alert">
          <span className="dot danger" />
          Something in this order just sold out. Remove it to charge.
        </p>
      )}
      <div className="sell-layout">
        {items.length ? (
          <div className="items">
            {items.map((product) => {
              const out = isOut(product);
              const qty = inCart(product.id);
              return (
                <button
                  key={product.id}
                  className={"item" + (out ? " out" : "")}
                  aria-label={
                    (marking
                      ? out
                        ? "Mark available: "
                        : "Mark sold out: "
                      : "Add ") +
                    product.name +
                    ", " +
                    formatMoney(product.price, currency)
                  }
                  disabled={busy || (!marking && out)}
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
                  {!out && canMake(model, afterCart, product.id) !== undefined && (
                    <span className={"stock-tag" + (canMake(model, afterCart, product.id)! <= 3 ? " low" : "")}>
                      {Math.max(0, canMake(model, afterCart, product.id)!)} left
                    </span>
                  )}
                  {qty > 0 && !marking && <span className="badge qty">{qty}</span>}
                </button>
              );
            })}
            {canEdit && !marking && !q && !category && (
              <button
                className="item add-tile"
                disabled={!online}
                onClick={() => setAdding(true)}
                aria-label="Add an item to the menu"
              >
                <span className="add-plus" aria-hidden="true">
                  <Plus size={22} />
                </span>
                <span className="name">Add item</span>
                <span className="price">{online ? "Sells from now" : "Connect to add"}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="empty card">
            <span className="well">
              <Search size={22} />
            </span>
            <p className="strong">
              {menu.length ? "Nothing matches" : "No items on this shift"}
            </p>
            <p className="label">
              {menu.length
                ? "Try another name or category."
                : canEdit
                  ? "Add your first item. It goes on sale right away."
                  : "Ask the owner to add items."}
            </p>
            {canEdit && !menu.length && (
              <button className="btn" disabled={!online} onClick={() => setAdding(true)}>
                <Plus size={18} /> Add item
              </button>
            )}
          </div>
        )}
        <aside className="order-panel card" aria-label="Current order">
          {orderSummary}
        </aside>
      </div>
      {count > 0 && !marking && (
        <button
          className="charge-bar"
          disabled={busy && !charging}
          onClick={() => { setPaid(false); setCharging(true); }}
          aria-label={`Charge ${formatMoney(total, currency)} for ${count} items`}
        >
          <span className="badge">{count}</span>
          <span className="grow" style={{ textAlign: "left" }}>
            Charge
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
      {charging && (paid || (!cartMenuError && count > 0)) && (
        <Checkout
          key={shift.menuVersion ?? "opening"}
          state={state}
          lines={lines}
          busy={busy}
          onQuantity={setQuantity}
          onClear={() => {
            void write(() => onCart([]));
            setCharging(false);
          }}
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
            setQuery("");
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
          liveShift
          stockItems={shift.settings.stockItems}
          costItems={business.settings.stockItems}
          onClose={() => setAdding(false)}
          onSave={async (item, count) => {
            const done = await withPin((pin) =>
              onMenu(saveMenuItem(state.menu, item), pin, count !== undefined ? { [item.id]: count } : undefined),
            );
            if (done) onSaved("Added " + item.name);
            return done;
          }}
        />
      )}
      {receipt && (
        <ReceiptSheet
          sale={state.sales.find((s) => s.id === receipt.id) ?? receipt}
          shift={shift}
          business={business}
          pending={state.pending.some((e) => e.id === receipt.id)}
          canReverse={false}
          onReverse={(reason, pin) => onReverse(receipt.id, reason, pin)}
          onClose={() => setReceipt(null)}
        />
      )}
    </>
  );
}
