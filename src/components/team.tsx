"use client";

import { useState } from "react";
import { joinLink } from "@/lib/join-link";
import { Banknote, Check, ChevronRight, HandPlatter, Link, Plus, Trash2, UserPlus } from "lucide-react";
import type { Member, Role } from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import { roleNames } from "@/lib/team";
import type { SettingsProps } from "./settings";
import { SubPage, useDraft } from "./settings";
import { matches, RecordNoMatch, RecordSearch } from "./records";
import { errorText, Explain, formatMoney, MoneyField, PhotoPicker, Sheet, useFaces, usePin } from "./ui";

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

export function Avatar({
  name,
  id,
  small = false,
  dim = false,
  large = false,
}: {
  name: string;
  /** The member id, to find their profile photo. */
  id?: string;
  small?: boolean;
  dim?: boolean;
  large?: boolean;
}) {
  const faces = useFaces();
  const photo = (id && faces.byId[id]) || faces.byName[name];
  return (
    <span
      className={"avatar" + (small ? " small" : "") + (large ? " large" : "") + (dim ? " dim" : "") + (photo ? " has-photo" : "")}
      aria-hidden="true"
    >
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  );
}

const roleIcons: Record<Role, typeof Banknote> = { cashier: Banknote, server: HandPlatter };

export function RolePicker({
  value,
  onChange,
  allowed = ["cashier", "server"],
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  allowed?: Role[];
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
              onChange(on ? value.filter((x) => x !== r) : [...value, r])
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
  canChangeAccess,
  businessId,
  currency,
  onSave,
  onResend,
  onRemove,
  onClose,
}: {
  member?: Member;
  canChangeAccess: boolean;
  businessId: string;
  currency: string;
  onSave: (input: { name: string; email: string; rate: number; owner?: boolean; photo?: string | null }) => Promise<boolean>;
  onResend?: () => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [photo, setPhoto] = useState(member?.photo);
  const [email, setEmail] = useState(member?.email ?? "");
  const [rate, setRate] = useState(member && member.rate ? amountText(member.rate, currency) : "");
  const [owner, setOwner] = useState(member?.owner ?? false);
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
  const valid = name.trim() && (member || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
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
                  rate: rate.trim() ? parseMoney(rate, currency) : 0,
                  ...(canChangeAccess && owner !== member?.owner ? { owner } : {}),
                  ...(member && photo !== member.photo ? { photo: photo ?? null } : {}),
                }),
              )
            }
          >
            {busy ? "Saving…" : member ? "Save" : "Send invite"}
          </button>
          {onResend && (
            <button className="btn secondary block" disabled={busy} onClick={() => void run(onResend)}>
              Resend invitation email
            </button>
          )}
          {onRemove && (
            <button className="btn ghost danger compact block" disabled={busy} onClick={() => void run(onRemove)}>
              <Trash2 size={16} /> Remove from team
            </button>
          )}
        </>
      }
    >
      {member && (
        <div className="card card-pad">
          <PhotoPicker face value={photo} onChange={setPhoto} label="profile photo" />
        </div>
      )}
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
        {(!member || member.email) && (
          <label className="field">
            {member ? (
              <span>Email they sign in with</span>
            ) : (
              <span className="field-head">
                Email they sign in with
                <Explain title="Their email">
                  They can use their existing Portable POS account and keep any businesses they already own.
                </Explain>
              </span>
            )}
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
      {canChangeAccess && (
        <div className="card card-pad stack gap-14">
          <label className="field">
            <span className="field-head">
              Business access
              <Explain title="Business access">Owners can manage the register, settings, and team, and see pay and profit.</Explain>
            </span>
            <select className="select" value={owner ? "owner" : "member"} onChange={(e) => setOwner(e.target.value === "owner")}>
              <option value="member">Team member</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        </div>
      )}
      <MoneyField
        label="Pay for one shift"
        value={rate}
        onChange={setRate}
        currency={currency}
        help={{
          title: "Pay for one shift",
          body: <p>What they earn each time they join a shift. You can change it for a single shift when you schedule it. They pick cashier or server on each shift.</p>,
        }}
      />
      {onResend && (
        <div className="notice">
          <span className="grow">They join by signing in with the invited email.</span>
          <button
            type="button"
            className="btn small secondary"
            onClick={async () => {
              const url = joinLink(location.origin, businessId);
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
  const business = props.state.business!;
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const withPin = usePin();
  const sorted = [...team].sort((a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name));
  const waiting = team.filter((m) => !m.joined).length;
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const PENDING = "Yet to sign in";
  const filtering = pending && waiting > 0 && waiting < team.length;
  const shown = sorted.filter((m) => (!filtering || !m.joined) && matches(query, m.name, m.email));
  async function act(input: Parameters<SettingsProps["onAction"]>[0], label?: string) {
    const done = await withPin((pin) => props.onAction({ ...input, pin } as typeof input));
    if (done && label) props.onSaved(label);
    return done;
  }
  return (
    <SubPage
      title="Team"
      help={<p>Owners invite people, plan shifts and see pay. Everyone picks cashier or server on each shift they work.</p>}
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
      <RecordSearch
        count={team.length}
        noun="people"
        query={query}
        onQuery={setQuery}
        filters={
          waiting > 0 && waiting < team.length
            ? { label: "Filter", options: [PENDING], value: filtering ? PENDING : null, onChange: (v) => setPending(v === PENDING) }
            : undefined
        }
      />
      {!shown.length && (
        <RecordNoMatch
          query={query}
          onClear={() => {
            setQuery("");
            setPending(false);
          }}
        />
      )}
      {shown.length > 0 && (
        <div className="card card-list">
          {shown.map((m) => (
            <button key={m.id} className="list-row" disabled={!props.online} onClick={() => setEditing(m)}>
              <Avatar id={m.id} name={m.name} dim={!m.joined} />
              <span className="grow stack">
                <span className="ellipsis">
                  {m.name}
                </span>
                <span className="label ellipsis">
                  {m.joined ? (m.owner ? "Owner" : m.email) : "Invite pending for " + m.email}
                </span>
              </span>
              {m.rate > 0 && <span className="label end">{formatMoney(m.rate, business.currency)}</span>}
              <ChevronRight size={18} className="chev" />
            </button>
          ))}
        </div>
      )}
      {editing && (
        <MemberSheet
          member={editing === "new" ? undefined : editing}
          canChangeAccess={editing !== "new" && editing.joined && !editing.primaryOwner && editing.id !== props.state.me?.memberId}
          businessId={business.id}
          currency={business.currency}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === "new"
              ? act({ action: "invite", ...input })
              : act(
                  { action: "member", memberId: editing.id, name: input.name, rate: input.rate, owner: input.owner },
                  "Saved " + input.name,
                ).then(
                  async (done) =>
                    done &&
                    (input.photo === undefined ||
                      (await act({ action: "profile", memberId: editing.id, photo: input.photo }, "Saved " + input.name))),
                )
          }
          onResend={
            editing === "new" || editing.joined || props.demo
              ? undefined
              : () => act({ action: "invite", name: editing.name, email: editing.email, rate: editing.rate })
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
  const { draft, setDraft, bar } = useDraft(props, "Save checklist", "Checklist saved");
  const [text, setText] = useState("");
  const [photoError, setPhotoError] = useState("");
  const list = draft.settings.checklist ?? [];
  const full = list.length >= 30;
  const update = (change: (steps: typeof list) => typeof list) =>
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, checklist: change(current.settings.checklist ?? []) },
    }));
  function add() {
    const value = text.trim();
    if (!value || full) return;
    const step = { id: crypto.randomUUID(), text: value };
    update((steps) => steps.length < 30 ? [...steps, step] : steps);
    setText("");
  }
  return (
    <SubPage
      title="Opening checklist"
      help={<p>Steps the team ticks before the till opens, like setting up the QR stand. Add a photo to show how it should look. Saved steps appear the next time someone opens the till.</p>}
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
              <PhotoPicker
                size="small"
                value={item.image}
                label={"photo for step " + (i + 1)}
                onError={setPhotoError}
                onChange={(image) =>
                  update((steps) => steps.map((step) =>
                    step.id === item.id ? { ...step, image } : step,
                  ))
                }
              />
              <input
                className="inline-input grow"
                aria-label={`Step ${i + 1}`}
                maxLength={120}
                value={item.text}
                onChange={(e) => {
                  const text = e.currentTarget.value;
                  update((steps) => steps.map((step) => step.id === item.id ? { ...step, text } : step));
                }}
              />
              <button
                type="button"
                className="round flat"
                aria-label={"Remove " + item.text}
                onClick={() => update((steps) => steps.filter((step) => step.id !== item.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {photoError && <p className="alert" role="alert">{photoError}</p>}
      <div className="row gap-8">
        <input
          className="input grow"
          maxLength={120}
          aria-label="New step"
          placeholder={list.length ? "Add a step" : "e.g. Count the cash float"}
          value={text}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            add();
          }}
        />
        <button type="button" className="btn secondary compact" onClick={add} disabled={!text.trim() || full}>
          Add step
        </button>
      </div>
      {full && <p className="label">The checklist can hold up to 30 steps.</p>}
      {bar}
    </SubPage>
  );
}
