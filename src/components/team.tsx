"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/app-brand";
import { inviteLink } from "@/lib/join-link";
import { Banknote, ChevronRight, HandPlatter, Trash2, UserPlus } from "lucide-react";
import type { Member, Role, TeamRosterMember } from "@/lib/types";
import { amountText, parseMoney } from "@/lib/domain";
import { roleNames } from "@/lib/team";
import type { SettingsProps } from "./settings";
import { SubPage, useDraft } from "./settings";
import { AddMenu } from "./add-menu";
import { BulkNamesSheet } from "./bulk-add";
import { matches, RecordNoMatch, RecordSearch, RecordSheet, useRecordSave } from "./records";
import { CopyButton } from "./share";
import { Popo } from "./popo";
import { ConfirmSheet, EmptyState, errorText, Explain, formatMoney, GlossyObject, MoneyField, PhotoPicker, Sheet, useFaces, usePin } from "./ui";
import { blocked } from "@/lib/reject";
import styles from "./operations.module.css";

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
            {...blocked(!allowed.includes(r) && `${roleNames[r]} is unavailable for this assignment.`)}
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
  canChangeName,
  canChangeAccess,
  link,
  currency,
  onSave,
  onResend,
  onRemove,
  onClose,
}: {
  member?: Member;
  canChangeName: boolean;
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
      className={member ? undefined : styles.inviteSheet}
      action={member ? undefined : <Popo pose="team" size={74} className={styles.invitePopo} />}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            className="btn block"
            disabled={busy}
            {...blocked(!name.trim() ? "Enter a name." : !valid && "Enter a valid email address.")}
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
          {link && (
            <CopyButton
              text={link}
              label="Copy invite link"
              icon={<GlossyObject className="action-object" object="inviteLink" />}
              disabled={busy}
              onError={setCopyError}
            />
          )}
          {onResend && (
            <button className="btn secondary block" disabled={busy} onClick={() => void run(onResend)}>
              Resend
            </button>
          )}
          {removeButton}
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
            readOnly={!canChangeName}
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
                  Leave it empty to just share an invite link. With an email, they also get the link by email and can join by signing in with that address. They can use their existing {APP_NAME} account and keep any businesses they already own.
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

function memberAccessLabel({ primaryOwner, owner }: TeamRosterMember, demo = false) {
  if (primaryOwner || (demo && owner)) return "Owner";
  return owner ? "Co-owner" : "Team member";
}

export function TeamPage(props: Pick<SettingsProps, "state" | "online" | "demo" | "onAction" | "onSaved" | "onBack" | "backLabel"> & {
  startAdding?: boolean;
  primaryAction?: ReactNode;
}) {
  const team = props.state.team ?? [];
  const business = props.state.business!;
  const me = props.state.me;
  const roster = props.state.teamRoster ?? [];
  const canManage = !me || me.owner;
  const canLeave = !props.demo && me && (!me.owner || team.some((m) => m.id === me.memberId && !m.primaryOwner));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [editing, setEditing] = useState<Member | "new" | null>(props.startAdding ? "new" : null);
  const canChangeName = !editing || editing === "new" || !editing.primaryOwner || editing.id === me?.memberId;
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
  const sorted = [...team].sort((a, b) =>
    Number(Boolean(b.primaryOwner)) - Number(Boolean(a.primaryOwner)) ||
    Number(b.owner) - Number(a.owner) ||
    a.name.localeCompare(b.name)
  );
  const waiting = sorted.filter((m) => !m.joined);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const PENDING = "Yet to sign in";
  const inTab = pending ? waiting : sorted;
  const shown = inTab.filter((m) => matches(query, m.name, m.email));
  const invite = (
    <button className={`btn${props.primaryAction ? " secondary" : ""}`} onClick={() => setEditing("new")}>
      <UserPlus size={18} /> Invite
    </button>
  );
  async function act(input: Parameters<SettingsProps["onAction"]>[0], label?: string) {
    const done = await withPin((pin) => props.onAction({ ...input, pin } as typeof input));
    if (done && label) props.onSaved(label);
    return done;
  }
  return (
    <SubPage
      title="Team"
      help={<p>Owners invite people, plan shifts and see pay. Everyone picks cashier or server on each shift they work.</p>}
      sentence={canManage ? team.length > 0 && (
        <>
          {team.length} {team.length === 1 ? "person" : "people"}{" "}
          <span className="g">{waiting.length ? `on the team, ${waiting.length} yet to sign in.` : "on the team."}</span>
        </>
      ) : business.name}
      onBack={props.onBack}
      backLabel={props.backLabel}
    >
      {props.primaryAction}
      {canManage && (
        <>
          {inTab.length > 0 && invite}
          <RecordSearch
            count={team.length}
            noun="people"
            query={query}
            onQuery={setQuery}
            filters={{ label: "Team members", options: [PENDING], value: pending ? PENDING : null, onChange: (v) => setPending(v === PENDING) }}
          />
          {!inTab.length && (
            <EmptyState
              pose={pending ? "connect" : "team"}
              object="inviteLink"
              title={pending ? "No pending invites" : "No team members yet"}
              text={pending ? "Invites appear here until someone joins." : "Invite teammates to work shifts and use the till."}
            >
              {invite}
            </EmptyState>
          )}
          {inTab.length > 0 && !shown.length && (
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
                <button key={m.id} className="list-row" onClick={() => setEditing(m)}>
                  <Avatar id={m.id} name={m.name} dim={!m.joined} />
                  <span className="grow stack">
                    <span className="ellipsis">
                      {m.name}
                    </span>
                    <span className="label ellipsis">
                      {m.joined
                        ? (!m.owner && m.email) || memberAccessLabel(m, props.demo)
                        : m.email ? "Invite pending for " + m.email : "Invite link not used yet"}
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
              canChangeName={canChangeName}
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
                      { action: "member", memberId: editing.id, ...(canChangeName ? { name: input.name } : {}), rate: input.rate, owner: input.owner },
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
        </>
      )}
      {!canManage && !roster.length && (
        <EmptyState pose="team" title="No team members to show" text="Your teammates will appear here." />
      )}
      {!canManage && roster.length > 0 && (
        <div className="card card-list" role="list" aria-label="Team roster">
          {roster.map((person) => (
            <div className="list-row" role="listitem" key={person.id}>
              <Avatar id={person.id} name={person.name} />
              <span className="grow stack">
                <span className="ellipsis">
                  {person.name}{person.id === me.memberId && <span className="label"> (you)</span>}
                </span>
                <span className="label">{memberAccessLabel(person)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {canLeave && (
        <button type="button" className="btn ghost danger block" aria-haspopup="dialog" onClick={() => setConfirmLeave(true)}>
          Leave team
        </button>
      )}
      {confirmLeave && canLeave && (
        <ConfirmSheet
          title="Leave this team?"
          detail={`You’ll lose access to ${business.name} and be removed from shifts that haven’t started. You’ll need a new invite to rejoin.${props.online ? "" : " This will take effect when this phone reconnects."}`}
          confirmLabel="Leave team"
          onClose={() => setConfirmLeave(false)}
          onConfirm={() => props.onAction({ action: "leaveTeam", businessId: business.id, memberId: me.memberId })}
        />
      )}
    </SubPage>
  );
}

function ChecklistStepSheet({ onAdd, onClose }: { onAdd: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const { busy, error, run } = useRecordSave(onClose);
  const ready = Boolean(text.trim());
  function save() {
    if (!ready) return;
    void run(async () => {
      onAdd(text.trim());
      return true;
    });
  }
  return (
    <RecordSheet
      noun="checklist step"
      editing={false}
      busy={busy}
      error={error}
      saveBlocked={!ready && "Enter a checklist step."}
      onSave={save}
      onClose={onClose}
    >
      <label className="field">
        <span>Step</span>
        <input
          className="input"
          maxLength={120}
          placeholder="e.g. Count the cash float"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            save();
          }}
        />
      </label>
    </RecordSheet>
  );
}

export function ChecklistPage(props: SettingsProps) {
  const { draft, setDraft, bar } = useDraft(props, { savedLabel: "Checklist saved", hasAddAction: true });
  const [adding, setAdding] = useState<"single" | "bulk" | null>(null);
  const [photoError, setPhotoError] = useState("");
  const list = draft.settings.checklist ?? [];
  const [removing, setRemoving] = useState<(typeof list)[number] | null>(null);
  const full = list.length >= 30;
  const update = (change: (steps: typeof list) => typeof list) =>
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, checklist: change(current.settings.checklist ?? []) },
    }));
  function add(names: string[]) {
    const added = names.map((text) => ({ id: crypto.randomUUID(), text }));
    update((steps) => [...steps, ...added]);
  }
  const addStep = (
    <AddMenu
      singleLabel="Add a step"
      blockedReason={full && "The checklist can hold up to 30 steps."}
      onSingle={() => setAdding("single")}
      onBulk={() => setAdding("bulk")}
    />
  );
  return (
    <SubPage
      title="Opening checklist"
      help={<p>Steps the team ticks before the till opens, like setting up the QR stand. Add a photo to show how it should look. Saved steps appear the next time someone opens the till.</p>}
      sentence={list.length > 0 && (
        <>
          {list.length} {list.length === 1 ? "thing" : "things"} <span className="g">to tick before the till opens.</span>
        </>
      )}
      sentenceAction={list.length > 0 && addStep}
      onBack={props.onBack}
      backLabel={props.backLabel}
    >
      {!list.length && (
        <EmptyState pose="plan" object="checklistClipboard" title="No checklist yet" text="Add what has to be ready before the first sale.">
          {addStep}
        </EmptyState>
      )}
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
      {full && <p className="label">The checklist can hold up to 30 steps.</p>}
      {bar}
      {adding === "single" && <ChecklistStepSheet onAdd={(name) => add([name])} onClose={() => setAdding(null)} />}
      {adding === "bulk" && (
        <BulkNamesSheet
          noun="step"
          label="Checklist steps, one per line"
          maxLength={120}
          limit={30 - list.length}
          onClose={() => setAdding(null)}
          onSave={async (names) => {
            add(names);
            return true;
          }}
        />
      )}
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
