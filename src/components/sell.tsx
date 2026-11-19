"use client";

import { useMemo, useRef, useState } from "react";
import { Ban, Check, Minus, Plus, Search, Trash2, X } from "lucide-react";
import type {
  CartLine,
  Product,
  ReceiptLine,
  RegisterState,
  Sale,
  Tender,
} from "@/lib/types";
import {
  amountText,
  parseMoney,
  priceLines,
  priceOrder,
  stockLeft,
  totalLines,
} from "@/lib/domain";
import { ItemSheet } from "./settings";
import { currencyDigits } from "@/lib/settings";
import { ReceiptSheet, receiptNumber } from "./receipt";
import {
  DoneCheck,
  errorText,
  usePin,
  formatMoney,
  haptic,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
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
                  className="list-row"
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
  onPay: (tender: Tender, received: number, discountId?: string) => Promise<Sale | null>;
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
  const chosen = methods.find((m) => m.id === method);
  const order = lines.length ? priceOrder(shift, lines, discountId) : null;
  const total = order?.total ?? 0;

  let typed: number | undefined;
  if (cash.trim()) {
    try {
      typed = parseMoney(cash, currency);
    } catch {
      /* still typing */
    }
  }

  async function pay(received: number) {
    if (!chosen || busy) return;
    setError("");
    try {
      const sale = await onPay(chosen.id, received, discountId);
      if (sale) {
        haptic(18);
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
            <button className="btn block" autoFocus onClick={onClose}>
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
            disabled={busy || !lines.length}
            onClick={() => void pay(total)}
          >
            {busy ? "Saving…" : `${chosen.name} received ·`}
            {!busy && <Money value={total} currency={currency} />}
          </button>
        ) : typed !== undefined && cash !== exactText ? (
          <button
            className="btn block"
            disabled={busy || typed < total}
            onClick={() => void pay(typed!)}
          >
            {typed < total ? (
              <>
                Short by <Money value={total - typed} currency={currency} />
              </>
            ) : (
              <>
                Complete · change{" "}
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
      {chosen?.kind === "cash" && (
        <div className="stack gap-10">
          <p className="label">Cash received · tap to finish</p>
          <div className="quick">
            <button
              type="button"
              disabled={busy || !total}
              onClick={() => void pay(total)}
            >
              Exact
            </button>
            {quick.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={busy}
                onClick={() => void pay(amount)}
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
          Check that {formatMoney(total, currency)} arrived in {chosen.name}{" "}
          before you tap.
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
  ) => Promise<Sale>;
  onAvailability: (targetId: string, soldOut: boolean) => Promise<void>;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onMenu: (menu: Product[], pin: string, stock?: Record<string, number>) => Promise<void>;
  onSaved: (text: string) => void;
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
}: SellProps) {
  const [adding, setAdding] = useState(false);
  const withPin = usePin();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [picked, setPicked] = useState<Product | null>(null);
  const [charging, setCharging] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const shift = state.shift!;
  const business = state.business!;
  const canEdit = !state.me || state.me.owner;
  const currency = shift.settings.currency;
  const menu = shift.menu;
  const categories = useMemo(
    () => Array.from(new Set(menu.map((i) => i.category).filter(Boolean))),
    [menu],
  );
  const busy = working || pending;
  const lines: ReceiptLine[] = state.cart.length
    ? priceLines(menu, state.cart)
    : [];
  const total = totalLines(lines);
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
  const isOut = (p: Product) =>
    (p.id in left && left[p.id] <= 0) ||
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
        {lines.length ? (
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
        disabled={!count || busy || blocked}
        onClick={() => setCharging(true)}
      >
        Charge {count > 0 && <Money value={total} currency={currency} />}
      </button>
    </>
  );

  return (
    <>
      <div className="sell-head">
        <div className="page-top">
          <div className="grow">
            <h1 className="sell-title ellipsis">{business.name}</h1>
            <p className="label row gap-6">
              {status !== "Online" && (
                <span className={"dot" + (online ? "" : " danger")} />
              )}
              <span className="ellipsis">
                Shift {shift.number} ·{" "}
                {shiftSales.length === 1 ? "1 sale" : shiftSales.length + " sales"}
                {status !== "Online" ? " · " + status : ""}
              </span>
            </p>
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
          <button
            className="round"
            aria-label="Mark items sold out"
            aria-pressed={marking}
            onClick={() => setMarking(!marking)}
          >
            <Ban size={19} />
          </button>
        </div>
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
                  {!out && product.id in left && (
                    <span className={"stock-tag" + (left[product.id] - qty <= 3 ? " low" : "")}>
                      {Math.max(0, left[product.id] - qty)} left
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
          onClick={() => setCharging(true)}
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
      {charging && (
        <Checkout
          state={state}
          lines={lines}
          busy={busy}
          onQuantity={setQuantity}
          onClear={() => {
            void write(() => onCart([]));
            setCharging(false);
          }}
          onPay={async (tender, received, discountId) => {
            if (lock.current || pending) return null;
            lock.current = true;
            setWorking(true);
            try {
              return await onCheckout(tender, received, discountId);
            } finally {
              lock.current = false;
              setWorking(false);
            }
          }}
          onClose={() => {
            setCharging(false);
            setQuery("");
          }}
          onReceipt={(sale) => {
            setCharging(false);
            setReceipt(sale);
          }}
        />
      )}
      {adding && (
        <ItemSheet
          currency={currency}
          menu={state.menu}
          liveShift
          onClose={() => setAdding(false)}
          onSave={async (item, count) => {
            const done = await withPin((pin) =>
              onMenu([...state.menu, item], pin, count !== undefined ? { [item.id]: count } : undefined),
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
