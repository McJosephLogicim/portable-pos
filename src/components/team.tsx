"use client";

import { useState } from "react";
import { Banknote, Check, ChevronRight, HandPlatter, Link, Plus, Trash2, UserPlus } from "lucide-react";
import type { Member, Role } from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import { roleNames, rolesText } from "@/lib/team";
import type { SettingsProps } from "./settings";
import { SubPage, useDraft } from "./settings";
import { errorText, formatMoney, MoneyField, Sheet, usePin } from "./ui";

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function Avatar({ name, small = false, dim = false }: { name: string; small?: boolean; dim?: boolean }) {
  return (
    <span className={"avatar" + (small ? " small" : "") + (dim ? " dim" : "")} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const roleIcons: Record<Role, typeof Banknote> = { cashier: Banknote, server: HandPlatter };

export function RolePicker({
  value,
  onChange,
  allowed = ["cashier", "server"],
  single = false,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  allowed?: Role[];
  single?: boolean;
}) {
  return (
    <div className="methods" role="group" aria-label="Role">
      {(["cashier", "server"] as Role[]).map((r) => {
        const Icon = roleIcons[r];
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            className="method"
            aria-pressed={on}
            disabled={!allowed.includes(r)}
            onClick={() =>
              onChange(single ? [r] : on ? value.filter((x) => x !== r) : [...value, r])
            }
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            {roleNames[r]}
          </button>
        );
      })}
    </div>
  );
}

function MemberSheet({
  member,
  currency,
  onSave,
  onRemove,
  onClose,
}: {
  member?: Member;
  currency: string;
  onSave: (input: { name: string; email: string; roles: Role[]; rate: number }) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [roles, setRoles] = useState<Role[]>(member?.roles ?? ["cashier"]);
  const [rate, setRate] = useState(member && member.rate ? amountText(member.rate, currency) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
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
  const valid = name.trim() && roles.length && (member || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  return (
    <Sheet
      title={member ? member.name : "Invite someone"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            className="btn block"
            disabled={busy || !valid}
            onClick={() =>
              void run(() =>
                onSave({
                  name: name.trim(),
                  email: email.trim(),
                  roles,
                  rate: rate.trim() ? parseMoney(rate, currency) : 0,
                }),
              )
            }
          >
            {busy ? "Saving…" : member ? "Save" : "Send invite"}
          </button>
          {onRemove && (
            <button className="btn ghost danger compact block" disabled={busy} onClick={() => void run(onRemove)}>
              <Trash2 size={16} /> Remove from team
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
            autoFocus={!member}
            placeholder="e.g. Bea Santos"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!member?.owner && (
          <label className="field">
            <span>Email they sign in with</span>
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="off"
              disabled={Boolean(member)}
              placeholder="bea@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="field">
        <span>What they do</span>
        <RolePicker value={roles} onChange={setRoles} />
        <p className="label" style={{ marginTop: 4 }}>
          {roles.includes("cashier")
            ? "Cashiers run the till: they sell, open and close shifts."
            : roles.length
              ? "Servers see the schedule and join shifts. They don't use the till."
              : "Pick one or both."}
        </p>
      </div>
      <MoneyField label="Pay for one shift" value={rate} onChange={setRate} currency={currency} />
      <p className="label">Used as their salary when they join a shift. You can change it per shift.</p>
      {!member && (
        <div className="notice">
          <span className="grow">They join by signing in with this email. Send them the app link.</span>
          <button
            type="button"
            className="btn small secondary"
            onClick={async () => {
              const url = location.origin;
              try {
                if (navigator.share) await navigator.share({ title: "Portable POS", url });
                else {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                }
              } catch {
                /* the person closed the share sheet */
              }
            }}
          >
            {copied ? <Check size={15} /> : <Link size={15} />} {copied ? "Copied" : "Share link"}
          </button>
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

export function TeamPage(props: SettingsProps) {
  const team = props.state.team ?? [];
  const currency = props.state.business!.currency;
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const withPin = usePin();
  const sorted = [...team].sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name));
  const waiting = team.filter((m) => !m.joined).length;
  async function act(input: Parameters<SettingsProps["onAction"]>[0], label: string) {
    const done = await withPin((pin) => props.onAction({ ...input, pin } as typeof input));
    if (done) props.onSaved(label);
    return done;
  }
  return (
    <SubPage
      title="Team"
      sentence={
        <>
          {team.length} {team.length === 1 ? "person" : "people"}{" "}
          <span className="g">{waiting ? `on the team, ${waiting} yet to sign in.` : "on the team."}</span>
        </>
      }
      onBack={() => props.onPage(null)}
    >
      <button className="btn" disabled={!props.online} onClick={() => setEditing("new")}>
        <UserPlus size={18} /> Invite someone
      </button>
      <div className="card card-list">
        {sorted.map((m) => (
          <button key={m.id} className="list-row" disabled={!props.online} onClick={() => setEditing(m)}>
            <Avatar name={m.name} dim={!m.joined} />
            <span className="grow stack">
              <span className="ellipsis">
                {m.name} {m.owner && <span className="g">· Owner</span>}
              </span>
              <span className="label ellipsis">
                {m.joined ? rolesText(m.roles) : "Invite sent to " + m.email}
              </span>
            </span>
            {m.rate > 0 && <span className="label end">{formatMoney(m.rate, currency)}</span>}
            <ChevronRight size={18} className="chev" />
          </button>
        ))}
      </div>
      <p className="label">
        Only you can invite people, plan shifts and see pay. Cashiers run the till. Servers see the schedule and join open
        shifts.
      </p>
      {editing && (
        <MemberSheet
          member={editing === "new" ? undefined : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === "new"
              ? act({ action: "invite", ...input }, "Invited " + input.name)
              : act(
                  { action: "member", memberId: editing.id, name: input.name, roles: input.roles, rate: input.rate },
                  "Saved " + input.name,
                )
          }
          onRemove={
            editing === "new" || editing.owner
              ? undefined
              : () => act({ action: "removeMember", memberId: editing.id }, "Removed " + editing.name)
          }
        />
      )}
    </SubPage>
  );
}

export function ChecklistPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props);
  const [text, setText] = useState("");
  const list = draft.settings.checklist ?? [];
  const set = (checklist: typeof list) => setDraft({ ...draft, settings: { ...draft.settings, checklist } });
  function add() {
    const value = text.trim();
    if (!value || list.length >= 30) return;
    set([...list, { id: crypto.randomUUID(), text: value }]);
    setText("");
  }
  return (
    <SubPage
      title="Opening checklist"
      sentence={
        list.length ? (
          <>
            {list.length} {list.length === 1 ? "thing" : "things"} <span className="g">to tick before the till opens.</span>
          </>
        ) : (
          <>
            No checklist. <span className="g">Add what has to be ready before the first sale.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      {list.length > 0 && (
        <div className="card card-list">
          {list.map((item, i) => (
            <div className="list-row" key={item.id}>
              <span className="step-num">{i + 1}</span>
              <input
                className="inline-input grow"
                aria-label={`Step ${i + 1}`}
                maxLength={120}
                value={item.text}
                onChange={(e) => set(list.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))}
              />
              <button
                type="button"
                className="round flat"
                aria-label={"Remove " + item.text}
                onClick={() => set(list.filter((x) => x.id !== item.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="row gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input grow"
          maxLength={120}
          aria-label="New step"
          placeholder={list.length ? "Add a step" : "e.g. Count the cash float"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="round" style={{ width: 52, height: 52 }} aria-label="Add step" disabled={!text.trim()}>
          <Plus size={20} />
        </button>
      </form>
      <p className="label">
        Whoever opens the till ticks every step first. The ticked list is kept with the shift.
      </p>
      {bar}
    </SubPage>
  );
}
