"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  Repeat,
  ChevronRight,
  SlidersHorizontal,
  Package,
  Calculator,
  ListChecks,
  Users,
  Coins,
  Percent,
  Store,
  Ticket,
  Trash2,
} from "lucide-react";
import type {
  Discount,
  PaymentKind,
  PaymentMethod,
  Product,
  RegisterState,
  RegisterMode,
  Settings,
} from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import type { OwnerAction } from "@/lib/demo";
import { ChecklistPage, TeamPage } from "./team";
import { OrganizersPage } from "./organizer-settings";
import { plural, useRecordSave } from "./records";
import { currencyDigits, isSimpleMode, paymentKinds, slugId } from "@/lib/settings";
import { applyTheme, fonts, inks, onColor, radii } from "@/lib/theme";
import { BusinessMark, businessList } from "./businesses";
import { AddButton } from "./add-menu";
import {
  buzz,
  ConfirmSheet,
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  Notice,
  PhotoPicker,
  Sheet,
  Explain,
  Switch,
  usePin,
} from "./ui";
import styles from "./settings.module.css";
import { blocked } from "@/lib/reject";

export type SettingsInput = {
  name: string;
  currency: string;
  timeZone: string;
  settings: Settings;
  /** What the open shift has left now, set on purpose, by stock item id. Sales take from it from then on. */
  stockNow?: Record<string, number>;
};

export type SettingsPage =
  | "business"
  | "payments"
  | "discounts"
  | "currency"
  | "organizers"
  | "checklist"
  | "team";

export interface EditorProps {
  state: RegisterState;
  online: boolean;
  onSave: (input: SettingsInput, pin: string) => Promise<void>;
  onMenu: (menu: Product[], pin: string, stock?: Record<string, number>) => Promise<void>;
  onSaved: (text: string) => void;
}

export interface SettingsProps extends EditorProps {
  demo: boolean;
  status: string;
  offlineReady: boolean;
  onAction: (input: OwnerAction) => Promise<void>;
  onSignIn: () => void;
  onSignOut: () => void;
  page: SettingsPage | null;
  onPage: (page: SettingsPage | null) => void;
  /** Opens the list of businesses to switch to or add. */
  onBusinesses: () => void;
}

const countText = (n: number) => (n ? String(n) : "None");

export function Row({
  icon,
  title,
  description,
  detail,
  onClick,
  priority = false,
}: {
  icon: ReactNode;
  title: string;
  /** One plain line on what's inside, so the row explains itself before it's tapped. */
  description?: string;
  detail?: ReactNode;
  onClick: () => void;
  priority?: boolean;
}) {
  return (
    <button type="button" className={priority ? "list-row " + styles.priorityRow : "list-row"} onClick={onClick}>
      <span className="well" aria-hidden="true">{icon}</span>
      {description ? (
        <span className="row-text">
          <span>{title}</span>
          <span className="label">{description}</span>
        </span>
      ) : (
        <span className="grow row-title wrap">{title}</span>
      )}
      {detail !== undefined && <span className="record-end">{detail}</span>}
      <ChevronRight size={18} className="chev" aria-hidden="true" />
    </button>
  );
}

export function SetupDetails({ title, description, children, className = "", onOpen }: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  onOpen?: () => void;
}) {
  return (
    <details className={styles.disclosure + " " + className} onToggle={onOpen && ((event) => {
      if (event.currentTarget.open) onOpen();
    })}>
      <summary>
        <span className="stack gap-4">
          <span className="strong">{title}</span>
          {description && <span className="label">{description}</span>}
        </span>
        <ChevronRight size={16} className={styles.disclosureIcon} aria-hidden="true" />
      </summary>
      <div className={styles.disclosureContent}>{children}</div>
    </details>
  );
}

