"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
  Check,
  CreditCard,
  Grid2X2,
  Minus,
  PackageOpen,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type {
  Business,
  CartLine,
  Product,
  ReceiptLine,
  RegisterState,
  Sale,
  Shift,
  Tender,
} from "@/lib/types";
import { money, parseMoney, priceLines, totalLines } from "@/lib/domain";
import "./register.css";

function RegisterDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      className="rg-dialog"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) {
          const bounds = ref.current.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <div className="rg-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="rg-icon"
          aria-label="Close"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Quantity({
  quantity,
  name,
  onChange,
  disabled,
  canRemove = false,
}: {
  quantity: number;
  name: string;
  onChange: (value: number) => void;
  disabled: boolean;
  canRemove?: boolean;
}) {
  return (
    <div className="rg-quantity" role="group" aria-label={name + " quantity"}>
      <button
        type="button"
        aria-label={
          quantity === 1 && canRemove ? "Remove " + name : "Decrease " + name
        }
        disabled={disabled || (quantity <= 1 && !canRemove)}
        onClick={() => onChange(quantity - 1)}
      >
        {quantity === 1 && canRemove ? (
          <Trash2 size={15} />
        ) : (
          <Minus size={16} />
        )}
      </button>
      <span>{quantity}</span>
      <button
        type="button"
        aria-label={"Increase " + name}
        disabled={disabled || quantity >= 999}
        onClick={() => onChange(quantity + 1)}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

const tenderNames: Record<Tender, string> = {
  cash: "Cash",
  qr: "QR payment",
  card: "Card",
};

export function receiptNumber(shiftNumber: number, sequence: number) {
  return "#" + shiftNumber + "-" + String(sequence).padStart(3, "0");
}

export function Receipt({
  sale,
  shift,
  business,
  onDone,
  actionLabel = "Done",
  savedLocally = false,
}: {
  sale: Sale;
  shift: Shift;
  business: Business;
  onDone: () => void;
  actionLabel?: string;
  savedLocally?: boolean;
}) {
  const fmt = (value: number) => money(value, business.currency);
  const created = new Intl.DateTimeFormat(undefined, {
    timeZone: business.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(sale.createdAt));
  return (
    <RegisterDialog title="Sale receipt" onClose={onDone}>
      <div className="rg-dialog-body rg-stack">
        <div className="rg-receipt-id">
          <ReceiptText size={26} aria-hidden="true" />
          <strong className="rg-receipt-number">
            {receiptNumber(shift.number, sale.sequence)}
          </strong>
          <span>{business.name}</span>
          <small>{created}</small>
          {savedLocally && (
            <p className="rg-note" role="status">
              Saved on this device · Pending sync
            </p>
          )}
        </div>
        {sale.reversedAt && (
          <p className="rg-error">Reversed · {sale.reason}</p>
        )}
        <ul className="rg-receipt-lines">
          {sale.lines.map((line, index) => (
            <li key={index}>
              <div className="rg-row">
                <strong>
                  {line.quantity} × {line.name}
                </strong>
                <span>{fmt(line.unitPrice * line.quantity)}</span>
              </div>
              {line.options.length > 0 && (
                <p className="rg-note">{line.options.join(", ")}</p>
              )}
            </li>
          ))}
        </ul>
        <div className="rg-total">
          <span>Total paid</span>
          <strong>{fmt(sale.total)}</strong>
        </div>
        <dl className="rg-receipt-facts">
          <div>
            <dt>Payment</dt>
            <dd>{tenderNames[sale.tender]}</dd>
          </div>
          {sale.tender === "cash" && (
            <>
              <div>
                <dt>Cash received</dt>
                <dd>{fmt(sale.received)}</dd>
              </div>
              <div>
                <dt>Change</dt>
                <dd>{fmt(sale.change)}</dd>
              </div>
            </>
          )}
        </dl>
        <button className="rg-primary" onClick={onDone}>
          {actionLabel} <Check size={17} />
        </button>
      </div>
    </RegisterDialog>
  );
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The register could not save this change. Please try again.";
}

function ItemOptions({
  product,
  currency,
  soldOut,
  busy,
  add,
  close,
}: {
  product: Product;
  currency: string;
  soldOut: string[];
  busy: boolean;
  add: (options: string[], quantity: number) => Promise<boolean>;
  close: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const options = product.groups.flatMap((group) => group.options);
  const price =
    product.price +
    options.reduce(
      (sum, option) => sum + (selected.includes(option.id) ? option.price : 0),
      0,
    );
  const complete = product.groups.every(
    (group) =>
      !group.required ||
      group.options.some((option) => selected.includes(option.id)),
  );
  const [error, setError] = useState("");
  return (
    <RegisterDialog title={product.name} busy={busy} onClose={close}>
      <div className="rg-dialog-body rg-stack">
        {product.groups.map((group) => (
          <fieldset className="rg-group" key={group.id}>
            <legend>
              {group.name}{" "}
              <small>{group.required ? "Choose one" : "Optional"}</small>
            </legend>
            {group.options.map((option) => (
              <label className="rg-choice" key={option.id}>
                <input
                  type={group.required ? "radio" : "checkbox"}
                  name={group.id}
                  checked={selected.includes(option.id)}
                  disabled={busy || soldOut.includes(option.id)}
                  onChange={() =>
                    setSelected((previous) => {
                      if (group.required)
                        return [
                          ...previous.filter(
                            (id) => !group.options.some((o) => o.id === id),
                          ),
                          option.id,
                        ];
                      return previous.includes(option.id)
                        ? previous.filter((id) => id !== option.id)
                        : [...previous, option.id];
                    })
                  }
                />
                {option.name}
                <span>
                  {soldOut.includes(option.id)
                    ? "Sold out"
                    : option.price > 0
                      ? "+" + money(option.price, currency)
                      : ""}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="rg-row">
          <strong>Quantity</strong>
          <Quantity
            quantity={quantity}
            name={product.name}
            onChange={setQuantity}
            disabled={busy}
          />
        </div>
        {error && (
          <p className="rg-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="rg-primary"
          disabled={
            !complete || busy || selected.some((id) => soldOut.includes(id))
          }
          onClick={async () => {
            if (await add(selected, quantity)) close();
            else
              setError(
                "The item could not be added. Check the order and try again.",
              );
          }}
        >
          Add to order · {money(price * quantity, currency)}
        </button>
      </div>
    </RegisterDialog>
  );
}

function Availability({
  product,
  soldOut,
  busy,
  update,
  close,
}: {
  product: Product;
  soldOut: string[];
  busy: boolean;
  close: () => void;
  update: (id: string, soldOut: boolean) => Promise<boolean>;
}) {
  const [error, setError] = useState("");
  function row(id: string, name: string) {
    const out = soldOut.includes(id);
    return (
      <div className="rg-availability-row" key={id}>
        <span>{name}</span>
        <button
          disabled={busy}
          type="button"
          role="switch"
          aria-label={name + " available"}
          aria-checked={!out}
          onClick={async () => {
            setError("");
            if (!(await update(id, !out)))
              setError("Could not save availability. Try again.");
          }}
        >
          <i />
          <span>{out ? "Sold out" : "Available"}</span>
        </button>
      </div>
    );
  }
  return (
    <RegisterDialog title="Item availability" onClose={close} busy={busy}>
      <div className="rg-dialog-body rg-stack">
        {row(product.id, product.name)}
        {product.groups.map((group) => (
          <div key={group.id}>
            <h3>{group.name}</h3>
            {group.options.map((option) => row(option.id, option.name))}
          </div>
        ))}
        {error && (
          <p className="rg-error" role="alert">
            {error}
          </p>
        )}
        <button className="rg-primary" disabled={busy} onClick={close}>
          Done
        </button>
      </div>
    </RegisterDialog>
  );
}

function Payment({
  total,
  currency,
  busy,
  onPay,
  close,
}: {
  total: number;
  currency: string;
  busy: boolean;
  close: () => void;
  onPay: (tender: Tender, received: number) => Promise<void>;
}) {
  const [tender, setTender] = useState<Tender>("cash");
  const [cash, setCash] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  let received: number | undefined;
  if (cash.trim()) {
    try {
      received = parseMoney(cash, currency);
    } catch {
      /* Keep the field editable while typing. */
    }
  }
  const canPay =
    tender === "cash" ? received !== undefined && received >= total : confirmed;
  return (
    <RegisterDialog title="Take payment" onClose={close} busy={busy}>
      <form
        className="rg-dialog-body rg-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !canPay) return;
          setError("");
          try {
            await onPay(tender, tender === "cash" ? received! : total);
          } catch (e) {
            setError(errorText(e));
          }
        }}
      >
        <div className="rg-due">
          <span>Amount due</span>
          <strong>{money(total, currency)}</strong>
        </div>
        <div className="rg-tenders" role="group" aria-label="Payment method">
          {(["cash", "qr", "card"] as const).map((method) => {
            const Icon =
              method === "cash"
                ? Banknote
                : method === "qr"
                  ? QrCode
                  : CreditCard;
            return (
              <button
                type="button"
                key={method}
                aria-pressed={tender === method}
                disabled={busy}
                onClick={() => {
                  setTender(method);
                  setConfirmed(false);
                  setError("");
                }}
              >
                <Icon size={20} />
                {tenderNames[method]}
              </button>
            );
          })}
        </div>
        {tender === "cash" ? (
          <>
            <label className="rg-field">
              <span>Cash received</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={cash}
                placeholder="0"
                disabled={busy}
                onChange={(event) => setCash(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rg-secondary"
              disabled={busy}
              onClick={() => {
                const digits =
                  new Intl.NumberFormat("en", {
                    style: "currency",
                    currency,
                  }).resolvedOptions().maximumFractionDigits ?? 2;
                setCash((total / 10 ** digits).toFixed(digits));
              }}
            >
              Exact cash · {money(total, currency)}
            </button>
            {received !== undefined && (
              <div className="rg-row">
                <span>{received >= total ? "Change due" : "Still due"}</span>
                <strong>{money(Math.abs(received - total), currency)}</strong>
              </div>
            )}
          </>
        ) : (
          <label className="rg-choice rg-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {tender === "qr"
              ? "I confirmed the payment in the wallet."
              : "The card terminal approved this payment."}
          </label>
        )}
        {error && (
          <p className="rg-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="rg-primary" disabled={busy || !canPay}>
          {busy ? "Saving…" : "Complete sale"}
          <Check size={18} />
        </button>
      </form>
    </RegisterDialog>
  );
}

export interface RegisterScreenProps {
  state: RegisterState;
  onCart: (cart: CartLine[]) => Promise<void>;
  onCheckout: (tender: Tender, received: number) => Promise<Sale>;
  onAvailability: (targetId: string, soldOut: boolean) => Promise<void>;
  pending: boolean;
}

export function RegisterScreen({
  state,
  onCart,
  onCheckout,
  onAvailability,
  pending,
}: RegisterScreenProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [editingAvailability, setEditingAvailability] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [modal, setModal] = useState<"cart" | "payment" | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const reviewedCart = useRef<CartLine[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const shift = state.shift;
  const business = state.business;
  if (!shift || !business) return null;
  const { currency } = business;
  const menu = shift.menu;
  const categories = Array.from(
    new Set(menu.map((item) => item.category).filter(Boolean)),
  );
  const items = menu.filter(
    (item) =>
      (!category || item.category === category) &&
      (item.name + " " + item.category)
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const busy = working || pending;
  const count = state.cart.reduce((sum, line) => sum + line.quantity, 0);
  const lines: ReceiptLine[] = state.cart.length
    ? priceLines(menu, state.cart)
    : [];
  const total = totalLines(lines);
  const blocked = state.cart.some((line) =>
    [line.productId, ...line.optionIds].some((id) =>
      state.soldOut.includes(id),
    ),
  );
  const amount = money(total, currency);
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
    const equivalent = state.cart.findIndex(
      (line) =>
        line.productId === product.id &&
        line.optionIds.length === choices.length &&
        choices.every((id) => line.optionIds.includes(id)),
    );
    const cart =
      equivalent < 0
        ? [
            ...state.cart,
            { productId: product.id, optionIds: choices, quantity },
          ]
        : state.cart.map((line, index) =>
            index === equivalent
              ? { ...line, quantity: line.quantity + quantity }
              : line,
          );
    return write(() => onCart(cart));
  }
  function changeQuantity(index: number, value: number) {
    const next =
      value === 0
        ? state.cart.filter((_, i) => i !== index)
        : state.cart.map((line, i) =>
            index === i ? { ...line, quantity: value } : line,
          );
    void write(() => onCart(next));
  }
  function cartContents() {
    return (
      <>
        {lines.length ? (
          <ul className="rg-cart-lines">
            {lines.map((line, index) => (
              <li key={line.productId + ":" + line.optionIds.join(",")}>
                <div className="rg-row">
                  <strong>{line.name}</strong>
                  <span>{money(line.unitPrice * line.quantity, currency)}</span>
                </div>
                {line.options.length > 0 && (
                  <p className="rg-note">{line.options.join(", ")}</p>
                )}
                <div className="rg-controls">
                  <Quantity
                    name={line.name}
                    quantity={line.quantity}
                    disabled={busy}
                    canRemove
                    onChange={(value) => changeQuantity(index, value)}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rg-empty rg-empty-order">
            <div className="rg-empty-icon">
              <ShoppingBag size={26} strokeWidth={1.6} />
            </div>
            <strong>Your order is empty</strong>
            <p>Tap a menu item to add it here.</p>
          </div>
        )}
        {blocked && (
          <p className="rg-error">
            Remove sold-out items or update their availability to continue.
          </p>
        )}
        <div className="rg-cart-foot">
          <div className="rg-total">
            <span>Total</span>
            <strong>{amount}</strong>
          </div>
          <button
            className="rg-primary"
            disabled={busy || !count || blocked}
            onClick={() => {
              setError("");
              reviewedCart.current = state.cart;
              setModal("payment");
            }}
          >
            Checkout <ArrowRight size={17} />
          </button>
        </div>
      </>
    );
  }
  return (
    <section className="rg" aria-label="Register">
      <div className="rg-catalog">
        <header className="rg-heading">
          <div>
            <h1>Register</h1>
            <p>Choose items to start an order.</p>
          </div>
          <button
            type="button"
            className="rg-filter"
            aria-pressed={editingAvailability}
            onClick={() => setEditingAvailability(!editingAvailability)}
          >
            {editingAvailability ? (
              <Check size={17} />
            ) : (
              <SlidersHorizontal size={17} />
            )}
            {editingAvailability ? "Done" : "Availability"}
          </button>
        </header>
        <label className="rg-search">
          <Search size={18} />
          <input
            type="search"
            aria-label="Search menu"
            placeholder="Search menu…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div
          className="rg-categories"
          role="group"
          aria-label="Menu categories"
        >
          <button
            type="button"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            <Grid2X2 size={15} /> All items
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        {editingAvailability && (
          <p className="rg-hint">Select an item to change its availability.</p>
        )}
        {error && (
          <p className="rg-error" role="alert">
            {error}
          </p>
        )}
        {items.length ? (
          <div className="rg-items">
            {items.map((product) => {
              const soldOut =
                state.soldOut.includes(product.id) ||
                product.groups.some(
                  (group) =>
                    group.required &&
                    group.options.every((option) =>
                      state.soldOut.includes(option.id),
                    ),
                );
              return (
                <button
                  className={
                    "rg-item" + (product.image ? " rg-item-photo" : "")
                  }
                  key={product.id}
                  aria-label={
                    (editingAvailability ? "Manage " : "Add ") + product.name
                  }
                  disabled={busy || (!editingAvailability && soldOut)}
                  onClick={() =>
                    editingAvailability || product.groups.length
                      ? setSelected(product)
                      : void add(product, [])
                  }
                >
                  {product.image && (
                    <img
                      className="rg-product-image"
                      src={product.image}
                      alt=""
                      draggable={false}
                    />
                  )}
                  <span className="rg-item-info">
                    <strong>{product.name}</strong>
                    <span className="rg-item-meta">
                      <span>{money(product.price, currency)}</span>
                      {soldOut ? (
                        <span className="rg-out">Sold out</span>
                      ) : (
                        <span className="rg-item-add">
                          {editingAvailability ? (
                            <SlidersHorizontal size={14} />
                          ) : (
                            <Plus size={16} />
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rg-empty">
            <PackageOpen size={30} strokeWidth={1.5} />
            <strong>
              {menu.length ? "No matching items" : "Your menu is empty"}
            </strong>
            <p>
              {menu.length
                ? "Try another search or category."
                : "Add items in Menu for your next shift."}
            </p>
            {menu.length > 0 && (
              <button
                className="rg-secondary"
                onClick={() => {
                  setCategory(null);
                  setSearch("");
                }}
              >
                Show all items
              </button>
            )}
          </div>
        )}
      </div>
      <aside className="rg-aside" aria-label="Current order">
        <header className="rg-aside-head">
          <h2>Current order</h2>
          <ShoppingBag size={19} aria-hidden="true" />
        </header>
        {cartContents()}
      </aside>
      <button
        className="rg-mobile-cart"
        type="button"
        onClick={() => setModal("cart")}
        aria-label={"View order, " + count + " items, " + amount}
      >
        <span>
          <ShoppingBag size={19} />
          View order ({count})
        </span>
        <span>
          {amount}
          <ArrowRight size={17} />
        </span>
      </button>
      {selected &&
        (editingAvailability ? (
          <Availability
            product={selected}
            soldOut={state.soldOut}
            busy={busy}
            update={(id, out) => write(() => onAvailability(id, out))}
            close={() => setSelected(null)}
          />
        ) : (
          <ItemOptions
            product={selected}
            currency={currency}
            soldOut={state.soldOut}
            busy={busy}
            add={(ids, qty) => add(selected, ids, qty)}
            close={() => setSelected(null)}
          />
        ))}
      {modal === "cart" && (
        <RegisterDialog
          title="Current order"
          busy={busy}
          onClose={() => setModal(null)}
        >
          {error && (
            <p role="alert" className="rg-error">
              {error}
            </p>
          )}
          {cartContents()}
        </RegisterDialog>
      )}
      {modal === "payment" && (
        <Payment
          total={total}
          currency={currency}
          busy={busy}
          close={() => setModal(null)}
          onPay={async (method, received) => {
            if (lock.current || pending) return;
            if (
              JSON.stringify(reviewedCart.current) !==
              JSON.stringify(state.cart)
            ) {
              setError("This order changed. Review it before taking payment.");
              setModal("cart");
              return;
            }
            lock.current = true;
            setWorking(true);
            try {
              const saved = await onCheckout(method, received);
              setModal(null);
              setReceipt(saved);
            } finally {
              lock.current = false;
              setWorking(false);
            }
          }}
        />
      )}
      {receipt && (
        <Receipt
          sale={receipt}
          shift={shift}
          business={business}
          actionLabel="Next sale"
          savedLocally={state.pending.some((event) => event.id === receipt.id)}
          onDone={() => {
            setReceipt(null);
            setSearch("");
          }}
        />
      )}
    </section>
  );
}
