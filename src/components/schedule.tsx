"use client";

import { useMemo, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Minus,
  Plus,
  Trash2,
  Trophy,
  Share2,
  Copy,
  X,
} from "lucide-react";
import type { OwnerAction } from "@/lib/demo";
import { amountText, parseMoney } from "@/lib/domain";
import { slugId } from "@/lib/settings";
import {
  addDays,
  bookingProfit,
  dayOf,
  daysBetween,
  rolesOf,
  salesByBooking,
  shiftRole,
  shiftRoleNames,
  shiftTimes,
  timeOf,
  weekday,
  type BookingInput,
} from "@/lib/team";
import type {
  Booking,
  Member,
  Organizer,
  Place,
  RegisterState,
  Role,
  ShiftRole,
  StaffSlot,
  Tag,
} from "@/lib/types";
import { SuggestInput } from "./combobox";
import { Leaderboards, ShiftSales } from "./insights";
import type { SalesFocus } from "./sales";
import { LocationPicker, MapPreview, mapsLink } from "./places";
import { bookingTitle } from "./shift";
import { scheduleText } from "@/lib/report";
import { Avatar, RolePicker } from "./team";
import { buzz, centerOf, errorText, formatMoney, Money, MoneyField, progressStyle, Sheet, useCelebrate, usePin } from "./ui";

type Act = (input: OwnerAction) => Promise<void>;

export interface ScheduleProps {
  state: RegisterState;
  online: boolean;
  demo: boolean;
  sharedSchedule?: { bookingId: string | null } | null;
  onAction: Act;
  onSaved: (text: string) => void;
  onSales: (focus: SalesFocus) => void;
}

const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];

function useFormats(timeZone: string) {
  return useMemo(
    () => ({
      time: new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat("en", { timeZone, weekday: "short", month: "short", day: "numeric" }),
      long: new Intl.DateTimeFormat("en", { timeZone, weekday: "long", month: "long", day: "numeric" }),
    }),
    [timeZone],
  );
}

/** "Sat 22" style, for a plain "YYYY-MM-DD" date. */
function plainDay(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
}

function seatsOpen(b: Booking) {
  return Math.max(0, b.seats - b.staff.length);
}

/* ---------- calendar ---------- */

