"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ListChecks,
  Users,
  Coins,
  Image as ImageIcon,
  LayoutGrid,
  Percent,
  Plus,
  Store,
  Trash2,
} from "lucide-react";
import type {
  Discount,
  OptionGroup,
  PaymentKind,
  PaymentMethod,
  Product,
  RegisterState,
  Settings,
} from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import type { OwnerAction } from "@/lib/demo";
import { ChecklistPage, TeamPage } from "./team";
import { currencyDigits, paymentKinds, slugId } from "@/lib/settings";
import {
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
  Switch,
  usePin,
} from "./ui";

export type SettingsInput = {
  name: string;
  currency: string;
  timeZone: string;
  settings: Settings;
};

export type SettingsPage =
  | "business"
  | "payments"
  | "discounts"
  | "currency"
  | "menu"
  | "checklist"
  | "team";
type Page = SettingsPage;

export interface SettingsProps {
  state: RegisterState;
  online: boolean;
  demo: boolean;
  status: string;
  offlineReady: boolean;
  onSave: (input: SettingsInput, pin: string) => Promise<void>;
  onMenu: (menu: Product[], pin: string, stock?: Record<string, number>) => Promise<void>;
  onAction: (input: OwnerAction) => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
  onSaved: (text: string) => void;
  page: Page | null;
  onPage: (page: Page | null) => void;
}

export function Row({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="list-row" onClick={onClick}>
      <span className="well">{icon}</span>
      <span className="grow">{title}</span>
      {detail !== undefined && <span className="label end">{detail}</span>}
      <ChevronRight size={18} className="chev" />
    </button>
  );
}

export function SubPage({
  title,
  sentence,
  onBack,
  children,
}: {
  title: string;
  sentence?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="page narrow">
      <div className="page-top">
        <button className="round" aria-label="Back to settings" onClick={onBack}>
          <ArrowLeft size={19} />
        </button>
        <span className="strong grow">{title}</span>
      </div>
      {sentence && <h1 className="headline">{sentence}</h1>}
      {children}
    </div>
  );
}

/** Edits a copy of the settings and saves it with one tap, behind the owner PIN. */
export function useDraft(props: SettingsProps) {
  const business = props.state.business!;
  const initial: SettingsInput = {
    name: business.name,
    currency: business.currency,
    timeZone: business.timeZone,
    settings: business.settings,
  };
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withPin = usePin();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  async function save(label = "Saved") {
    setBusy(true);
    setError("");
    try {
      if (await withPin((pin) => props.onSave(draft, pin))) props.onSaved(label);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const bar =
    dirty || error ? (
      <div className="save-bar stack gap-8">
        {error && (
          <p className="notice alert" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn"
          disabled={!dirty || busy || !props.online}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : props.online ? "Save changes" : "Connect to save"}
        </button>
      </div>
    ) : null;
  return { draft, setDraft, bar, business };
}

function applyNote(state: RegisterState) {
  return state.shift && state.shift.deviceId === state.deviceId
    ? "Applies to this shift right away."
    : state.shift
      ? "Applies when the next shift opens."
      : "Applies when you open the next shift.";
}

/* ---------- business ---------- */

function BusinessPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props);
  return (
    <SubPage
      title="Business"
      sentence={
        <>
          {draft.name || "Your stall"} <span className="g">on every receipt.</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Business name</span>
          <input
            className="input"
            maxLength={80}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Receipt footer</span>
          <input
            className="input"
            maxLength={200}
            placeholder="Thank you! Find us at the Sunday market."
            value={draft.settings.receiptNote}
            onChange={(e) =>
              setDraft({
                ...draft,
                settings: { ...draft.settings, receiptNote: e.target.value },
              })
            }
          />
        </label>
      </div>
      <div className="stack gap-10">
        <p className="group-title">Receipt preview</p>
        <div className="mini-receipt">
          <p className="strong">{draft.name || "Your stall"}</p>
          <p className="label">#4-021 · Nov 19, 2:41 PM</p>
          <p className="between" style={{ marginTop: 10 }}>
            <span>Iced latte</span>
            <Money value={170 * 10 ** currencyDigits(draft.currency)} currency={draft.currency} />
          </p>
          {draft.settings.receiptNote.trim() && (
            <p className="label" style={{ marginTop: 10 }}>
              {draft.settings.receiptNote.trim()}
            </p>
          )}
        </div>
      </div>
      {bar}
    </SubPage>
  );
}

/* ---------- payments ---------- */

function MethodSheet({
  method,
  taken,
  onSave,
  onRemove,
  onClose,
  canRemove,
}: {
  method?: PaymentMethod;
  taken: string[];
  onSave: (m: PaymentMethod) => void;
  onRemove?: () => void;
  onClose: () => void;
  canRemove: boolean;
}) {
  const [name, setName] = useState(method?.name ?? "");
  const [kind, setKind] = useState<PaymentKind>(method?.kind ?? "wallet");
  return (
    <Sheet
      title={method ? "Edit method" : "New payment method"}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn block"
            disabled={!name.trim()}
            onClick={() => {
              onSave({
                id: method?.id ?? slugId(name, taken),
                name: name.trim(),
                kind,
                on: method?.on ?? true,
              });
              onClose();
            }}
          >
            {method ? "Done" : "Add method"}
          </button>
          {method && onRemove && (
            <button
              className="btn ghost danger compact block"
              disabled={!canRemove}
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              <Trash2 size={16} /> Remove {method.name}
            </button>
          )}
        </>
      }
    >
      <label className="field">
        <span>Name customers hear</span>
        <input
          className="input"
          maxLength={40}
          autoFocus={!method}
          placeholder="e.g. GoTyme, BPI, ShopeePay"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        <span>Type</span>
        <div className="methods">
          {paymentKinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              className="method"
              aria-pressed={kind === k.kind}
              onClick={() => setKind(k.kind)}
            >
              <MethodIcon kind={k.kind} />
              {k.name}
            </button>
          ))}
        </div>
        <p className="label" style={{ marginTop: 4 }}>
          {kind === "cash"
            ? "Cash counts toward the drawer and asks how much was handed over."
            : "Checkout asks you to confirm the exact amount arrived."}
        </p>
      </div>
    </Sheet>
  );
}

function PaymentsPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props);
  const [editing, setEditing] = useState<PaymentMethod | "new" | null>(null);
  const list = draft.settings.payments;
  const set = (payments: PaymentMethod[]) =>
    setDraft({ ...draft, settings: { ...draft.settings, payments } });
  const on = list.filter((p) => p.on).length;
  return (
    <SubPage
      title="Payment methods"
      sentence={
        <>
          {on} {on === 1 ? "way" : "ways"} to pay <span className="g">at checkout.</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <div className="card card-list">
        {list.map((m) => (
          <div className="list-row" key={m.id}>
            <button
              className="list-row grow"
              style={{ padding: 0, minHeight: 0 }}
              onClick={() => setEditing(m)}
            >
              <span className="well">
                <MethodIcon kind={m.kind} size={18} />
              </span>
              <span className="grow stack">
                <span className={m.on ? "" : "g"}>{m.name}</span>
                {paymentKinds.find((k) => k.kind === m.kind)?.name !== m.name && (
                  <span className="label">
                    {paymentKinds.find((k) => k.kind === m.kind)?.name}
                  </span>
                )}
              </span>
            </button>
            <Switch
              checked={m.on}
              label={m.name + " at checkout"}
              disabled={m.on && on === 1}
              onChange={(next) =>
                set(list.map((p) => (p.id === m.id ? { ...p, on: next } : p)))
              }
            />
          </div>
        ))}
      </div>
      <button className="btn secondary" onClick={() => setEditing("new")}>
        <Plus size={18} /> Add payment method
      </button>
      <p className="label">
        {applyNote(props.state)} Past receipts keep the method they were paid with.
      </p>
      {editing && (
        <MethodSheet
          method={editing === "new" ? undefined : editing}
          taken={list.map((p) => p.id)}
          canRemove={list.length > 1 && !(editing !== "new" && editing.on && on === 1)}
          onClose={() => setEditing(null)}
          onSave={(m) =>
            set(
              list.some((p) => p.id === m.id)
                ? list.map((p) => (p.id === m.id ? m : p))
                : [...list, m],
            )
          }
          onRemove={
            editing === "new"
              ? undefined
              : () => set(list.filter((p) => p.id !== editing.id))
          }
        />
      )}
      {bar}
    </SubPage>
  );
}

