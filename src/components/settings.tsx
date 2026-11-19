"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Repeat,
  ChevronRight,
  ListChecks,
  Users,
  Coins,
  LayoutGrid,
  ListPlus,
  Percent,
  Package,
  Plus,
  Store,
  Tag,
  Ticket,
  Trash2,
} from "lucide-react";
import type {
  Discount,
  PaymentKind,
  PaymentMethod,
  Product,
  RegisterState,
  Settings,
} from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import type { OwnerAction } from "@/lib/demo";
import { ChecklistPage, TeamPage } from "./team";
import { StockPage } from "./stock-settings";
import { CategoriesPage, categoriesOf, ChoicesPage, choicesOf, MenuPage } from "./menu-settings";
import { OrganizersPage } from "./organizer-settings";
import { plural } from "./records";
import { currencyDigits, paymentKinds, slugId } from "@/lib/settings";
import { applyTheme, fonts, inks, onColor, radii } from "@/lib/theme";
import { BusinessMark, businessList } from "./businesses";
import {
  buzz,
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  PhotoPicker,
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
  | "categories"
  | "choices"
  | "organizers"
  | "checklist"
  | "stock"
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
  /** Opens the list of businesses to switch to or add. */
  onBusinesses: () => void;
}

const countText = (n: number) => (n ? String(n) : "None");

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
      <span className="grow row-title">{title}</span>
      {detail !== undefined && <span className="record-end">{detail}</span>}
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
export function useDraft(
  props: SettingsProps,
  saveLabel = "Save changes",
  savedLabel = "Saved",
) {
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
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (await withPin((pin) => props.onSave(draft, pin))) props.onSaved(savedLabel);
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
          {busy ? "Saving…" : props.online ? saveLabel : "Connect to save"}
        </button>
      </div>
    ) : null;
  return { draft, setDraft, bar, business };
}

/** Saves one change from a settings sheet behind the owner PIN, then says what was saved. */
export function useCommit(props: SettingsProps) {
  const withPin = usePin();
  const business = props.state.business!;
  const input = (patch: Partial<Settings>): SettingsInput => ({
    name: business.name,
    currency: business.currency,
    timeZone: business.timeZone,
    settings: { ...business.settings, ...patch },
  });
  async function run(fn: (pin: string) => Promise<void>, label: string) {
    const done = await withPin(fn);
    if (done) props.onSaved(label);
    return done;
  }
  return {
    input,
    run,
    menu: (menu: Product[], label: string, stock?: Record<string, number>) =>
      run((pin) => props.onMenu(menu, pin, stock), label),
    settings: (patch: Partial<Settings>, label: string) => run((pin) => props.onSave(input(patch), pin), label),
  };
}

function applyNote(state: RegisterState) {
  return state.shift && !state.shift.closedAt
    ? "Applies to this shift right away."
    : state.shift
      ? "Applies when the next shift opens."
      : "Applies when you open the next shift.";
}

/* ---------- business ---------- */

const brands = ["#0a0a0a", "#c2410c", "#b45309", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];

function BusinessPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props);
  const setBrand = (patch: Partial<Settings>) => {
    const settings = { ...draft.settings, ...patch };
    if (!settings.logo) delete settings.logo;
    if (!settings.brand) delete settings.brand;
    if (!settings.font || settings.font === "geist") delete settings.font;
    if (!settings.radius || settings.radius === "round") delete settings.radius;
    if (!settings.ink || settings.ink === inks[0]) delete settings.ink;
    setDraft({ ...draft, settings });
  };
  const brand = draft.settings.brand ?? brands[0];
  const saved = props.state.business!.settings;
  // Preview the theme on the whole app while editing; go back to the saved one on leaving.
  const look = JSON.stringify([draft.settings.brand, draft.settings.font, draft.settings.radius, draft.settings.ink]);
  useEffect(() => {
    applyTheme(draft.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look]);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => () => applyTheme(savedRef.current), []);
  useEffect(() => {
    // Load every font once so the picker shows each in its own face.
    const id = "brand-font-all";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?" + fonts.filter((f) => f.google).map((f) => "family=" + f.google).join("&") + "&display=swap";
    document.head.appendChild(link);
  }, []);
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
      <div className="brand-preview" style={{ background: brand }}>
        <BusinessMark name={draft.name || "Your stall"} logo={draft.settings.logo} brand={brand} size={52} />
        <span className="stack grow" style={{ minWidth: 0 }}>
          <span className="strong ellipsis" style={{ color: onColor(brand) }}>{draft.name || "Your stall"}</span>
          <span className="label" style={{ color: onColor(brand), opacity: 0.72 }}>Buttons, highlights and cards take this look</span>
        </span>
      </div>
      <div className="stack gap-10">
        <p className="group-title">Branding</p>
        <div className="card card-pad stack gap-16">
          <PhotoPicker
            value={draft.settings.logo}
            onChange={(logo) => setBrand({ logo })}
            label="logo"
            disabled={!props.online && !props.demo}
          />
          <div className="field">
            <span>Brand color</span>
            <div className="swatches" role="group" aria-label="Brand color">
              {brands.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={"Brand color " + c}
                  aria-pressed={brand === c}
                  style={{ background: c }}
                  onClick={() => {
                    buzz.tap();
                    setBrand({ brand: c === brands[0] ? undefined : c });
                  }}
                >
                  {brand === c && <Check size={16} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          </div>
          <label className="row gap-10 custom-color">
            <input
              type="color"
              value={brand}
              aria-label="Pick any brand color"
              onChange={(e) => setBrand({ brand: e.target.value })}
            />
            <span className="label">Or pick any color</span>
          </label>
          <div className="field">
            <span>Font</span>
            <div className="font-grid" role="group" aria-label="Font">
              {fonts.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={(draft.settings.font ?? "geist") === f.id}
                  style={{ fontFamily: `${f.family}, system-ui, sans-serif` }}
                  onClick={() => {
                    buzz.tap();
                    setBrand({ font: f.id });
                  }}
                >
                  <span className="font-sample">Aa</span>
                  <span className="font-name">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Corners</span>
            <div className="segmented" role="group" aria-label="Corners">
              {radii.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={(draft.settings.radius ?? "round") === r.id}
                  onClick={() => {
                    buzz.tap();
                    setBrand({ radius: r.id });
                  }}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Text color</span>
            <div className="swatches" role="group" aria-label="Text color">
              {inks.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={"Text color " + c}
                  aria-pressed={(draft.settings.ink ?? inks[0]) === c}
                  style={{ background: c }}
                  onClick={() => {
                    buzz.tap();
                    setBrand({ ink: c });
                  }}
                >
                  {(draft.settings.ink ?? inks[0]) === c && <Check size={16} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          </div>
          <div className="row gap-8 brand-sample">
            <button type="button" className="btn grow">Charge ₱170</button>
            <button type="button" className="btn secondary grow">Cancel</button>
          </div>
          <p className="label">
            Your color, font and corners show across the app, on receipts and on shift reports. Changes preview here
            before you save.
          </p>
        </div>
      </div>
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
          {draft.settings.logo && <img className="receipt-logo" src={draft.settings.logo} alt="" />}
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
  const [proof, setProof] = useState(Boolean(method?.proof));
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
                ...(proof && kind !== "cash" ? { proof: true } : {}),
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
      {kind !== "cash" && (
        <div className="card card-pad row gap-12">
          <span className="grow stack">
            <span className="strong">Require a payment photo</span>
            <span className="label">
              The cashier takes a photo of the payment screen before the sale completes. It stays with the
              receipt. Without this, the photo is optional.
            </span>
          </span>
          <Switch checked={proof} label="Require a payment photo" onChange={setProof} />
        </div>
      )}
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
                {(paymentKinds.find((k) => k.kind === m.kind)?.name !== m.name || m.proof) && (
                  <span className="label">
                    {[
                      paymentKinds.find((k) => k.kind === m.kind)?.name !== m.name
                        ? paymentKinds.find((k) => k.kind === m.kind)?.name
                        : "",
                      m.proof ? "needs a photo" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
  const [proof, setProof] = useState(Boolean(discount?.proof));
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
                ...(proof ? { proof: true } : {}),
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
      <div className="card card-pad row gap-12">
        <span className="grow stack">
          <span className="strong">Require a proof photo</span>
          <span className="label">
            For discounts that need an ID, like Senior or PWD. Checkout asks for a photo before the discount
            applies, and keeps it with the receipt.
          </span>
        </span>
        <Switch checked={proof} label="Require a proof photo" onChange={setProof} />
      </div>
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
                  <span className="label">
                    {discountLabel(d, draft.currency)}
                    {d.proof ? " · needs a photo" : ""}
                  </span>
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

/* ---------- your profile ---------- */

function ProfileCard(props: SettingsProps) {
  const me = props.state.me;
  const [error, setError] = useState("");
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);
  if (!me) return null;
  const changed = name.trim() && name.trim() !== me.name;
  async function saveName() {
    setError("");
    setSaving(true);
    try {
      await props.onAction({ action: "profile", name: name.trim() });
      props.onSaved("Name saved");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="card card-pad stack gap-8">
      <div className="row gap-14 profile-row">
        <PhotoPicker
          face
          size="small"
          value={me.photo}
          label="your profile photo"
          disabled={!props.online && !props.demo}
          onError={setError}
          onChange={async (photo) => {
            setError("");
            try {
              await props.onAction({ action: "profile", photo: photo ?? null });
              props.onSaved(photo ? "Photo saved" : "Photo removed");
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
        <span className="grow stack" style={{ minWidth: 0 }}>
          <input
            className="inline-input strong"
            aria-label="Your name"
            maxLength={80}
            value={name}
            disabled={!props.online && !props.demo}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && changed && !saving) void saveName();
            }}
          />
          <span className="label">
            {me.photo ? "Your name and photo show on shifts and reports." : "Add a photo so the team knows who's on shift."}
          </span>
        </span>
        {changed && (
          <button type="button" className="btn small" disabled={saving} onClick={() => void saveName()}>
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
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
  if (page === "categories") return <CategoriesPage {...props} />;
  if (page === "choices") return <ChoicesPage {...props} />;
  if (page === "organizers") return <OrganizersPage {...props} />;
  if (page === "checklist") return <ChecklistPage {...props} />;
  if (page === "stock") return <StockPage {...props} />;
  if (page === "team") return <TeamPage {...props} />;
  const me = state.me;
  if (me && !me.owner)
    return (
      <div className="page narrow">
        <div className="page-top">
          <h1 className="headline">Settings</h1>
        </div>
        <ProfileCard {...props} />
        <div className="card card-list">
          <Row
            icon={<Repeat size={18} strokeWidth={1.8} />}
            title={businessList(state).length > 1 ? "Switch business" : "Start your own business"}
            onClick={props.onBusinesses}
          />
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
  const businesses = businessList(state).length;
  const methodsOn = s.payments.filter((p) => p.on);
  const discountsOn = s.discounts.filter((d) => d.on).length;
  return (
    <div className="page narrow">
      <div className="page-top">
        <h1 className="headline">Settings</h1>
      </div>
      <ProfileCard {...props} />
      <div className="card card-list">
        <button className="list-row" onClick={() => onPage("business")}>
          <BusinessMark name={business.name} logo={s.logo} brand={s.brand} />
          <span className="grow stack">
            <span className="strong ellipsis">{business.name}</span>
            <span className="label">{demo ? "Demo stall · sample menu" : "Name, logo and receipt"}</span>
          </span>
          <ChevronRight size={18} className="chev" />
        </button>
        <Row
          icon={<Repeat size={18} strokeWidth={1.8} />}
          title={businesses > 1 ? "Switch business" : "Add a business"}
          detail={businesses > 1 ? businesses + " businesses" : undefined}
          onClick={props.onBusinesses}
        />
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
      </div>
      <p className="group-title">Menu</p>
      <div className="card card-list">
        <Row
          icon={<LayoutGrid size={18} strokeWidth={1.8} />}
          title="Menu items"
          detail={plural(state.menu.length, "item")}
          onClick={() => onPage("menu")}
        />
        <Row
          icon={<Tag size={18} strokeWidth={1.8} />}
          title="Categories"
          detail={countText(categoriesOf(state.menu).length)}
          onClick={() => onPage("categories")}
        />
        <Row
          icon={<ListPlus size={18} strokeWidth={1.8} />}
          title="Choices"
          detail={countText(choicesOf(state.menu).length)}
          onClick={() => onPage("choices")}
        />
        <Row
          icon={<Package size={18} strokeWidth={1.8} />}
          title="Stock items"
          detail={countText(s.stockItems?.length ?? 0)}
          onClick={() => onPage("stock")}
        />
      </div>
      <p className="group-title">Shifts</p>
      <div className="card card-list">
        <Row
          icon={<Users size={18} strokeWidth={1.8} />}
          title="Team"
          detail={plural(state.team?.length ?? 1, "person", "people")}
          onClick={() => onPage("team")}
        />
        <Row
          icon={<ListChecks size={18} strokeWidth={1.8} />}
          title="Opening checklist"
          detail={(s.checklist?.length ?? 0) ? plural(s.checklist!.length, "step") : "Off"}
          onClick={() => onPage("checklist")}
        />
        <Row
          icon={<Ticket size={18} strokeWidth={1.8} />}
          title="Organizers"
          detail={countText(state.organizers?.length ?? 0)}
          onClick={() => onPage("organizers")}
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