export function SubPage({
  title,
  sentence,
  sentenceAction,
  onBack,
  backLabel = "Back to settings",
  help,
  action,
  children,
}: {
  title: string;
  sentence?: ReactNode;
  /** A primary action beside the page summary. */
  sentenceAction?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  /** A small action at the end of the title row, like Select. */
  action?: ReactNode;
  /** How the page works, behind an (i) beside its title instead of a note at the bottom. */
  help?: ReactNode;
  children: ReactNode;
}) {
  const summary = sentence && <p className={sentenceAction ? "headline grow" : "headline"}>{sentence}</p>;
  return (
    <div className="page">
      <div className="page-top">
        <button type="button" className="round" aria-label={backLabel} onClick={onBack}>
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <div className="grow page-title">
          <h1 className={"strong " + styles.subPageTitle}>{title}</h1>
          {help && <Explain title={title}>{help}</Explain>}
        </div>
        {action}
      </div>
      {sentenceAction ? <div className="between">{summary}{sentenceAction}</div> : summary}
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
  const saving = useRef(false);
  const withPin = usePin();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (await withPin((pin) => props.onSave(draft, pin))) props.onSaved(savedLabel);
    } catch (e) {
      setError(errorText(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const bar =
    dirty || error ? (
      <div className="save-bar stack gap-8">
        {error && (
          <Notice tone="danger" live="assertive">
            {error}
          </Notice>
        )}
        <button
          type="button"
          className="btn"
          aria-busy={busy}
          aria-label={saveLabel}
          disabled={!dirty || busy || !props.online}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : props.online ? "Save" : "Connect to save"}
        </button>
      </div>
    ) : null;
  return { draft, setDraft, bar, business };
}

/** Saves one change from a settings sheet behind the owner PIN, then says what was saved. */
export function useCommit(props: EditorProps) {
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
    settings: (patch: Partial<Settings>, label: string, stockNow?: Record<string, number>) =>
      run((pin) => props.onSave({ ...input(patch), ...(stockNow ? { stockNow } : {}) }, pin), label),
  };
}

function applyNote(state: RegisterState) {
  return state.shift && !state.shift.closedAt
    ? "Applies to this shift right away."
    : state.shift
      ? "Applies when the next shift opens."
      : "Applies when you open the next shift.";
}

/** What Advanced adds on top of Simple, in the order an owner meets it. */
const advancedAdds = [
  { icon: Package, title: "Stock and prep", text: "Count what runs out and cost what you make in batches." },
  { icon: Calculator, title: "Cost and margin", text: "See what each menu item costs you and what you keep." },
];

/**
 * Show which capabilities change before the owner confirms a mode switch.
 */
function ModeCard(props: SettingsProps) {
  const simple = isSimpleMode(props.state.business!.settings);
  const [asking, setAsking] = useState(false);
  return (
    <>
      <div className="card card-pad mode-card">
        <span className="well">
          <SlidersHorizontal size={18} strokeWidth={1.8} />
        </span>
        <span className="row-text">
          <span className="strong">Advanced mode</span>
          <span className="label">Stock, prep and costing</span>
        </span>
        <Switch
          checked={!simple}
          label="Advanced mode"
          disabled={!props.online && !props.demo}
          onChange={() => setAsking(true)}
        />
      </div>
      {asking && <ModeSheet {...props} turnOn={simple} onClose={() => setAsking(false)} />}
    </>
  );
}

function ModeSheet({ turnOn, onClose, ...props }: SettingsProps & { turnOn: boolean; onClose: () => void }) {
  const business = props.state.business!;
  const commit = useCommit(props);
  const { busy, error, run } = useRecordSave(onClose);
  const mode: RegisterMode = turnOn ? "advanced" : "simple";
  const save = () => run(() => commit.run(
    (pin) => props.onAction({ action: "mode", mode, pin }),
    turnOn ? "Advanced mode on" : "Simple mode on",
  ));
  return (
    <Sheet
      title={turnOn ? "Turn on Advanced mode?" : "Switch to Simple mode?"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {error && <p className="alert" role="alert">{error}</p>}
          <button className="btn block" disabled={busy || (!props.online && !props.demo)} onClick={() => void save()}>
            {busy ? "Saving…" : turnOn ? "Turn on Advanced" : "Switch to Simple"}
          </button>
          <button className="btn ghost compact block" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="muted">
        {turnOn
          ? "Everything you use now stays the same. You also get:"
          : "Selling, shifts, checklists, organizers, branding and sales charts stay available. These go out of sight:"}
      </p>
      <div className="card card-pad change-list">
        {advancedAdds.map(({ icon: Icon, title, text }) => (
          <div key={title}>
            <span className="well">
              <Icon size={18} strokeWidth={1.8} />
            </span>
            <span className="row-text">
              <span>{title}</span>
              <span className="label">{text}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="label">
        {turnOn
          ? `Applies to everyone on ${business.name}. You can switch back anytime.`
          : `Nothing is deleted. Stock and costs come back when you turn Advanced on again. Applies to everyone on ${business.name}.`}
      </p>
    </Sheet>
  );
}

/* ---------- business ---------- */

const brands = ["#0a0a0a", "#c2410c", "#b45309", "#15803d", "#0f766e", "#1d4ed8", "#6d28d9", "#be185d"];

function loadFontSamples() {
  const id = "brand-font-all";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + fonts.filter((font) => font.google).map((font) => "family=" + font.google).join("&") + "&display=swap";
  document.head.appendChild(link);
}

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
  const logoPicker = (
    <PhotoPicker
      value={draft.settings.logo}
      onChange={(logo) => setDraft((current) => ({ ...current, settings: { ...current.settings, logo } }))}
      label="logo"
      disabled={!props.online && !props.demo}
    />
  );
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
      <div className="brand-preview" style={{ background: brand }}>
        <BusinessMark name={draft.name || "Your stall"} logo={draft.settings.logo} brand={brand} size={52} />
        <span className="stack grow" style={{ minWidth: 0 }}>
          <span className="strong ellipsis" style={{ color: onColor(brand) }}>{draft.name || "Your stall"}</span>
          <span className="label" style={{ color: onColor(brand), opacity: 0.72 }}>Buttons, highlights and cards take this look</span>
        </span>
      </div>
      <div className="stack gap-10">
        <p className="group-title title-help">
          Branding
          <Explain title="Branding">
            <p>Your color, font and corners show across the app, on receipts and on shift reports.</p>
            <p>Changes preview here before you save.</p>
          </Explain>
        </p>
        <div className="card card-pad stack gap-16">
          {logoPicker}
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
        </div>
        <SetupDetails title="More appearance options" description="Font, corners and text color" className="card card-pad" onOpen={loadFontSamples}>
          <div className="stack gap-16">
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
            <div className="row gap-8 brand-sample" aria-hidden="true">
              <span className="btn grow">Charge {formatMoney(170 * 10 ** currencyDigits(draft.currency), draft.currency)}</span>
              <span className="btn secondary grow">Cancel</span>
            </div>
          </div>
        </SetupDetails>
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
  const [removing, setRemoving] = useState(false);
  return (
    <>
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
            {method ? "Done" : "Add"}
          </button>
          {method && onRemove && (
            <button
              className="btn ghost danger compact block"
              {...blocked(!canRemove && "Keep at least one payment method on at checkout.")}
              onClick={() => setRemoving(true)}
            >
              <Trash2 size={16} /> Remove
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
    {removing && method && onRemove && (
      <ConfirmSheet
        title="Remove payment method?"
        detail={`${method.name} will be removed when you save your payment methods.`}
        confirmLabel="Remove"
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          onRemove();
          onClose();
        }}
      />
    )}
    </>
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
      help={
        <>
          <p>Checkout offers the methods that are on. Cash counts toward the drawer and asks how much was handed over. Other methods ask you to confirm the exact amount arrived.</p>
          <p>{applyNote(props.state)} Past receipts keep the method they were paid with.</p>
        </>
      }
      sentence={
        <>
          {on} {on === 1 ? "way" : "ways"} to pay <span className="g">at checkout.</span>
        </>
      }
      sentenceAction={
        <AddButton
          blockedReason={list.length >= 24 && "You can add up to 24 payment methods."}
          onClick={() => setEditing("new")}
        />
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
  const [removing, setRemoving] = useState(false);
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
    <>
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
            {discount ? "Done" : "Add"}
          </button>
          {onRemove && (
            <button
              className="btn ghost danger compact block"
              onClick={() => setRemoving(true)}
            >
              <Trash2 size={16} /> Remove
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
    {removing && discount && onRemove && (
      <ConfirmSheet
        title="Remove discount?"
        detail={`${discount.name} will be removed when you save your discounts.`}
        confirmLabel="Remove"
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          onRemove();
          onClose();
        }}
      />
    )}
    </>
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
      help={
        <>
          <p>One discount per order, taken off the total. The cashier picks it at checkout.</p>
          <p>{applyNote(props.state)}</p>
        </>
      }
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
      sentenceAction={
        <AddButton
          blockedReason={list.length >= 24 && "You can add up to 24 discounts."}
          onClick={() => setEditing("new")}
        />
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
  // Saves on its own when the field loses focus, or on the keyboard's Done or Enter.
  async function saveName() {
    const next = name.trim();
    if (!next) return setName(me!.name);
    if (next === me!.name || saving) return;
    setError("");
    setSaving(true);
    try {
      await props.onAction({ action: "profile", name: next });
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
            await props.onAction({ action: "profile", photo: photo ?? null });
            props.onSaved(photo ? "Photo saved" : "Photo removed");
          }}
        />
        <span className="grow stack" style={{ minWidth: 0 }}>
          <input
            className="inline-input strong"
            aria-label="Your name"
            maxLength={80}
            enterKeyHint="done"
            autoComplete="name"
            value={name}
            disabled={(!props.online && !props.demo) || saving}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
              else if (e.key === "Escape") {
                setName(me.name);
                setTimeout(() => (document.activeElement as HTMLElement | null)?.blur());
              }
            }}
          />
          {saving && <span className="label">Saving…</span>}
        </span>
        <Explain title="Your profile" label="About your profile">
          Your name and photo show on shifts and reports, so the team knows who's on shift. Tap the photo to
          see it, change it or remove it.
        </Explain>
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
  const me = state.me;
  if (me && !me.owner)
    return (
      <div className="page">
        <div className="page-top">
          <h1 className="headline title-help">
            Settings
            <Explain title="Settings on the team">The owner manages the menu, payments and team.</Explain>
          </h1>
        </div>
        <ProfileCard {...props} />
        <div className="card card-list">
          <Row
            icon={<Repeat size={18} strokeWidth={1.8} />}
            title={businessList(state).length > 1 ? "Switch business" : "Start your own business"}
            onClick={props.onBusinesses}
          />
        </div>
        <div className="card card-pad">
          <button className="btn secondary block" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  if (page === "business") return <BusinessPage {...props} />;
  if (page === "payments") return <PaymentsPage {...props} />;
  if (page === "discounts") return <DiscountsPage {...props} />;
  if (page === "currency") return <CurrencyPage {...props} />;
  if (page === "organizers") return <OrganizersPage {...props} />;
  if (page === "checklist") return <ChecklistPage {...props} />;
  if (page === "team") return <TeamPage {...props} />;
  const businesses = businessList(state).length;
  const methodsOn = s.payments.filter((p) => p.on);
  const discountsOn = s.discounts.filter((d) => d.on).length;
  const waiting = state.pending.length;
  return (
    <div className="page">
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
          detail={businesses > 1 ? String(businesses) : undefined}
          onClick={props.onBusinesses}
        />
      </div>
      <h2 className="group-title">Checkout</h2>
      <ModeCard {...props} />
      <div className="card card-list">
        <Row
          icon={<Coins size={18} strokeWidth={1.8} />}
          title="Payment methods"
          detail={methodsOn.length + " on"}
          onClick={() => onPage("payments")}
        />
        <Row
          icon={<Percent size={18} strokeWidth={1.8} />}
          title="Discounts"
          detail={discountsOn ? discountsOn + " on" : "Off"}
          onClick={() => onPage("discounts")}
        />
        <Row
          icon={<Store size={18} strokeWidth={1.8} />}
          title="Currency and time"
          detail={business.currency + " · " + (business.timeZone.split("/").pop() ?? "").replace(/_/g, " ")}
          onClick={() => onPage("currency")}
        />
      </div>
      <h2 className="group-title">Shifts</h2>
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
          description="Steps to tick before the till opens"
          detail={(s.checklist?.length ?? 0) ? plural(s.checklist!.length, "step") : "Off"}
          onClick={() => onPage("checklist")}
        />
        <Row
          icon={<Ticket size={18} strokeWidth={1.8} />}
          title="Organizers"
          description="The bazaars and markets you join"
          detail={countText(state.organizers?.length ?? 0)}
          onClick={() => onPage("organizers")}
        />
      </div>
      <h2 className="group-title">This phone</h2>
      <div className="card card-list">
        <div className="list-row">
          <span className="grow">Connection</span>
          <span className="record-end row gap-6 sync-status">
            <span
              className={"dot " + (props.online ? (waiting ? "syncing" : "success") : "danger")}
              aria-hidden="true"
            />
            {waiting ? (props.online ? "Syncing " + waiting : "Offline · " + waiting + " to sync") : props.status}
          </span>
        </div>
        <div className="list-row">
          <span className="grow row gap-6">
            Works offline
            <Explain title="Works offline">
              Sales save on this phone first and sync when you're back online.
            </Explain>
          </span>
          <span className="record-end">{props.offlineReady ? "Ready" : "Getting ready"}</span>
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
