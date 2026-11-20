"use client";

import { useEffect, useRef, useState } from "react";
import { inviteLink } from "@/lib/join-link";
import { Banknote, ChevronRight, HandPlatter, Plus, Trash2, UserPlus } from "lucide-react";
import type { Member, Role } from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import { roleNames } from "@/lib/team";
import type { SettingsProps } from "./settings";
import { SubPage, useDraft } from "./settings";
import { matches, RecordNoMatch, RecordSearch } from "./records";
import { CopyButton } from "./share";
import { ConfirmSheet, errorText, Explain, formatMoney, MoneyField, PhotoPicker, Sheet, useFaces, usePin } from "./ui";
import { blocked, OFFLINE } from "@/lib/reject";

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
  link,
  currency,
  onSave,
  onResend,
  onRemove,
  onClose,
}: {
  member?: Member;
  canChangeAccess: boolean;
  /** A pending invite's link. */
  link?: string;
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
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
  const valid = name.trim() && (member || !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const removeButton = onRemove && (
    <button className="btn ghost danger compact block" disabled={busy} onClick={() => setConfirmRemove(true)}>
      <Trash2 size={16} /> {member?.joined ? "Remove" : "Revoke"}
    </button>
  );
  return (
    <>
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
            {busy ? "Saving…" : member ? "Save" : email.trim() ? "Invite" : "Create"}
          </button>
          {onResend && (
            <button className="btn secondary block" disabled={busy} onClick={() => void run(onResend)}>
              Resend
            </button>
          )}
          {!onResend && removeButton}
          {link && <CopyButton text={link} label="Copy invite link" disabled={busy} onError={setCopyError} />}
          {onResend && removeButton}
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
                Email (optional)
                <Explain title="Their email">
                  Leave it empty to just share an invite link. With an email, they also get the link by email and can join by signing in with that address. They can use their existing Portable POS account and keep any businesses they already own.
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
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {copyError && link && (
        <div className="stack gap-8">
          <p className="alert" role="alert">{copyError}</p>
          <pre className="schedule-text">{link}</pre>
        </div>
      )}
    </Sheet>
    {confirmRemove && member && onRemove && (
      <ConfirmSheet
        title={member.joined ? "Remove team member?" : "Cancel invitation?"}
        detail={member.joined
          ? `${member.name} will lose access to this business and be removed from upcoming shifts.`
          : `${member.name}’s invitation link will stop working.`}
        confirmLabel={member.joined ? "Remove" : "Revoke"}
        onClose={() => setConfirmRemove(false)}
        onConfirm={async () => {
          const done = await onRemove();
          if (done) onClose();
          return done;
        }}
      />
    )}
    </>
  );
}

export function TeamPage(props: SettingsProps) {
  const team = props.state.team ?? [];
  const business = props.state.business!;
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  // After an invite, open the new person so their link is ready to share.
  const invited = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!invited.current) return;
    const added = team.find((m) => !invited.current!.has(m.id) && !m.joined);
    if (added) {
      invited.current = null;
      setEditing(added);
    }
  }, [team]);
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
      <button className="btn" {...blocked(!props.online && OFFLINE)} onClick={() => setEditing("new")}>
        <UserPlus size={18} /> Invite
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
            <button key={m.id} className="list-row" {...blocked(!props.online && OFFLINE)} onClick={() => setEditing(m)}>
              <Avatar id={m.id} name={m.name} dim={!m.joined} />
              <span className="grow stack">
                <span className="ellipsis">
                  {m.name}
                </span>
                <span className="label ellipsis">
                  {m.joined ? (m.owner ? "Owner" : m.email) : m.email ? "Invite pending for " + m.email : "Invite link not used yet"}
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
          key={editing === "new" ? "new" : editing.id}
          member={editing === "new" ? undefined : editing}
          canChangeAccess={editing !== "new" && editing.joined && !editing.primaryOwner && editing.id !== props.state.me?.memberId}
          link={editing !== "new" && editing.inviteCode && !props.demo ? inviteLink(location.origin, editing.inviteCode) : undefined}
          currency={business.currency}
          onClose={() => setEditing((current) => (current === editing ? null : current))}
          onSave={(input) =>
            editing === "new"
              ? ((invited.current = new Set(team.map((m) => m.id))),
                act({ action: "invite", ...input }).then((done) => {
                  if (!done) invited.current = null;
                  return done;
                }))
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
            editing === "new" || editing.joined || !editing.email || props.demo
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
  const [removing, setRemoving] = useState<(typeof list)[number] | null>(null);
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
                onClick={() => setRemoving(item)}
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
        <button type="button" className="btn secondary compact" onClick={add} {...blocked(full ? "The checklist can hold up to 30 steps." : !text.trim() && "Type the step first.")}>
          Add
        </button>
      </div>
      {full && <p className="label">The checklist can hold up to 30 steps.</p>}
      {bar}
      {removing && (
        <ConfirmSheet
          title="Remove checklist step?"
          detail={`“${removing.text}” will be removed when you save the checklist.`}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => update((steps) => steps.filter((step) => step.id !== removing.id))}
        />
      )}
    </SubPage>
  );
}