/* ---------- discounts ---------- */

function discountLabel(d: Discount, currency: string) {
  return d.type === "percent" ? d.value + "% off" : formatMoney(d.value, currency) + " off";
}

function DiscountSheet({
  discount,
  currency,
  taken,
  onSave,
  onRemove,
  onClose,
}: {
  discount?: Discount;
  currency: string;
  taken: string[];
  onSave: (d: Discount) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(discount?.name ?? "");
  const [type, setType] = useState<Discount["type"]>(discount?.type ?? "percent");
  const [value, setValue] = useState(
    discount
      ? discount.type === "percent"
        ? String(discount.value)
        : amountText(discount.value, currency)
      : "",
  );
  let parsed: number | undefined;
  let problem = "";
  if (value.trim()) {
    try {
      parsed =
        type === "percent" ? Number(value) : parseMoney(value, currency);
      if (type === "percent" && (!Number.isInteger(parsed) || parsed < 1 || parsed > 100)) {
        problem = "Use a whole percent from 1 to 100.";
        parsed = undefined;
      } else if (parsed < 1) parsed = undefined;
    } catch (e) {
      problem = errorText(e);
    }
  }
  return (
    <Sheet
      title={discount ? "Edit discount" : "New discount"}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn block"
            disabled={!name.trim() || parsed === undefined}
            onClick={() => {
              onSave({
                id: discount?.id ?? slugId(name, taken),
                name: name.trim(),
                type,
                value: parsed!,
                on: discount?.on ?? true,
              });
              onClose();
            }}
          >
            {discount ? "Done" : "Add discount"}
          </button>
          {onRemove && (
            <button
              className="btn ghost danger compact block"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              <Trash2 size={16} /> Remove discount
            </button>
          )}
        </>
      }
    >
      <label className="field">
        <span>Name on the receipt</span>
        <input
          className="input"
          maxLength={40}
          autoFocus={!discount}
          placeholder="e.g. Suki, Staff, Bundle"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="segmented" role="group" aria-label="Discount type">
        <button
          aria-pressed={type === "percent"}
          onClick={() => {
            setType("percent");
            setValue("");
          }}
        >
          Percent
        </button>
        <button
          aria-pressed={type === "fixed"}
          onClick={() => {
            setType("fixed");
            setValue("");
          }}
        >
          Fixed amount
        </button>
      </div>
      {type === "percent" ? (
        <label className="field">
          <span>Percent off the order</span>
          <span className="money-input">
            <input
              className="input"
              inputMode="numeric"
              placeholder="10"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              style={{ paddingLeft: 16, paddingRight: 40 }}
            />
            <span className="prefix" style={{ left: "auto", right: 16 }}>
              %
            </span>
          </span>
        </label>
      ) : (
        <MoneyField
          label="Amount off the order"
          value={value}
          onChange={setValue}
          currency={currency}
        />
      )}
      {problem && <p className="alert">{problem}</p>}
    </Sheet>
  );
}

function DiscountsPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props);
  const [editing, setEditing] = useState<Discount | "new" | null>(null);
  const list = draft.settings.discounts;
  const set = (discounts: Discount[]) =>
    setDraft({ ...draft, settings: { ...draft.settings, discounts } });
  const on = list.filter((d) => d.on).length;
  return (
    <SubPage
      title="Discounts"
      sentence={
        on ? (
          <>
            {on} {on === 1 ? "discount" : "discounts"}{" "}
            <span className="g">one tap away at checkout.</span>
          </>
        ) : (
          <>
            No discounts <span className="g">at checkout.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      {list.length > 0 && (
        <div className="card card-list">
          {list.map((d) => (
            <div className="list-row" key={d.id}>
              <button
                className="list-row grow"
                style={{ padding: 0, minHeight: 0 }}
                onClick={() => setEditing(d)}
              >
                <span className="well">
                  <Percent size={18} strokeWidth={1.8} />
                </span>
                <span className="grow stack">
                  <span className={d.on ? "" : "g"}>{d.name}</span>
                  <span className="label">{discountLabel(d, draft.currency)}</span>
                </span>
              </button>
              <Switch
                checked={d.on}
                label={d.name + " at checkout"}
                onChange={(next) =>
                  set(list.map((x) => (x.id === d.id ? { ...x, on: next } : x)))
                }
              />
            </div>
          ))}
        </div>
      )}
      <button className="btn secondary" onClick={() => setEditing("new")}>
        <Plus size={18} /> Add discount
      </button>
      <p className="label">
        One discount per order, taken off the total. {applyNote(props.state)}
      </p>
      {editing && (
        <DiscountSheet
          discount={editing === "new" ? undefined : editing}
          currency={draft.currency}
          taken={list.map((d) => d.id)}
          onClose={() => setEditing(null)}
          onSave={(d) =>
            set(
              list.some((x) => x.id === d.id)
                ? list.map((x) => (x.id === d.id ? d : x))
                : [...list, d],
            )
          }
          onRemove={
            editing === "new" ? undefined : () => set(list.filter((x) => x.id !== editing.id))
          }
        />
      )}
      {bar}
    </SubPage>
  );
}

/* ---------- currency ---------- */

const common = ["PHP", "USD", "SGD", "MYR", "IDR", "THB", "VND", "JPY", "EUR", "GBP", "AUD", "CAD"];

export function currencyName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function CurrencyOptions() {
  const all = Intl.supportedValuesOf("currency");
  return (
    <>
      <optgroup label="Common">
        {common.map((c) => (
          <option key={c} value={c}>
            {c} · {currencyName(c)}
          </option>
        ))}
      </optgroup>
      <optgroup label="All currencies">
        {all
          .filter((c) => !common.includes(c))
          .map((c) => (
            <option key={c} value={c}>
              {c} · {currencyName(c)}
            </option>
          ))}
      </optgroup>
    </>
  );
}

function CurrencyPage(props: SettingsProps) {
  const { draft, setDraft, bar, business } = useDraft(props);
  const open = Boolean(props.state.shift);
  const zones = Array.from(
    new Set([draft.timeZone, ...Intl.supportedValuesOf("timeZone")]),
  );
  return (
    <SubPage
      title="Currency and time"
      sentence={
        <>
          <Money value={120 * 10 ** currencyDigits(draft.currency)} currency={draft.currency} />{" "}
          <span className="g">is how prices will look.</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <div className="card card-pad stack gap-14">
        <label className="field">
          <span>Currency</span>
          <select
            className="select"
            value={draft.currency}
            disabled={open}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
          >
            <CurrencyOptions />
          </select>
        </label>
        {open && (
          <p className="label">Close the shift to change currency.</p>
        )}
        {!open && draft.currency !== business.currency && (
          <p className="label">
            Menu prices keep their numbers: a price of 120 stays 120.
          </p>
        )}
        <label className="field">
          <span>Time zone for receipts and shifts</span>
          <select
            className="select"
            value={draft.timeZone}
            onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
          >
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
      </div>
      {bar}
    </SubPage>
  );
}

/* ---------- menu ---------- */

type GroupDraft = Omit<OptionGroup, "options"> & {
  options: { id: string; name: string; price: string }[];
};

export function ItemSheet({
  product,
  currency,
  categories,
  liveShift = false,
  onSave,
  onRemove,
  onClose,
}: {
  product?: Product;
  currency: string;
  categories: string[];
  /** A new item goes on sale on the shift open on this phone, so ask how many there are. */
  liveShift?: boolean;
  onSave: (p: Product, count?: number) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [tracked, setTracked] = useState(Boolean(product?.stock));
  const [count, setCount] = useState("");
  const askCount = tracked && liveShift && !product;
  const [price, setPrice] = useState(product ? amountText(product.price, currency) : "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    (product?.groups ?? []).map((g) => ({
      ...g,
      options: g.options.map((o) => ({ ...o, price: amountText(o.price, currency) })),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setGroup = (id: string, fn: (g: GroupDraft) => GroupDraft) =>
    setGroups((all) => all.map((g) => (g.id === id ? fn(g) : g)));
  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    setError("");
    try {
      if (await fn()) onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={product ? "Edit item" : "New item"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            className="btn block"
            disabled={busy || !name.trim() || !price.trim() || (askCount && !count.trim())}
            onClick={() =>
              void run(async () => {
                const saved = groups.map((g) => {
                  if (!g.name.trim() || !g.options.length || g.options.some((o) => !o.name.trim()))
                    throw Error("Name each choice and every option in it.");
                  return {
                    id: g.id,
                    name: g.name.trim(),
                    required: g.required,
                    options: g.options.map((o) => ({
                      id: o.id,
                      name: o.name.trim(),
                      price: parseMoney(o.price || "0", currency),
                    })),
                  };
                });
                const { stock: _, ...rest } = product ?? ({} as Partial<Product>);
                return onSave(
                  {
                    ...rest,
                    id: product?.id ?? crypto.randomUUID(),
                    name: name.trim(),
                    category: category.trim(),
                    price: parseMoney(price, currency),
                    groups: saved,
                    ...(tracked ? { stock: true } : {}),
                  },
                  askCount ? Number(count) : undefined,
                );
              })
            }
          >
            {busy ? "Saving…" : product ? "Save item" : "Add item"}
          </button>
          {product && onRemove && (
            <button
              className="btn ghost danger compact block"
              disabled={busy}
              onClick={() => void run(onRemove)}
            >
              <Trash2 size={16} /> Remove from menu
            </button>
          )}
        </>
      }
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
        <label className="field">
          <span>Category</span>
          <input
            className="input"
            maxLength={60}
            list="menu-categories"
            placeholder="e.g. Drinks"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="menu-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="card card-pad stack gap-12">
        <div className="row gap-12">
          <span className="grow stack">
            <span className="strong">Track stock</span>
            <span className="label">
              For a set supply, like bread or pastries. You count it when the shift opens and it
              sells out at zero.
            </span>
          </span>
          <Switch checked={tracked} label="Track stock" onChange={setTracked} />
        </div>
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
        {tracked && product && liveShift && !product.stock && (
          <p className="label">Counting starts when the next shift opens.</p>
        )}
      </div>
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
          <input
            className="input"
            aria-label="Choice name"
            maxLength={60}
            placeholder={g.required ? "e.g. Size" : "e.g. Extras"}
            value={g.name}
            onChange={(e) => setGroup(g.id, (x) => ({ ...x, name: e.target.value }))}
          />
          {g.options.map((o, i) => (
            <div className="row gap-8" key={o.id}>
              <input
                className="input grow"
                aria-label={`Option ${i + 1} name`}
                maxLength={60}
                placeholder={g.required ? (i ? "Large" : "Regular") : "Extra shot"}
                value={o.name}
                onChange={(e) =>
                  setGroup(g.id, (x) => ({
                    ...x,
                    options: x.options.map((r) => (r.id === o.id ? { ...r, name: e.target.value } : r)),
                  }))
                }
              />
              <span className="money-input" style={{ width: 110, flex: "none" }}>
                <input
                  className="input"
                  aria-label={`Option ${i + 1} extra price`}
                  inputMode="decimal"
                  placeholder="0"
                  value={o.price === amountText(0, currency) ? "" : o.price}
                  onChange={(e) =>
                    setGroup(g.id, (x) => ({
                      ...x,
                      options: x.options.map((r) =>
                        r.id === o.id ? { ...r, price: e.target.value.replace(/[^\d.]/g, "") } : r,
                      ),
                    }))
                  }
                />
                <span className="prefix">+</span>
              </span>
              <button
                type="button"
                className="round flat"
                aria-label={`Remove option ${i + 1}`}
                onClick={() =>
                  setGroup(g.id, (x) => ({ ...x, options: x.options.filter((r) => r.id !== o.id) }))
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn secondary compact"
            onClick={() =>
              setGroup(g.id, (x) => ({
                ...x,
                options: [...x.options, { id: crypto.randomUUID(), name: "", price: "" }],
              }))
            }
          >
            <Plus size={16} /> Option
          </button>
        </div>
      ))}
      <div className="grid-2">
        {[true, false].map((required) => (
          <button
            key={String(required)}
            type="button"
            className="btn secondary compact"
            onClick={() =>
              setGroups((all) => [
                ...all,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  required,
                  options: [{ id: crypto.randomUUID(), name: "", price: "" }],
                },
              ])
            }
          >
            <Plus size={16} /> {required ? "Pick-one choice" : "Add-ons"}
          </button>
        ))}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function MenuPage(props: SettingsProps) {
  const business = props.state.business!;
  const menu = props.state.menu;
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const withPin = usePin();
  const categories = Array.from(new Set(menu.map((m) => m.category).filter(Boolean)));
  const grouped = [...categories, ""].map((c) => ({
    name: c,
    items: menu.filter((m) => (m.category || "") === c),
  }));
  const live = Boolean(props.state.shift && props.state.shift.deviceId === props.state.deviceId);
  async function save(next: Product[], label: string, stock?: Record<string, number>) {
    const done = await withPin((pin) => props.onMenu(next, pin, stock));
    if (done) props.onSaved(label);
    return done;
  }
  return (
    <SubPage
      title="Menu"
      sentence={
        <>
          {menu.length} {menu.length === 1 ? "item" : "items"}{" "}
          <span className="g">for sale.</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <button className="btn" disabled={!props.online} onClick={() => setEditing("new")}>
        <Plus size={18} /> Add item
      </button>
      {grouped
        .filter((g) => g.items.length)
        .map((g) => (
          <div className="stack gap-10" key={g.name || "none"}>
            <p className="group-title">{g.name || (categories.length ? "No category" : "Items")}</p>
            <div className="card card-list">
              {g.items.map((p) => (
                <button
                  key={p.id}
                  className="list-row"
                  disabled={!props.online}
                  onClick={() => setEditing(p)}
                >
                  {p.image ? (
                    <img
                      src={p.image}
                      alt=""
                      width={44}
                      height={44}
                      style={{ borderRadius: 12, objectFit: "cover", flex: "none" }}
                    />
                  ) : (
                    <span className="well">
                      <ImageIcon size={18} strokeWidth={1.6} className="g" />
                    </span>
                  )}
                  <span className="grow stack">
                    <span className="ellipsis">{p.name}</span>
                    {(p.groups.length > 0 || p.stock) && (
                      <span className="label ellipsis">
                        {[p.stock ? "Counted each shift" : "", ...p.groups.map((x) => x.name)]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                  </span>
                  <Money value={p.price} currency={business.currency} />
                  <ChevronRight size={18} className="chev" />
                </button>
              ))}
            </div>
          </div>
        ))}
      <p className="label">
        {props.online
          ? props.state.shift
            ? live
              ? "New items go on sale right away. Edits to existing items apply from the next shift. To pause an item now, mark it sold out on Sell."
              : "Changes reach the register when the next shift opens."
            : "Changes reach the register when you open the next shift."
          : "Connect to edit the menu."}
      </p>
      {editing && (
        <ItemSheet
          product={editing === "new" ? undefined : editing}
          currency={business.currency}
          categories={categories}
          liveShift={live}
          onClose={() => setEditing(null)}
          onSave={(item, count) =>
            save(
              editing === "new"
                ? [...menu, item]
                : menu.map((p) => (p.id === item.id ? item : p)),
              editing === "new" ? "Added " + item.name : "Saved " + item.name,
              count !== undefined ? { [item.id]: count } : undefined,
            )
          }
          onRemove={
            editing === "new"
              ? undefined
              : () => save(menu.filter((p) => p.id !== editing.id), "Removed " + editing.name)
          }
        />
      )}
    </SubPage>
  );
}

/* ---------- home ---------- */

export function SettingsScreen(props: SettingsProps) {
  const { state, page, onPage, demo } = props;
  const business = state.business!;
  const s = business.settings;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  if (page === "business") return <BusinessPage {...props} />;
  if (page === "payments") return <PaymentsPage {...props} />;
  if (page === "discounts") return <DiscountsPage {...props} />;
  if (page === "currency") return <CurrencyPage {...props} />;
  if (page === "menu") return <MenuPage {...props} />;
  if (page === "checklist") return <ChecklistPage {...props} />;
  if (page === "team") return <TeamPage {...props} />;
  const me = state.me;
  if (me && !me.owner)
    return (
      <div className="page narrow">
        <div className="page-top">
          <h1 className="headline">Settings</h1>
        </div>
        <div className="card card-list">
          <div className="list-row">
            <span className="mark">{me.name.slice(0, 1).toUpperCase() || "?"}</span>
            <span className="grow stack">
              <span className="strong ellipsis">{me.name}</span>
              <span className="label">
                {me.roles.length === 2 ? "Cashier and server" : me.roles[0] === "cashier" ? "Cashier" : "Server"} at {business.name}
              </span>
            </span>
          </div>
        </div>
        <p className="label" style={{ padding: "0 4px" }}>
          The owner manages the menu, payments and team.
        </p>
        <div className="card card-pad">
          <button className="btn secondary block" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  const initials = business.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const methodsOn = s.payments.filter((p) => p.on);
  const discountsOn = s.discounts.filter((d) => d.on).length;
  return (
    <div className="page narrow">
      <div className="page-top">
        <h1 className="headline">Settings</h1>
      </div>
      <div className="card card-list">
        <button className="list-row" onClick={() => onPage("business")}>
          <span className="mark">{initials || "P"}</span>
          <span className="grow stack">
            <span className="strong ellipsis">{business.name}</span>
            <span className="label">{demo ? "Demo stall · sample menu" : "Name and receipt"}</span>
          </span>
          <ChevronRight size={18} className="chev" />
        </button>
      </div>
      <p className="group-title">Checkout</p>
      <div className="card card-list">
        <Row
          icon={<Coins size={18} strokeWidth={1.8} />}
          title="Payment methods"
          detail={methodsOn.map((m) => m.name).slice(0, 3).join(", ") + (methodsOn.length > 3 ? " +" + (methodsOn.length - 3) : "")}
          onClick={() => onPage("payments")}
        />
        <Row
          icon={<Percent size={18} strokeWidth={1.8} />}
          title="Discounts"
          detail={discountsOn ? discountsOn + " on" : "Off"}
          onClick={() => onPage("discounts")}
        />
        <Row
          icon={<LayoutGrid size={18} strokeWidth={1.8} />}
          title="Menu"
          detail={state.menu.length + (state.menu.length === 1 ? " item" : " items")}
          onClick={() => onPage("menu")}
        />
      </div>
      <p className="group-title">Shifts</p>
      <div className="card card-list">
        <Row
          icon={<Users size={18} strokeWidth={1.8} />}
          title="Team"
          detail={(state.team?.length ?? 1) + ((state.team?.length ?? 1) === 1 ? " person" : " people")}
          onClick={() => onPage("team")}
        />
        <Row
          icon={<ListChecks size={18} strokeWidth={1.8} />}
          title="Opening checklist"
          detail={(s.checklist?.length ?? 0) ? s.checklist!.length + " steps" : "Off"}
          onClick={() => onPage("checklist")}
        />
      </div>
      <p className="group-title">Register</p>
      <div className="card card-list">
        <Row
          icon={<Store size={18} strokeWidth={1.8} />}
          title="Currency and time"
          detail={business.currency + " · " + (business.timeZone.split("/").pop() ?? "").replace(/_/g, " ")}
          onClick={() => onPage("currency")}
        />
      </div>
      <p className="group-title">This phone</p>
      <div className="card card-list">
        <div className="list-row">
          <span className="grow">Connection</span>
          <span className="label row gap-6">
            <span className={"dot " + (props.online ? "success" : "danger")} />
            {props.status}
          </span>
        </div>
        <div className="list-row">
          <span className="grow stack">
            <span>Works offline</span>
            <span className="label">Sales save here and sync when you reconnect.</span>
          </span>
          <span className="label">{props.offlineReady ? "Ready" : "Getting ready"}</span>
        </div>
      </div>
      <div className="card card-pad stack gap-12">
        {demo ? (
          <>
            <p className="muted">
              You're in the demo. Sales stay on this phone. The owner PIN is <strong>1234</strong>.
            </p>
            <button className="btn" onClick={props.onSignIn}>
              Sign in to your business
            </button>
          </>
        ) : (
          <button className="btn secondary" onClick={props.onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
