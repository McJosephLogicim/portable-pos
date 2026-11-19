"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  Banknote,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  ClipboardList,
  Clock3,
  CreditCard,
  LockKeyhole,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  Search,
  SquareMenu,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import type {
  OptionGroup,
  Product,
  RegisterState,
  Shift,
  Tender,
} from "@/lib/types";
import { money, parseMoney, shiftTotals } from "@/lib/domain";
import { Receipt, receiptNumber } from "./register";
import "./operations.css";

type ScreenProps = {
  state: RegisterState;
  online: boolean;
  onMenu: (menu: Product[], pin: string) => Promise<void>;
  onOpen: (openingCash: number) => Promise<void>;
  onClose: (countedCash: number, pin: string) => Promise<void>;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onAvailability: (targetId: string, soldOut: boolean) => Promise<void>;
  onSell: () => void;
  onGoMenu: () => void;
};

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="op-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="op-dialog-heading">
        <h2 id={id}>{title}</h2>
        <button
          className="op-icon"
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function OwnerPin({
  value,
  onChange,
}: {
  value: string;
  onChange: (pin: string) => void;
}) {
  return (
    <label className="op-field">
      <span>
        <LockKeyhole size={14} />
        Owner PIN
      </span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        placeholder="Enter PIN"
      />
    </label>
  );
}

function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The change could not be saved. Please try again.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ErrorText({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="op-error">
      {message}
    </p>
  ) : null;
}