function MonthCalendar({
  month,
  selected,
  today,
  marks,
  onMonth,
  onSelect,
}: {
  month: string; // YYYY-MM-01
  selected: string;
  today: string;
  marks: Map<string, { count: number; open: boolean; mine: boolean }>;
  onMonth: (month: string) => void;
  onSelect: (day: string) => void;
}) {
  const first = weekday(month);
  const start = addDays(month, -first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const rows = days[35].slice(0, 7) === month.slice(0, 7) ? 6 : 5;
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    onMonth(d.toISOString().slice(0, 10));
  };
  return (
    <div className="card calendar">
      <div className="between cal-head">
        <span className="strong">{plainDay(month, { month: "long", year: "numeric" })}</span>
        <span className="row gap-4">
          <button type="button" className="round flat" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={19} />
          </button>
          <button type="button" className="round flat" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight size={19} />
          </button>
        </span>
      </div>
      <div className="cal-grid" role="grid" aria-label="Shifts by day">
        {weekdayLetters.map((d, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.slice(0, rows * 7).map((day) => {
          const mark = marks.get(day);
          const outside = day.slice(0, 7) !== month.slice(0, 7);
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              className={
                "cal-day" +
                (outside ? " outside" : "") +
                (day === today ? " today" : "") +
                (mark?.mine ? " mine" : "")
              }
              aria-selected={day === selected}
              aria-label={
                plainDay(day, { weekday: "long", month: "long", day: "numeric" }) +
                (mark ? `, ${mark.count} ${mark.count === 1 ? "shift" : "shifts"}${mark.open ? ", open seats" : ""}` : "")
              }
              onClick={() => onSelect(day)}
            >
              <span className="cal-num">{Number(day.slice(8))}</span>
              <span className="cal-dots" aria-hidden="true">
                {mark &&
                  Array.from({ length: Math.min(3, mark.count) }, (_, i) => (
                    <i key={i} className={mark.open && i === 0 ? "open" : ""} />
                  ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- a shift in a list ---------- */

function BookingCard({
  b,
  state,
  sales,
  onOpen,
}: {
  b: Booking;
  state: RegisterState;
  sales?: number;
  onOpen: () => void;
}) {
  const business = state.business!;
  const f = useFormats(business.timeZone);
  const me = state.me;
  const mine = b.staff.some((s) => s.memberId === me?.memberId);
  const open = seatsOpen(b);
  const past = Date.parse(b.endsAt) < Date.now();
  const p = me?.owner && sales !== undefined ? bookingProfit({ ...b, sales }) : null;
  return (
    <button type="button" className={"card booking" + (past ? " past" : "")} onClick={onOpen}>
      <span className="booking-time">
        <span className="strong">{f.time.format(new Date(b.startsAt))}</span>
        <span className="label">{f.time.format(new Date(b.endsAt))}</span>
      </span>
      <span className="grow stack gap-4">
        <span className="strong ellipsis">{bookingTitle(b)}</span>
        <span className="label ellipsis">
          {[b.place && b.event ? b.place.name : "", b.organizer?.name].filter(Boolean).join(" · ") || "No location yet"}
        </span>
        <span className="row gap-6 faces">
          {b.staff.slice(0, 4).map((s) => (
            <Avatar key={s.memberId} id={s.memberId} name={s.name} small />
          ))}
          {Array.from({ length: Math.min(3, open) }, (_, i) => (
            <span key={i} className="avatar small seat" aria-hidden="true" />
          ))}
          <span className="label">
            {mine ? "You're on" : open ? `${open} open` : "Full"}
          </span>
        </span>
      </span>
      {p && past && (
        <span className={"pill" + (p.net >= 0 ? " good" : " bad")}>
          {p.net >= 0 ? "+" : "−"}
          {formatMoney(Math.abs(p.net), business.currency)}
        </span>
      )}
      {!past && open > 0 && !mine && <span className="pill">Open</span>}
    </button>
  );
}

/* ---------- people ---------- */

function PersonPicker({
  team,
  currency,
  title,
  exclude,
  roleHint,
  onPick,
  onClose,
}: {
  team: Member[];
  currency: string;
  title: string;
  exclude: string[];
  roleHint?: ShiftRole;
  onPick: (member: Member, role: ShiftRole) => void;
  onClose: () => void;
}) {
  const [member, setMember] = useState<Member | null>(null);
  const [role, setRole] = useState<Role[]>([]);
  const people = team.filter((m) => !exclude.includes(m.id));
  return (
    <Sheet
      title={member ? member.name : title}
      onClose={onClose}
      footer={
        member && (
          <button className="btn block" disabled={!role.length} onClick={() => onPick(member, shiftRole(role))}>
            {role.length ? "Add as " + shiftRoleNames[shiftRole(role)].toLowerCase() : "Pick a role"}
          </button>
        )
      }
    >
      {member ? (
        <div className="field">
          <span>Working as</span>
          <RolePicker value={role} onChange={setRole} />
          <p className="label">Pick both if they run the till and serve.</p>
        </div>
      ) : people.length ? (
        <div className="card card-list">
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              className="list-row"
              onClick={() => {
                buzz.tap();
                setMember(m);
                setRole(rolesOf(roleHint ?? "cashier"));
              }}
            >
              <Avatar id={m.id} name={m.name} dim={!m.joined} />
              <span className="grow stack">
                <span className="ellipsis">{m.owner ? m.name + " (you)" : m.name}</span>
                <span className="label">
                  {m.rate ? formatMoney(m.rate, currency) + " a shift" : "No set pay"}
                  {m.joined ? "" : " · invite pending"}
                </span>
              </span>
              <ChevronRight size={18} className="chev" />
            </button>
          ))}
        </div>
      ) : (
        <p className="label">Everyone on the team is already on this shift. Invite more people in Settings › Team.</p>
      )}
    </Sheet>
  );
}

const roleNotes: Record<ShiftRole, string> = {
  cashier: "Runs the till: sells, opens and closes it.",
  server: "Serves and preps. Someone else runs the till.",
  both: "Runs the till and serves.",
};

/** Pick what someone does on a shift: cashier, server or both. */
function RoleSheet({
  title,
  start,
  action,
  onSave,
  onClose,
}: {
  title: string;
  start: Role[];
  action: (role: ShiftRole) => string;
  onSave: (role: ShiftRole, from: Element) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>(start);
  const role = shiftRole(roles);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button className="btn block" disabled={!roles.length} onClick={(e) => onSave(role, e.currentTarget)}>
          {roles.length ? action(role) : "Pick a role"}
        </button>
      }
    >
      <div className="field">
        <span>Working as</span>
        <RolePicker value={roles} onChange={setRoles} />
      </div>
      <p className="muted">{roles.length ? roleNotes[role] : "Pick cashier, server or both."}</p>
    </Sheet>
  );
}

/* ---------- details ---------- */

function BookingSheet({
  booking: b,
  props,
  sales,
  onEdit,
  onClose,
}: {
  booking: Booking;
  props: ScheduleProps;
  sales?: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { state, online } = props;
  const business = state.business!;
  const currency = business.currency;
  const me = state.me!;
  const f = useFormats(business.timeZone);
  const withPin = usePin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<{ replace?: StaffSlot } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState<StaffSlot | null>(null);
  const mine = b.staff.find((s) => s.memberId === me.memberId);
  const open = seatsOpen(b);
  const started = Date.parse(b.startsAt) <= Date.now();
  const over = Date.parse(b.endsAt) <= Date.now();
  const p = me.owner ? bookingProfit({ ...b, sales: sales ?? 0 }) : null;
  const team = state.team ?? [];
  const joinable = !mine && open > 0 && !over;
  const [joining, setJoining] = useState(false);
  const [roleFor, setRoleFor] = useState<StaffSlot | null>(null);
  const celebrate = useCelebrate();
  const [switching, setSwitching] = useState(false);
  const tills = useMemo(
    () => state.shifts.filter((s) => s.bookingId === b.id).map((s) => s.id),
    [state.shifts, b.id],
  );

  async function run(input: OwnerAction, label: string, owner = true, from?: Element | null) {
    setBusy(true);
    setError("");
    try {
      const done = owner
        ? await withPin((pin) => props.onAction({ ...input, pin } as OwnerAction))
        : (await props.onAction(input), true);
      if (done) {
        props.onSaved(label);
        if (from) celebrate(centerOf(from));
        else buzz.tick();
      }
      return done;
    } catch (e) {
      setError(errorText(e));
      buzz.error();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        title={bookingTitle(b)}
        onClose={onClose}
        busy={busy}
        action={
          me.owner && (
            <button className="btn small secondary" disabled={!online || busy} onClick={onEdit}>
              Edit
            </button>
          )
        }
        footer={
          !me.owner &&
          (mine ? (
            !over && (
              <div className="grid-2">
                <button className="btn block" disabled={!online || busy} onClick={() => setSwitching(true)}>
                  Change role
                </button>
                <button
                  className="btn secondary block"
                  disabled={!online || busy || started}
                  onClick={() => void run({ action: "leave", bookingId: b.id, memberId: me.memberId }, "You left the shift", false)}
                >
                  {started ? "Started" : "Leave"}
                </button>
              </div>
            )
          ) : joinable ? (
            <button className="btn block" disabled={!online || busy} onClick={() => setJoining(true)}>
              Join this shift
            </button>
          ) : null)
        }
      >
        <div className="stack gap-4">
          <p className="strong">{f.long.format(new Date(b.startsAt))}</p>
          <p className="label">
            {f.time.format(new Date(b.startsAt))} to {f.time.format(new Date(b.endsAt))}
            {b.organizer ? " · " + b.organizer.name : ""}
          </p>
        </div>
        {b.place && (
          <div className="card place-card">
            {b.place.lat !== undefined && b.place.lon !== undefined && (
              <MapPreview lat={b.place.lat} lon={b.place.lon} height={140} />
            )}
            <a className="row gap-10 place-meta" href={mapsLink(b.place)} target="_blank" rel="noreferrer">
              <MapPin size={18} strokeWidth={1.8} />
              <span className="grow stack">
                <span className="ellipsis">{b.place.name}</span>
                {b.place.address && <span className="label ellipsis">{b.place.address}</span>}
              </span>
              <span className="label">Directions</span>
            </a>
          </div>
        )}

        <div className="stack gap-10">
          <p className="group-title">
            People · {b.staff.length} of {b.seats}
          </p>
          <div className="card card-list">
            {b.staff.map((s) => (
              <div
                className="list-row"
                key={s.memberId}
                role={me.owner ? "button" : undefined}
                tabIndex={me.owner ? 0 : undefined}
                onClick={me.owner && online && !busy ? () => setManaging(s) : undefined}
              >
                <Avatar id={s.memberId} name={s.name} />
                <span className="grow stack">
                  <span className="ellipsis">
                    {s.memberId === me.memberId ? s.name + " (you)" : s.name}
                  </span>
                  <span className="label">
                    {shiftRoleNames[s.role]}
                    {s.salary !== undefined ? " · " + formatMoney(s.salary, currency) : ""}
                  </span>
                </span>
                {me.owner && <ChevronRight size={18} className="chev" />}
              </div>
            ))}
            {Array.from({ length: open }, (_, i) => (
              <div className="list-row" key={"open" + i}>
                <span className="avatar seat" aria-hidden="true" />
                <span className="grow g">Open seat</span>
                {me.owner && (
                  <button
                    type="button"
                    className="btn small secondary"
                    disabled={!online || busy}
                    onClick={() => setPicking({})}
                  >
                    Assign
                  </button>
                )}
              </div>
            ))}
            {me.owner && !open && (
              <button type="button" className="list-row" disabled={!online || busy} onClick={() => setPicking({})}>
                <span className="avatar seat" aria-hidden="true">
                  <Plus size={16} />
                </span>
                <span className="grow">Add someone</span>
              </button>
            )}
          </div>
        </div>

        {b.quota > 0 && (
          <div className="tile">
            <span className="between">
              <span className="label">Quota</span>
              {p?.hit && (
                <span className="pill good">
                  <Trophy size={13} /> Hit
                </span>
              )}
            </span>
            <span className="row gap-6">
              <Money value={b.quota} currency={currency} className="tile-num" />
            </span>
            {p && (
              <span className="meter" aria-label={`${Math.min(100, Math.round((p.sales / b.quota) * 100))}% of quota`}>
                <i style={progressStyle(Math.min(100, (p.sales / b.quota) * 100))} />
              </span>
            )}
            <span className="micro">
              {b.incentive
                ? `${formatMoney(b.incentive, currency)} each when sales reach it.`
                : "No incentive set."}
            </span>
          </div>
        )}

        {p && (
          <div className="stack gap-10">
            <p className="group-title">{over ? "How it did" : started ? "So far" : "Break-even"}</p>
            <div className="card card-list">
              <div className="list-row">
                <span className="grow">Sales</span>
                <Money value={p.sales} currency={currency} />
              </div>
              <div className="list-row">
                <span className="grow">Rent</span>
                <Money value={-p.rent} currency={currency} sign />
              </div>
              <div className="list-row">
                <span className="grow">Salaries</span>
                <Money value={-p.salaries} currency={currency} sign />
              </div>
              {p.hit && (
                <div className="list-row">
                  <span className="grow">Incentives · {b.staff.length} people</span>
                  <Money value={-p.incentives} currency={currency} sign />
                </div>
              )}
              <div className="list-row">
                <span className="grow strong">
                  {!started && !p.sales ? "Sales needed to cover costs" : p.net >= 0 ? "Profit" : "Loss"}
                </span>
                {!started && !p.sales ? (
                  <Money value={p.costs} currency={currency} className="strong" />
                ) : (
                  <span className={"row gap-6 strong" + (p.net < 0 ? " danger" : "")}>
                    <span className={"dot " + (p.net >= 0 ? "success" : "danger")} />
                    <Money value={p.net} currency={currency} />
                  </span>
                )}
              </div>
            </div>
            <p className="label">
              Sales come from tills opened for this shift. Cost of goods isn't counted.
            </p>
          </div>
        )}

        <ShiftSales
          state={state}
          shiftIds={tills}
          menu={state.menu}
          currency={currency}
          label={bookingTitle(b)}
          onSales={(focus) => {
            onClose();
            props.onSales(focus);
          }}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {me.owner &&
          (confirmDelete ? (
            <div className="notice">
              <span className="grow">Delete this shift for everyone?</span>
              <button className="btn small secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                className="btn small"
                disabled={busy}
                onClick={async () => {
                  if (await run({ action: "deleteBooking", bookingId: b.id }, "Shift deleted")) onClose();
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <button className="btn ghost danger compact" disabled={!online || busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> Delete shift
            </button>
          ))}
      </Sheet>
      {managing && (
        <Sheet
          title={managing.name}
          onClose={() => setManaging(null)}
          footer={
            <>
              {managing.memberId !== me.memberId && (
                <button
                  className="btn block"
                  onClick={() => {
                    const s = managing;
                    setManaging(null);
                    void run(
                      {
                        action: "assign",
                        bookingId: b.id,
                        memberId: me.memberId,
                        role: s.role,
                        replace: s.memberId,
                      },
                      "You took over from " + s.name,
                    );
                  }}
                >
                  Take over this shift
                </button>
              )}
              <button
                className="btn secondary block"
                onClick={() => {
                  setRoleFor(managing);
                  setManaging(null);
                }}
              >
                Change role
              </button>
              <button
                className="btn secondary block"
                onClick={() => {
                  setPicking({ replace: managing });
                  setManaging(null);
                }}
              >
                Give it to someone else
              </button>
              <button
                className="btn ghost danger compact block"
                onClick={() => {
                  const s = managing;
                  setManaging(null);
                  void run({ action: "leave", bookingId: b.id, memberId: s.memberId }, s.name + " is off the shift");
                }}
              >
                Take {managing.memberId === me.memberId ? "yourself" : managing.name.split(" ")[0]} off
              </button>
            </>
          }
        >
          <p className="label">
            {shiftRoleNames[managing.role]}
            {managing.salary !== undefined ? " · " + formatMoney(managing.salary, currency) + " for this shift" : ""}.{" "}
            {managing.memberId !== me.memberId
              ? "Taking over puts you in their seat, at your own pay."
              : ""}
          </p>
        </Sheet>
      )}
      {switching && mine && (
        <RoleSheet
          title="Your role"
          start={rolesOf(mine.role)}
          onClose={() => setSwitching(false)}
          action={(r) => (r === mine.role ? "Keep " + shiftRoleNames[r].toLowerCase() : "Switch to " + shiftRoleNames[r].toLowerCase())}
          onSave={(role, from) => {
            setSwitching(false);
            if (role === mine.role) return;
            void run({ action: "role", bookingId: b.id, memberId: me.memberId, role }, "You're " + shiftRoleNames[role].toLowerCase() + " on this shift", false, from);
          }}
        />
      )}
      {joining && (
        <RoleSheet
          title="Join this shift"
          start={me.roles.length ? me.roles : ["cashier"]}
          onClose={() => setJoining(false)}
          action={(r) => "Join as " + shiftRoleNames[r].toLowerCase()}
          onSave={(role, from) => {
            setJoining(false);
            void run({ action: "join", bookingId: b.id, role }, "You're on the shift", false, from);
          }}
        />
      )}
      {roleFor && (
        <RoleSheet
          title={roleFor.name}
          start={rolesOf(roleFor.role)}
          onClose={() => setRoleFor(null)}
          action={(r) => "Make " + shiftRoleNames[r].toLowerCase()}
          onSave={(role) => {
            const s = roleFor;
            setRoleFor(null);
            if (role === s.role) return;
            void run({ action: "role", bookingId: b.id, memberId: s.memberId, role }, `${s.name} is now ${shiftRoleNames[role].toLowerCase()}`);
          }}
        />
      )}
      {picking && (
        <PersonPicker
          team={team}
          currency={state.business!.currency}
          title={picking.replace ? "Swap " + picking.replace.name + " for" : "Assign someone"}
          exclude={b.staff.map((s) => s.memberId)}
          roleHint={picking.replace?.role}
          onClose={() => setPicking(null)}
          onPick={async (m, role) => {
            setPicking(null);
            await run(
              { action: "assign", bookingId: b.id, memberId: m.id, role, replace: picking.replace?.memberId },
              picking.replace ? `${m.name} replaces ${picking.replace.name}` : `${m.name} is on the shift`,
            );
          }}
        />
      )}
    </>
  );
}

/* ---------- create and edit ---------- */

interface Draft {
  day: string;
  until: string;
  weekdays: number[];
  start: string;
  end: string;
  place: Place | null;
  /** Typed or picked. A name that isn't on the list yet is added when the shift saves. */
  organizer: string;
  event: string;
  seats: number;
  staff: { memberId: string; name: string; role: ShiftRole; salary: string }[];
  rent: string;
  quota: string;
  incentive: string;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Turns the typed organizer and event into tags. Names already on the list are reused;
 * new ones are added to it.
 */
function resolveOrganizer(list: Organizer[], d: Pick<Draft, "organizer" | "event">, booking?: Booking) {
  let organizers = list;
  const ids = () => organizers.flatMap((o) => [o.id, ...o.events.map((e) => e.id)]);
  const name = d.organizer.trim().slice(0, 80);
  const eventName = d.event.trim().slice(0, 80);
  if (!name) {
    if (eventName) throw Error("Type the organizer of " + eventName + " too.");
    return { organizers, organizer: null, event: null };
  }
  let found = organizers.find((o) => same(o.name, name));
  // A shift keeps an organizer that was since removed from the list, unless it's retyped.
  if (!found && booking?.organizer && same(booking.organizer.name, name)) {
    const keepEvent = booking.event && same(booking.event.name, eventName) ? booking.event : null;
    if (keepEvent || !eventName) return { organizers, organizer: booking.organizer, event: keepEvent };
  }
  if (!found) {
    found = { id: slugId(name, ids()), name, events: [] };
    organizers = [...organizers, found];
  }
  const organizer: Tag = { id: found.id, name: found.name };
  if (!eventName) return { organizers, organizer, event: null };
  let event = found.events.find((e) => same(e.name, eventName));
  if (!event) {
    event = { id: slugId(eventName, ids()), name: eventName };
    const added = { ...found, events: [...found.events, event] };
    organizers = organizers.map((o) => (o.id === found!.id ? added : o));
  }
  return { organizers, organizer, event: { id: event.id, name: event.name } };
}

function BookingEditor({
  booking,
  bulk = false,
  props,
  defaultDay,
  onClose,
}: {
  booking?: Booking;
  bulk?: boolean;
  props: ScheduleProps;
  defaultDay: string;
  onClose: () => void;
}) {
  const { state } = props;
  const business = state.business!;
  const zone = business.timeZone;
  const currency = business.currency;
  const team = state.team ?? [];
  const withPin = usePin();
  const organizers = state.organizers ?? [];
  const money = (v?: number) => (v ? amountText(v, currency).replace(/\.0+$/, "") : "");
  const [d, setD] = useState<Draft>(() => {
    const last = [...(state.bookings ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
    const base = booking ?? last;
    return {
      day: booking ? dayOf(booking.startsAt, zone) : defaultDay,
      until: addDays(defaultDay, 6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: base ? timeOf(base.startsAt, zone) : "10:00",
      end: base ? timeOf(base.endsAt, zone) : "20:00",
      place: booking ? booking.place : null,
      organizer: booking?.organizer?.name ?? "",
      event: booking?.event?.name ?? "",
      seats: booking?.seats ?? base?.seats ?? 2,
      staff: (booking?.staff ?? []).map((s) => ({ ...s, salary: money(s.salary) })),
      rent: money(booking?.rent),
      quota: money(booking?.quota),
      incentive: money(booking?.incentive),
    };
  });
  const [locating, setLocating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [staffing, setStaffing] = useState<string | null>(null);
  const celebrate = useCelebrate();
  const staffed = d.staff.find((x) => x.memberId === staffing);
  const setStaff = (memberId: string, patch: Partial<Draft["staff"][number]>) =>
    setD((x) => ({ ...x, staff: x.staff.map((y) => (y.memberId === memberId ? { ...y, ...patch } : y)) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const organizer = organizers.find((o) => same(o.name, d.organizer));
  const days = bulk ? daysBetween(d.day, d.until, d.weekdays) : [d.day];
  const recent = useMemo(() => {
    const seen = new Map<string, Place>();
    for (const b of [...(state.bookings ?? [])].reverse()) if (b.place) seen.set(b.place.name, b.place);
    return [...seen.values()].slice(0, 8);
  }, [state.bookings]);

  function parse(v: string) {
    return v.trim() ? parseMoney(v, currency) : 0;
  }

  async function save(from?: Element) {
    setBusy(true);
    setError("");
    try {
      const staff = d.staff.map((s) => ({ memberId: s.memberId, name: s.name, role: s.role, salary: parse(s.salary) }));
      if (staff.length > d.seats) throw Error("More people than seats. Add a seat or take someone off.");
      const rent = parse(d.rent);
      const quota = parse(d.quota);
      const incentive = parse(d.incentive);
      if (bulk && !days.length) throw Error("No days match. Check the dates and weekdays.");
      if (bulk && days.length > 120) throw Error("Add up to 120 shifts at a time.");
      const tags = resolveOrganizer(organizers, d, booking);
      const make = (day: string, id: string): BookingInput => ({
        id,
        ...shiftTimes(day, d.start, d.end, zone),
        place: d.place,
        organizer: tags.organizer,
        event: tags.event,
        seats: d.seats,
        staff,
        rent,
        quota,
        incentive,
      });
      const done = await withPin(async (pin) => {
        if (tags.organizers !== organizers) await props.onAction({ action: "organizers", organizers: tags.organizers, pin });
        if (bulk)
          await props.onAction({
            action: "bulkBookings",
            bookings: days.map((day) => make(day, crypto.randomUUID())),
            pin,
          });
        else await props.onAction({ action: "booking", booking: make(d.day, booking?.id ?? crypto.randomUUID()), pin });
      });
      if (done) {
        props.onSaved(bulk ? `Added ${days.length} shifts` : booking ? "Shift saved" : "Shift added");
        if (booking) buzz.tick();
        else celebrate(from ? centerOf(from) : undefined);
        onClose();
      }
    } catch (e) {
      setError(errorText(e));
      buzz.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        title={bulk ? "Add many shifts" : booking ? "Edit shift" : "New shift"}
        onClose={onClose}
        busy={busy}
        footer={
          <button className="btn block" disabled={busy || !props.online || !days.length} onClick={(e) => void save(e.currentTarget)}>
            {busy
              ? "Saving…"
              : bulk
                ? days.length
                  ? `Add ${days.length} ${days.length === 1 ? "shift" : "shifts"}`
                  : "No days picked"
                : booking
                  ? "Save shift"
                  : "Add shift"}
          </button>
        }
      >
        <div className="card card-pad stack gap-14">
          <div className="field">
            <span>Organizer</span>
            <SuggestInput
              label="Organizer"
              placeholder="Who runs the market"
              maxLength={80}
              value={d.organizer}
              newText="New organizer"
              suggestions={organizers.map((o) => ({
                key: o.id,
                name: o.name,
                detail: o.events.length ? o.events.map((e) => e.name).join(", ") : undefined,
              }))}
              onChange={(organizer) => set({ organizer })}
            />
          </div>
          <div className="field">
            <span>Event</span>
            <SuggestInput
              label="Event"
              placeholder="e.g. Christmas Bazaar"
              maxLength={80}
              value={d.event}
              newText="New event"
              suggestions={(organizer?.events ?? []).map((e) => ({ key: e.id, name: e.name }))}
              onChange={(event) => set({ event })}
            />
            <p className="label">New names are added to your list when you save. Rename or remove them in Settings.</p>
          </div>
          <div className="field">
            <span>Location</span>
            <button type="button" className="input place-button" onClick={() => setLocating(true)}>
              <MapPin size={18} strokeWidth={1.8} />
              <span className={"grow ellipsis" + (d.place ? "" : " g")}>
                {d.place ? d.place.name : "Search a venue or address"}
              </span>
              {d.place && (
                <span
                  role="button"
                  tabIndex={0}
                  className="combo-clear"
                  aria-label="Clear location"
                  onClick={(e) => {
                    e.stopPropagation();
                    set({ place: null });
                  }}
                >
                  <X size={16} />
                </span>
              )}
            </button>
            {d.place?.address && <p className="label">{d.place.address}</p>}
          </div>
        </div>

        <div className="card card-pad stack gap-14">
          {bulk ? (
            <>
              <div className="grid-2 dates">
                <label className="field">
                  <span>From</span>
                  <input className="input" type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value })} />
                </label>
                <label className="field">
                  <span>Until</span>
                  <input
                    className="input"
                    type="date"
                    value={d.until}
                    min={d.day}
                    onChange={(e) => e.target.value && set({ until: e.target.value })}
                  />
                </label>
              </div>
              <div className="field">
                <span>On these days</span>
                <div className="weekdays" role="group" aria-label="Weekdays">
                  {weekdayLetters.map((w, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={d.weekdays.includes(i)}
                      aria-label={plainDay(addDays("2026-11-01", i), { weekday: "long" })}
                      onClick={() =>
                        set({
                          weekdays: d.weekdays.includes(i) ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i],
                        })
                      }
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value })} />
            </label>
          )}
          <div className="grid-2">
            <label className="field">
              <span>Starts</span>
              <input className="input" type="time" value={d.start} onChange={(e) => e.target.value && set({ start: e.target.value })} />
            </label>
            <label className="field">
              <span>Ends</span>
              <input className="input" type="time" value={d.end} onChange={(e) => e.target.value && set({ end: e.target.value })} />
            </label>
          </div>
          {d.end <= d.start && <p className="label">Ends the next morning.</p>}
          {bulk && (
            <p className="label">
              {days.length
                ? `${days.length} ${days.length === 1 ? "shift" : "shifts"}: ${plainDay(days[0], { weekday: "short", month: "short", day: "numeric" })}${
                    days.length > 1
                      ? " to " + plainDay(days[days.length - 1], { weekday: "short", month: "short", day: "numeric" })
                      : ""
                  }`
                : "No days match."}
            </p>
          )}
        </div>

        <div className="stack gap-10">
          <p className="group-title">People</p>
          <div className="card card-list">
            <div className="list-row">
              <span className="grow stack">
                <span>People needed</span>
                <span className="label">Open seats show up for the team to join.</span>
              </span>
              <div className="stepper" role="group" aria-label="People needed">
                <button
                  type="button"
                  aria-label="One fewer"
                  disabled={d.seats <= Math.max(1, d.staff.length)}
                  onClick={() => set({ seats: d.seats - 1 })}
                >
                  <Minus size={16} />
                </button>
                <span aria-live="polite">{d.seats}</span>
                <button type="button" aria-label="One more" disabled={d.seats >= 50} onClick={() => set({ seats: d.seats + 1 })}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
            {d.staff.map((s) => (
              <button type="button" className="list-row" key={s.memberId} onClick={() => setStaffing(s.memberId)}>
                <Avatar id={s.memberId} name={s.name} />
                <span className="grow stack">
                  <span className="ellipsis">{s.name}</span>
                  <span className="label ellipsis">
                    {shiftRoleNames[s.role]} · {s.salary.trim() ? formatMoney(parse(s.salary), currency) : "No pay set"}
                  </span>
                </span>
                <ChevronRight size={18} className="chev" />
              </button>
            ))}
            <button type="button" className="list-row" onClick={() => setAdding(true)}>
              <span className="avatar seat" aria-hidden="true">
                <Plus size={16} />
              </span>
              <span className="grow">{bulk ? "Put someone on every shift" : "Assign someone"}</span>
            </button>
          </div>
        </div>

        <div className="stack gap-10">
          <p className="group-title">Money</p>
          <div className="card card-pad stack gap-14">
            <MoneyField label={bulk ? "Rent for each shift" : "Rent or booth fee"} value={d.rent} onChange={(v) => set({ rent: v })} currency={currency} />
            <div className="grid-2">
              <MoneyField label="Sales quota" value={d.quota} onChange={(v) => set({ quota: v })} currency={currency} />
              <MoneyField label="Incentive each" value={d.incentive} onChange={(v) => set({ incentive: v })} currency={currency} />
            </div>
            <p className="label">
              When sales reach the quota, everyone on the shift earns the incentive. Profit is sales minus rent, salaries and incentives.
            </p>
          </div>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
      {locating && (
        <LocationPicker
          recent={recent}
          timeZone={zone}
          onClose={() => setLocating(false)}
          onPick={(place) => {
            set({ place });
            setLocating(false);
          }}
        />
      )}
      {staffed && (
        <Sheet
          title={staffed.name}
          onClose={() => setStaffing(null)}
          footer={
            <>
              <button className="btn block" onClick={() => setStaffing(null)}>
                Done
              </button>
              <button
                className="btn ghost danger compact block"
                onClick={() => {
                  setStaffing(null);
                  set({ staff: d.staff.filter((x) => x.memberId !== staffed.memberId) });
                }}
              >
                <X size={16} /> Take off this shift
              </button>
            </>
          }
        >
          <div className="field">
            <span>Working as</span>
            <RolePicker
              value={rolesOf(staffed.role)}
              onChange={(r) => r.length && setStaff(staffed.memberId, { role: shiftRole(r) })}
            />
          </div>
          <MoneyField
            label="Pay for this shift"
            value={staffed.salary}
            onChange={(v) => setStaff(staffed.memberId, { salary: v })}
            currency={currency}
          />
        </Sheet>
      )}
      {adding && (
        <PersonPicker
          team={team}
          currency={state.business!.currency}
          title="Assign someone"
          exclude={d.staff.map((s) => s.memberId)}
          onClose={() => setAdding(false)}
          onPick={(m, role) => {
            set({
              staff: [...d.staff, { memberId: m.id, name: m.name, role, salary: money(m.rate) }],
              seats: Math.max(d.seats, d.staff.length + 1),
            });
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

/* ---------- share ---------- */

function ShareSchedule({
  bookings,
  businessId,
  zone,
  month,
  onClose,
}: {
  bookings: Booking[];
  businessId: string;
  zone: string;
  month: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<"upcoming" | "month">("upcoming");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const shown =
    range === "upcoming"
      ? bookings.filter((b) => Date.parse(b.endsAt) > Date.now())
      : bookings.filter((b) => dayOf(b.startsAt, zone).slice(0, 7) === month.slice(0, 7));
  const text = scheduleText(shown, zone, { origin: location.origin, businessId });
  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      buzz.success();
      setCopied(text);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setError("Couldn't copy here. Press and hold the text to copy it.");
    }
  }
  return (
    <Sheet
      title="Share the schedule"
      onClose={onClose}
      footer={
        <button type="button" className="btn block" disabled={!shown.length} onClick={() => void copy()}>
          <Copy size={17} /> {shown.length && copied === text ? "Copied" : "Copy schedule"}
        </button>
      }
    >
      <div className="segmented" role="group" aria-label="Which shifts">
        <button aria-pressed={range === "upcoming"} onClick={() => setRange("upcoming")}>
          Upcoming
        </button>
        <button aria-pressed={range === "month"} onClick={() => setRange("month")}>
          {plainDay(month, { month: "long" })}
        </button>
      </div>
      {shown.length ? (
        <pre className="schedule-text">{text}</pre>
      ) : (
        <div className="empty card">
          <p className="strong">No shifts to share</p>
          <p className="label">Add shifts first, or pick the other range.</p>
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

function AddShiftMenu({ disabled, onAdd }: { disabled: boolean; onAdd: (mode: "new" | "bulk") => void }) {
  const [keyboard, setKeyboard] = useState(false);
  return (
    <Menu.Root
      modal={false}
      onOpenChange={(open, { event }) => {
        if (!open) return;
        buzz.tap();
        setKeyboard(event instanceof KeyboardEvent || (event.type === "click" && "detail" in event && event.detail === 0));
      }}
    >
      <Menu.Trigger className="btn add-shift" aria-label="Add" disabled={disabled}>
        <Plus size={20} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="add-shift-positioner" align="end" sideOffset={8}>
          <Menu.Popup className="add-shift-menu" data-keyboard={keyboard || undefined}>
            <Menu.Item onClick={() => onAdd("new")}>
              <CalendarPlus size={18} aria-hidden="true" /> Add a shift
            </Menu.Item>
            <Menu.Item onClick={() => onAdd("bulk")}>
              <CalendarRange size={18} aria-hidden="true" /> Add bulk
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- screen ---------- */

type Filter = "day" | "open" | "mine";

export function ScheduleScreen(props: ScheduleProps) {
  const { state, demo, sharedSchedule } = props;
  const business = state.business!;
  const zone = business.timeZone;
  const me = state.me;
  const f = useFormats(zone);
  const today = dayOf(Date.now(), zone);
  const [selected, setSelected] = useState(() => {
    const initial = state.bookings?.find((b) => b.id === sharedSchedule?.bookingId);
    return initial ? dayOf(initial.startsAt, zone) : today;
  });
  const [month, setMonth] = useState(selected.slice(0, 8) + "01");
  const [filter, setFilter] = useState<Filter>(sharedSchedule && !sharedSchedule.bookingId ? "open" : "day");
  const [sharing, setSharing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(sharedSchedule?.bookingId ?? null);
  const [editing, setEditing] = useState<Booking | "new" | "bulk" | null>(null);
  const bookings = useMemo(
    () => [...(state.bookings ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [state.bookings],
  );
  // Live registers get sales from the server. The demo adds what this phone rang up.
  const local = useMemo(() => salesByBooking(state.shifts, state.sales), [state.shifts, state.sales]);
  const salesOf = (b: Booking) =>
    me?.owner ? (!demo && b.sales !== undefined ? b.sales : (b.sales ?? 0) + (local.get(b.id) ?? 0)) : undefined;

  const marks = useMemo(() => {
    const map = new Map<string, { count: number; open: boolean; mine: boolean }>();
    for (const b of bookings) {
      const day = dayOf(b.startsAt, zone);
      const m = map.get(day) ?? { count: 0, open: false, mine: false };
      m.count++;
      if (seatsOpen(b) > 0 && Date.parse(b.endsAt) > Date.now()) m.open = true;
      if (b.staff.some((s) => s.memberId === me?.memberId)) m.mine = true;
      map.set(day, m);
    }
    return map;
  }, [bookings, zone, me?.memberId]);

  const upcoming = bookings.filter((b) => Date.parse(b.endsAt) > Date.now());
  const openSeats = upcoming.filter((b) => seatsOpen(b) > 0 && !b.staff.some((s) => s.memberId === me?.memberId));
  const mineNext = upcoming.filter((b) => b.staff.some((s) => s.memberId === me?.memberId));
  const list =
    filter === "open" ? openSeats : filter === "mine" ? mineNext : bookings.filter((b) => dayOf(b.startsAt, zone) === selected);

  // Owner summary: what finished shifts this month earned.
  const monthDone = bookings.filter(
    (b) => Date.parse(b.endsAt) < Date.now() && dayOf(b.startsAt, zone).slice(0, 7) === month.slice(0, 7),
  );
  const monthNet = monthDone.reduce((sum, b) => sum + bookingProfit({ ...b, sales: salesOf(b) ?? 0 }).net, 0);
  const winners = monthDone.filter((b) => bookingProfit({ ...b, sales: salesOf(b) ?? 0 }).net >= 0).length;
  const next = mineNext[0];
  const openBooking = openId ? bookings.find((b) => b.id === openId) : undefined;
  const [board, setBoard] = useState(false);

  return (
    <div className="page narrow">
      <div className="page-top tight">
        <h1 className="headline grow">Shifts</h1>
        <button
          className="round"
          aria-label="Share the schedule"
          onClick={() => {
            buzz.tap();
            setSharing(true);
          }}
        >
          <Share2 size={19} />
        </button>
        <button
          className="round"
          aria-label="Leaderboard"
          onClick={() => {
            buzz.tap();
            setBoard(true);
          }}
        >
          <Trophy size={19} />
        </button>
        {me?.owner && <AddShiftMenu disabled={!props.online} onAdd={setEditing} />}
      </div>

      {me?.owner && monthDone.length > 0 ? (
        <div className="hero stack gap-8">
          <span className="hero-label">
            {plainDay(month, { month: "long" })} so far · {monthDone.length} {monthDone.length === 1 ? "shift" : "shifts"}
          </span>
          <Money value={monthNet} currency={business.currency} className="big-num" sign />
          <span className="hero-label">
            {winners} of {monthDone.length} paid for themselves after rent, salaries and incentives.
          </span>
        </div>
      ) : next ? (
        <p className="headline small-head">
          Next up: {f.day.format(new Date(next.startsAt))}, {f.time.format(new Date(next.startsAt))}{" "}
          <span className="g">at {next.place?.name ?? bookingTitle(next)}.</span>
        </p>
      ) : null}

      <MonthCalendar
        month={month}
        selected={selected}
        today={today}
        marks={marks}
        onMonth={setMonth}
        onSelect={(day) => {
          setSelected(day);
          setFilter("day");
        }}
      />

      <div className="segmented" role="group" aria-label="Show">
        <button aria-pressed={filter === "day"} onClick={() => setFilter("day")}>
          {selected === today ? "Today" : plainDay(selected, { weekday: "short", day: "numeric" })}
        </button>
        <button aria-pressed={filter === "open"} onClick={() => setFilter("open")}>
          Open seats{openSeats.length ? ` · ${openSeats.length}` : ""}
        </button>
        <button aria-pressed={filter === "mine"} onClick={() => setFilter("mine")}>
          Mine{mineNext.length ? ` · ${mineNext.length}` : ""}
        </button>
      </div>

      <div className="stack gap-10">
        {list.map((b, i) => {
          const day = dayOf(b.startsAt, zone);
          const showDay = filter !== "day" && (i === 0 || dayOf(list[i - 1].startsAt, zone) !== day);
          return (
            <div className="stack gap-10" key={b.id}>
              {showDay && <p className="group-title">{f.day.format(new Date(b.startsAt))}</p>}
              <BookingCard b={b} state={state} sales={salesOf(b)} onOpen={() => setOpenId(b.id)} />
            </div>
          );
        })}
        {!list.length && (
          <div className="empty card">
            <p className="strong">
              {filter === "open" ? "No open seats" : filter === "mine" ? "You're not on any shifts yet" : "Nothing scheduled"}
            </p>
            <p className="label">
              {filter === "day"
                ? me?.owner
                  ? "Add a shift for this day, or add a run of them for a bazaar."
                  : "Pick another day, or check open seats."
                : filter === "mine"
                  ? "Open seats are yours to join."
                  : "Every upcoming shift is full."}
            </p>
            {me?.owner && filter === "day" && (
              <button className="btn secondary" disabled={!props.online} onClick={() => setEditing("new")}>
                <Plus size={16} /> Add a shift
              </button>
            )}
          </div>
        )}
      </div>

      {sharing && (
        <ShareSchedule
          bookings={bookings}
          businessId={business.id}
          zone={zone}
          month={month}
          onClose={() => setSharing(false)}
        />
      )}
      {board && (
        <Sheet title="Leaderboard" onClose={() => setBoard(false)}>
          <Leaderboards state={state} demo={props.demo} empty />
        </Sheet>
      )}
      {openBooking && (
        <BookingSheet
          booking={openBooking}
          props={props}
          sales={salesOf(openBooking)}
          onEdit={() => {
            setEditing(openBooking);
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
      {editing && (
        <BookingEditor
          booking={editing === "new" || editing === "bulk" ? undefined : editing}
          bulk={editing === "bulk"}
          props={props}
          defaultDay={selected < today ? today : selected}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