function timestamp(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

const tenders: { key: Tender; name: string; Icon: typeof Banknote }[] = [
  { key: "cash", name: "Cash", Icon: Banknote },
  { key: "qr", name: "QR wallet", Icon: QrCode },
  { key: "card", name: "External card", Icon: CreditCard },
];

type GroupDraft = Omit<OptionGroup, "options"> & {
  options: { id: string; name: string; price: string }[];
};

function amountText(minor: number, currency: string) {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return (minor / 10 ** digits).toFixed(digits);
}

function ProductEditor({
  product,
  currency,
  onSave,
  onClose,
  duringShift,
}: {
  product?: Product;
  currency: string;
  duringShift: boolean;
  onSave: (product: Product, pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState(product?.name || "");
  const [category, setCategory] = useState(product?.category || "");
  const [price, setPrice] = useState(
    product ? amountText(product.price, currency) : "",
  );
  const [pin, setPin] = useState("");
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    (product?.groups || []).map((group) => ({
      ...group,
      options: group.options.map((option) => ({
        ...option,
        price: amountText(option.price, currency),
      })),
    })),
  );
  function setGroup(
    groupId: string,
    update: (group: GroupDraft) => GroupDraft,
  ) {
    setGroups((current) =>
      current.map((group) => (group.id === groupId ? update(group) : group)),
    );
  }
  function addGroup(required: boolean) {
    setGroups((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        required,
        name: "",
        options: [{ id: crypto.randomUUID(), name: "", price: "0" }],
      },
    ]);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!name.trim()) throw new Error("Give the item a name.");
      const savedGroups = groups.map((group) => {
        if (
          !group.name.trim() ||
          group.options.length === 0 ||
          group.options.some((option) => !option.name.trim())
        ) {
          throw new Error(
            "Give each group a name and at least one named option.",
          );
        }
        return {
          ...group,
          name: group.name.trim(),
          options: group.options.map((option) => ({
            ...option,
            name: option.name.trim(),
            price: parseMoney(option.price, currency),
          })),
        };
      });
      await onSave(
        {
          ...product,
          id: product?.id ?? crypto.randomUUID(),
          name: name.trim(),
          category: category.trim(),
          price: parseMoney(price, currency),
          groups: savedGroups,
        },
        pin,
      );
      onClose();
    });
  };
  return (
    <Dialog
      title={product ? "Edit item" : "New menu item"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="op-form" onSubmit={submit}>
        <label className="op-field">
          Item name
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Iced latte"
          />
        </label>
        <div className="op-grid2">
          <label className="op-field">
            Selling price ({currency})
            <input
              required
              inputMode="decimal"
              value={price}
              placeholder="0"
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className="op-field">
            Category (optional)
            <input
              maxLength={60}
              value={category}
              placeholder="e.g. Drinks"
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
        </div>
        {groups.map((group, index) => (
          <div className="op-block" key={group.id}>
            <div className="op-detail">
              <h3>{group.required ? "Required choice" : "Optional add-ons"}</h3>
              <button
                type="button"
                className="op-icon"
                aria-label={`Remove group ${index + 1}`}
                onClick={() =>
                  setGroups((current) =>
                    current.filter((item) => item.id !== group.id),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            <label className="op-field">
              Group name
              <input
                required
                maxLength={60}
                placeholder={group.required ? "e.g. Size" : "e.g. Extras"}
                value={group.name}
                onChange={(e) =>
                  setGroup(group.id, (current) => ({
                    ...current,
                    name: e.target.value,
                  }))
                }
              />
            </label>
            {group.options.map((option, optionIndex) => (
              <div className="op-option-edit" key={option.id}>
                <label className="op-field">
                  Option {optionIndex + 1}
                  <input
                    required
                    maxLength={60}
                    value={option.name}
                    placeholder="Name"
                    onChange={(e) =>
                      setGroup(group.id, (current) => ({
                        ...current,
                        options: current.options.map((row) =>
                          row.id === option.id
                            ? { ...row, name: e.target.value }
                            : row,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="op-field">
                  Extra price
                  <input
                    required
                    inputMode="decimal"
                    value={option.price}
                    onChange={(e) =>
                      setGroup(group.id, (current) => ({
                        ...current,
                        options: current.options.map((row) =>
                          row.id === option.id
                            ? { ...row, price: e.target.value }
                            : row,
                        ),
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="op-icon"
                  aria-label={`Remove option ${optionIndex + 1}`}
                  onClick={() =>
                    setGroup(group.id, (current) => ({
                      ...current,
                      options: current.options.filter(
                        (row) => row.id !== option.id,
                      ),
                    }))
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="op-button"
              onClick={() =>
                setGroup(group.id, (current) => ({
                  ...current,
                  options: [
                    ...current.options,
                    { id: crypto.randomUUID(), name: "", price: "0" },
                  ],
                }))
              }
            >
              <Plus size={15} />
              Add option
            </button>
          </div>
        ))}
        <div className="op-inline op-wrap">
          <button
            type="button"
            className="op-button"
            onClick={() => addGroup(true)}
          >
            <Plus size={15} />
            Required choice
          </button>
          <button
            type="button"
            className="op-button"
            onClick={() => addGroup(false)}
          >
            <Plus size={15} />
            Add-ons
          </button>
        </div>
        {duringShift ? (
          <p className="op-muted">
            Menu edits take effect when you open the next shift.
          </p>
        ) : null}
        <OwnerPin value={pin} onChange={setPin} />
        <ErrorText message={error} />
        <button disabled={busy} className="op-button primary">
          {busy ? "Saving…" : "Save item"}
        </button>
      </form>
    </Dialog>
  );
}

function Availability({
  menu,
  soldOut,
  onAvailability,
  enabled,
}: {
  menu: Product[];
  soldOut: string[];
  onAvailability: ScreenProps["onAvailability"];
  enabled: boolean;
}) {
  const { busy, error, run } = useAction();
  function toggleChip(id: string, name: string, label = name) {
    const available = !soldOut.includes(id);
    const Icon = available ? CircleCheck : CircleMinus;
    return (
      <button
        key={id}
        className={`op-chip ${available ? "on" : ""}`}
        disabled={busy || !enabled}
        type="button"
        aria-label={`${label}, currently ${available ? "available" : "sold out"}. Mark ${available ? "sold out" : "available"}`}
        onClick={() => void run(() => onAvailability(id, available))}
      >
        <Icon size={15} />
        {name}
      </button>
    );
  }
  return (
    <div className="op-panel">
      <div className="op-panel-head">
        <div>
          <h2>Availability</h2>
          <p className="op-muted">
            Tap an item or option to change its availability this shift.
          </p>
        </div>
      </div>
      <ErrorText message={error} />
      {menu.map((item) => (
        <div key={item.id} className="op-item">
          <div className="op-detail">
            <strong>{item.name}</strong>
            {toggleChip(
              item.id,
              soldOut.includes(item.id) ? "Sold out" : "Available",
              item.name,
            )}
          </div>
          {item.groups.map((group) => (
            <div className="op-menu-availability" key={group.id}>
              <span className="op-muted">{group.name}</span>
              {group.options.map((option) =>
                toggleChip(
                  option.id,
                  option.name,
                  item.name + " " + option.name,
                ),
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function MenuScreen({
  state,
  onMenu,
  onAvailability,
  online,
}: ScreenProps) {
  const [editId, setEditId] = useState<string | null>(null);
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const [tab, setTab] = useState<"items" | "availability">("items");
  const [filter, setFilter] = useState("");
  const business = state.business;
  if (!business) return null;
  const menu = state.menu.filter((product) =>
    (product.name + " " + product.category)
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  return (
    <section className="op-screen" aria-label="Menu">
      <div className="op-title">
        <h1>Menu</h1>
        <button
          type="button"
          className="op-button primary"
          disabled={!online}
          onClick={() => setEditId("new")}
        >
          <Plus size={17} />
          Add item
        </button>
      </div>
      {shift ? (
        <div className="op-switcher" aria-label="Menu view">
          <button
            aria-pressed={tab === "items"}
            onClick={() => setTab("items")}
          >
            Menu items
          </button>
          <button
            aria-pressed={tab === "availability"}
            onClick={() => setTab("availability")}
          >
            Shift availability
          </button>
        </div>
      ) : null}
      {tab === "availability" && shift ? (
        <Availability
          menu={shift.menu}
          soldOut={state.soldOut}
          onAvailability={onAvailability}
          enabled={shift.deviceId === state.deviceId}
        />
      ) : (
        <>
          {state.menu.length > 0 ? (
            <label className="op-search">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search menu"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search menu"
              />
            </label>
          ) : null}
          <div className="op-panel">
            <div className="op-panel-head">
              <h2>Menu items</h2>
              <span className="op-muted">
                {state.menu.length} {state.menu.length === 1 ? "item" : "items"}
              </span>
            </div>
            {menu.length > 0 ? (
              menu.map((product) => (
                <div className="op-row" key={product.id}>
                  <div className="op-inline">
                    <span className="op-icon-badge">
                      <SquareMenu size={19} />
                    </span>
                    <div>
                      <strong>{product.name}</strong>
                      <p className="op-muted">
                        {product.category || "Uncategorized"}
                      </p>
                    </div>
                  </div>
                  <div className="op-inline">
                    <strong className="op-money">
                      {money(product.price, business.currency)}
                    </strong>
                    <button
                      className="op-icon"
                      type="button"
                      aria-label={`Edit ${product.name}`}
                      disabled={!online}
                      onClick={() => setEditId(product.id)}
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="op-empty">
                <SquareMenu size={29} />
                <h3>{filter ? "No matching items" : "Add your first item"}</h3>
                <p className="op-muted">
                  {filter
                    ? "Try another name or category."
                    : "An item name and selling price are all you need to get started."}
                </p>
              </div>
            )}
          </div>
          {!online ? (
            <p className="op-footnote">Reconnect to edit the menu.</p>
          ) : null}
        </>
      )}
      {editId !== null ? (
        <ProductEditor
          key={editId}
          product={state.menu.find((product) => product.id === editId)}
          currency={business.currency}
          duringShift={Boolean(shift)}
          onClose={() => setEditId(null)}
          onSave={(item, pin) =>
            onMenu(
              editId === "new"
                ? [...state.menu, item]
                : state.menu.map((product) =>
                    product.id === item.id ? item : product,
                  ),
              pin,
            )
          }
        />
      ) : null}
    </section>
  );
}

function EmptySales({
  onSell,
  active,
}: {
  onSell: () => void;
  active: boolean;
}) {
  return (
    <div className="op-empty">
      <ReceiptText size={30} />
      <h3>No sales yet</h3>
      <p className="op-muted">
        Completed sales and their receipts appear here.
      </p>
      {active ? (
        <button className="op-button" onClick={onSell}>
          Go to register
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

function ReverseForm({
  reference,
  method,
  onClose,
  onReverse,
}: {
  reference: string;
  method: Tender;
  onClose: () => void;
  onReverse: (reason: string, pin: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const { busy, run, error } = useAction();
  return (
    <Dialog
      title={`Reverse sale ${reference}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="op-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!reason.trim())
              throw new Error("Enter a reason for the reversal.");
            await onReverse(reason.trim(), pin);
            onClose();
          });
        }}
      >
        <p className="op-muted">
          {method === "cash"
            ? "Return the cash to the customer and record the full reversal here."
            : "Issue any refund through your wallet or terminal, then record the full reversal here."}
        </p>
        <label className="op-field">
          Reason
          <textarea
            required
            value={reason}
            maxLength={200}
            placeholder="e.g. Duplicate sale"
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <OwnerPin value={pin} onChange={setPin} />
        <ErrorText message={error} />
        <button className="op-button primary" disabled={busy}>
          {busy ? "Reversing…" : "Confirm full reversal"}
        </button>
      </form>
    </Dialog>
  );
}

export function SalesScreen({ state, online, onReverse, onSell }: ScreenProps) {
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { business, sales, shift } = state;
  if (!business) return null;
  const shifts = new Map(
    [...state.shifts, ...(shift ? [shift] : [])].map((record) => [
      record.id,
      record,
    ]),
  );
  const selectedSale = sales.find((sale) => sale.id === receiptId);
  const selectedShift = selectedSale ? shifts.get(selectedSale.shiftId) : null;
  const reversal = sales.find((sale) => sale.id === reverseId);
  const reversalShift = reversal ? shifts.get(reversal.shiftId) : null;
  const canReverse = Boolean(
    online &&
      shift &&
      !shift.closedAt &&
      shift.deviceId === state.deviceId &&
      state.pending.length === 0,
  );
  const pending = new Set(
    state.pending
      .filter((event) => event.type === "sale")
      .map((event) => event.sale.id),
  );
  const orderedSales = [...sales].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const search = filter.trim().toLowerCase();
  const rows = orderedSales.flatMap((sale) => {
    const soldIn = shifts.get(sale.shiftId);
    if (!soldIn) return [];
    const reference = receiptNumber(soldIn.number, sale.sequence);
    const tender = tenders.find((row) => row.key === sale.tender)!;
    if (
      search &&
      !(
        reference +
        " " +
        tender.name +
        " " +
        sale.lines.map((line) => line.name).join(" ")
      )
        .toLowerCase()
        .includes(search)
    )
      return [];
    return [
      <div key={sale.id} className="op-sale">
        <button
          className="op-row op-rowbtn"
          type="button"
          onClick={() => setReceiptId(sale.id)}
          aria-label={`Open receipt ${reference}`}
        >
          <div className="op-inline">
            <span className="op-icon-badge">
              <tender.Icon size={19} />
            </span>
            <div>
              <strong>{reference}</strong>
              <p className="op-muted">
                {timestamp(sale.createdAt, business.timeZone)} · {tender.name}
              </p>
            </div>
          </div>
          <div className="op-inline">
            <strong className="op-money">
              {money(sale.total, business.currency)}
            </strong>
            <ChevronRight size={16} />
          </div>
        </button>
        <div className="op-sale-extra">
          {sale.reversedAt ? (
            <span className="op-reversed">
              <ArrowDownLeft size={14} />
              Reversed · {sale.reason}
            </span>
          ) : pending.has(sale.id) ? (
            <span className="op-pill neutral">
              <Clock3 size={12} />
              Saved on this device
            </span>
          ) : null}
          {!sale.reversedAt && soldIn.id === shift?.id && !soldIn.closedAt ? (
            <button
              type="button"
              className="op-text-btn"
              onClick={() => setReverseId(sale.id)}
              disabled={!canReverse}
            >
              Reverse sale
            </button>
          ) : null}
        </div>
      </div>,
    ];
  });
  return (
    <section className="op-screen" aria-label="Sales">
      <div className="op-title">
        <h1>Sales</h1>
      </div>
      {sales.length > 0 ? (
        <label className="op-search">
          <Search size={17} />
          <input
            type="search"
            placeholder="Find receipt, payment or item"
            aria-label="Search sales"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      ) : null}
      <div className="op-panel">
        <div className="op-panel-head">
          <h2>Recent sales</h2>
          <ReceiptText size={18} />
        </div>
        {rows.length ? (
          rows
        ) : search ? (
          <div className="op-empty">
            <Search size={26} />
            <h3>No matching sales</h3>
            <p className="op-muted">
              Try another receipt number, payment method, or item.
            </p>
          </div>
        ) : (
          <EmptySales
            onSell={onSell}
            active={Boolean(
              shift && !shift.closedAt && shift.deviceId === state.deviceId,
            )}
          />
        )}
      </div>
      {selectedSale && selectedShift ? (
        <Receipt
          sale={selectedSale}
          shift={selectedShift}
          business={business}
          onDone={() => setReceiptId(null)}
        />
      ) : null}
      {reversal && reversalShift ? (
        <ReverseForm
          reference={receiptNumber(reversalShift.number, reversal.sequence)}
          method={reversal.tender}
          onClose={() => setReverseId(null)}
          onReverse={(reason, pin) => onReverse(reversal.id, reason, pin)}
        />
      ) : null}
    </section>
  );
}

function OpeningForm({
  currency,
  online,
  onOpen,
  hasMenu,
  onGoMenu,
}: {
  currency: string;
  online: boolean;
  hasMenu: boolean;
  onOpen: ScreenProps["onOpen"];
  onGoMenu: () => void;
}) {
  const [opening, setOpening] = useState("0");
  const { busy, error, run } = useAction();
  return (
    <div className="op-panel">
      <div className="op-panel-head">
        <h2>Open a shift</h2>
        <Wallet size={19} />
      </div>
      <div className="op-panel-pad">
        {hasMenu ? (
          <form
            className="op-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => onOpen(parseMoney(opening, currency)));
            }}
          >
            <label className="op-field">
              Opening cash ({currency})
              <input
                required
                inputMode="decimal"
                value={opening}
                onChange={(event) => setOpening(event.target.value)}
              />
            </label>
            <p className="op-muted">
              Count the cash in the drawer before your first sale.
            </p>
            {!online ? (
              <p className="op-muted">
                Connect to the internet to open the till.
              </p>
            ) : null}
            <ErrorText message={error} />
            <button disabled={!online || busy} className="op-button primary">
              {busy ? "Opening…" : "Open shift"}
              <ArrowRight size={16} />
            </button>
          </form>
        ) : (
          <div className="op-stack">
            <p className="op-muted">
              Add your first menu item before opening your till.
            </p>
            <button className="op-button primary" onClick={onGoMenu}>
              <Plus size={16} />
              Set up menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CloseForm({
  shift,
  expected,
  currency,
  onClose,
  onBack,
}: {
  shift: Shift;
  expected: number;
  currency: string;
  onClose: ScreenProps["onClose"];
  onBack: () => void;
}) {
  const [count, setCount] = useState("");
  const [pin, setPin] = useState("");
  const { busy, error, run } = useAction();
  let difference: number | undefined;
  try {
    difference = parseMoney(count, currency) - expected;
  } catch {}
  return (
    <Dialog
      title={`Close shift #${shift.number}`}
      onClose={() => {
        if (!busy) onBack();
      }}
    >
      <form
        className="op-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await onClose(parseMoney(count, currency), pin);
            onBack();
          });
        }}
      >
        <label className="op-field">
          Counted drawer cash ({currency})
          <input
            autoFocus
            required
            inputMode="decimal"
            value={count}
            placeholder="0"
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <div className="op-inset">
          <div className="op-line">
            <span>Expected cash</span>
            <strong>{money(expected, currency)}</strong>
          </div>
          <div className="op-line">
            <span>Difference</span>
            <strong>
              {difference === undefined ? "—" : money(difference, currency)}
            </strong>
          </div>
        </div>
        <OwnerPin value={pin} onChange={setPin} />
        <ErrorText message={error} />
        <button className="op-button primary" disabled={busy}>
          {busy ? "Closing…" : "Close shift"}
        </button>
      </form>
    </Dialog>
  );
}

export function ShiftScreen({
  state,
  online,
  onOpen,
  onClose,
  onSell,
  onGoMenu,
}: ScreenProps) {
  const [closing, setClosing] = useState(false);
  const { business } = state;
  if (!business) return null;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const totals = shift ? shiftTotals(shift, state.sales) : null;
  const history = [
    ...new Map(
      [...state.shifts, ...(state.shift ? [state.shift] : [])].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ]
    .filter((item) => item.closedAt)
    .sort((a, b) => b.number - a.number);
  const external = Boolean(shift && shift.deviceId !== state.deviceId);
  const canClose = online && state.pending.length === 0 && !external;
  return (
    <section className="op-screen" aria-label="Shift">
      <div className="op-title">
        <h1>Shift</h1>
        {shift ? (
          <span className="op-pill">
            <span className="op-dot" />
            Till open
          </span>
        ) : null}
      </div>
      {shift && totals ? (
        <div className="op-panel">
          <div className="op-panel-head">
            <div>
              <h2>Shift #{shift.number}</h2>
              <p className="op-muted">
                Opened {timestamp(shift.openedAt, business.timeZone)}
              </p>
            </div>
            <Wallet size={21} />
          </div>
          <div className="op-panel-pad op-stack">
            <div className="op-grid2">
              <div className="op-metric">
                <span className="op-muted">Net sales</span>
                <strong>{money(totals.total, business.currency)}</strong>
              </div>
              <div className="op-metric">
                <span className="op-muted">Completed sales</span>
                <strong>{totals.count}</strong>
              </div>
            </div>
            <div>
              {tenders.map(({ key, Icon, name }) => (
                <div className="op-line" key={key}>
                  <span className="op-tender">
                    <Icon size={18} />
                    {name}
                  </span>
                  <strong>{money(totals[key], business.currency)}</strong>
                </div>
              ))}
            </div>
            <div className="op-inset">
              <div className="op-line">
                <span>Opening cash</span>
                <span>{money(shift.openingCash, business.currency)}</span>
              </div>
              <div className="op-line">
                <span>Expected cash in drawer</span>
                <strong>{money(totals.expectedCash, business.currency)}</strong>
              </div>
            </div>
            {external ? (
              <p className="op-muted">This shift is open on another device.</p>
            ) : !canClose ? (
              <p className="op-muted">
                Reconnect and sync pending records before closing.
              </p>
            ) : null}
            {!external ? (
              <div className="op-actions">
                <button
                  className="op-button"
                  disabled={!canClose}
                  onClick={() => setClosing(true)}
                >
                  Close shift
                </button>
                <button className="op-button primary" onClick={onSell}>
                  Go to register
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <OpeningForm
          currency={business.currency}
          online={online}
          onOpen={onOpen}
          hasMenu={state.menu.length > 0}
          onGoMenu={onGoMenu}
        />
      )}
      {history.length ? (
        <div className="op-panel">
          <div className="op-panel-head">
            <h2>Closed shifts</h2>
            <ClipboardList size={18} />
          </div>
          {history.map((previous) => {
            const closedTotals = shiftTotals(previous, state.sales);
            return (
              <details key={previous.id} className="op-history">
                <summary>
                  <span>
                    <strong>Shift #{previous.number}</strong>
                    <span className="op-muted op-dateline">
                      {timestamp(previous.closedAt!, business.timeZone)}
                    </span>
                  </span>
                  <span className="op-inline">
                    Closed
                    <ChevronRight size={15} />
                  </span>
                </summary>
                <div>
                  {tenders.map((tender) => (
                    <div className="op-line" key={tender.key}>
                      <span>{tender.name}</span>
                      <strong>
                        {money(closedTotals[tender.key], business.currency)}
                      </strong>
                    </div>
                  ))}
                  <div className="op-line">
                    <span>Net sales</span>
                    <strong>
                      {money(closedTotals.total, business.currency)}
                    </strong>
                  </div>
                  <div className="op-line">
                    <span>Opening cash</span>
                    <strong>
                      {money(previous.openingCash, business.currency)}
                    </strong>
                  </div>
                  {previous.countedCash !== undefined ? (
                    <div className="op-line">
                      <span>Counted cash</span>
                      <strong>
                        {money(previous.countedCash, business.currency)}
                      </strong>
                    </div>
                  ) : null}
                  {previous.difference !== undefined ? (
                    <div className="op-line">
                      <span>Difference</span>
                      <strong>
                        {money(previous.difference, business.currency)}
                      </strong>
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
      {closing && shift && totals ? (
        <CloseForm
          shift={shift}
          expected={totals.expectedCash}
          currency={business.currency}
          onBack={() => setClosing(false)}
          onClose={onClose}
        />
      ) : null}
    </section>
  );
}
