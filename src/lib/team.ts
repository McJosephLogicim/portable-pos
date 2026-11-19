import type {
  Booking,
  Me,
  Member,
  Organizer,
  Role,
  Sale,
  ShiftRole,
  Shift,
  StaffSlot,
} from "./types";

/** The people, organizers and scheduled shifts a plan command changes. */
export interface Plan {
  members: Member[];
  organizers: Organizer[];
  bookings: Booking[];
}

export type BookingInput = Omit<Booking, "sales">;

export type PlanCommand =
  | { action: "invite"; name: string; email: string; rate: number }
  | { action: "member"; memberId: string; name: string; rate: number }
  | { action: "removeMember"; memberId: string }
  | { action: "organizers"; organizers: Organizer[] }
  | { action: "booking"; booking: BookingInput }
  | { action: "bulkBookings"; bookings: BookingInput[] }
  | { action: "deleteBooking"; bookingId: string }
  | {
      action: "assign";
      bookingId: string;
      memberId: string;
      role: ShiftRole;
      /** Put them in this person's place. Taking over a shift replaces someone with yourself. */
      replace?: string;
    }
  | { action: "leave"; bookingId: string; memberId: string }
  | { action: "role"; bookingId: string; memberId: string; role: ShiftRole }
  | { action: "join"; bookingId: string; role: ShiftRole };

export const planActions = [
  "invite",
  "member",
  "removeMember",
  "organizers",
  "booking",
  "bulkBookings",
  "deleteBooking",
  "assign",
  "leave",
  "join",
  "role",
] as const;
/** Everything except joining, leaving or switching roles on your own shift needs the owner. */
export const ownerPlanActions = planActions.filter(
  (a) => a !== "join" && a !== "leave" && a !== "role",
);

export class PlanError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function check(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new PlanError(status, message);
}

export const roleNames: Record<Role, string> = {
  cashier: "Cashier",
  server: "Server",
};
export function rolesText(roles: Role[]) {
  return roles.length === 2 ? "Cashier and server" : roles.map((r) => roleNames[r]).join("");
}
export const shiftRoleNames: Record<ShiftRole, string> = { ...roleNames, both: "Cashier and server" };
/** The roles someone covers on a shift. */
export function rolesOf(role: ShiftRole): Role[] {
  return role === "both" ? ["cashier", "server"] : [role];
}
/** One shift role from the roles picked for it. Picking none means cashier. */
export function shiftRole(roles: Role[]): ShiftRole {
  return roles.includes("cashier") && roles.includes("server") ? "both" : (roles[0] ?? "cashier");
}

export function normalEmail(email: string) {
  return email.trim().toLowerCase();
}

const maxLength = 24 * 60 * 60 * 1000;

function checkBooking(b: BookingInput, members: Member[]) {
  const start = Date.parse(b.startsAt);
  const end = Date.parse(b.endsAt);
  check(Number.isFinite(start) && Number.isFinite(end), "Choose a start and end time.");
  check(end > start, "The shift has to end after it starts.");
  check(end - start <= maxLength, "Keep a shift under 24 hours. Add one for each day.");
  check(b.seats >= 1 && b.seats <= 50, "A shift needs 1 to 50 people.");
  check(b.staff.length <= b.seats, "More people than seats. Add a seat first.");
  const ids = new Set<string>();
  for (const slot of b.staff) {
    check(!ids.has(slot.memberId), "Someone is on this shift twice.");
    ids.add(slot.memberId);
    const member = members.find((m) => m.id === slot.memberId);
    check(member, "Someone on this shift is no longer on the team.", 404);
  }
  check(!b.event || b.organizer, "Pick the organizer for this event.");
}

function staffFrom(slots: StaffSlot[], members: Member[]): StaffSlot[] {
  return slots.map((s) => {
    const member = members.find((m) => m.id === s.memberId);
    return {
      memberId: s.memberId,
      role: s.role,
      name: member?.name ?? s.name,
      salary: s.salary ?? member?.rate ?? 0,
    };
  });
}

/**
 * Apply one command to the plan. Pure, so the server and the on-device demo
 * enforce the same rules. The caller loads every booking the command names.
 */
export function applyPlan(plan: Plan, me: Me, cmd: PlanCommand, now = Date.now()): Plan {
  if ((ownerPlanActions as readonly string[]).includes(cmd.action))
    check(me.owner, "Only the owner can change this.", 400);
  const members = plan.members;
  const find = (id: string) => {
    const booking = plan.bookings.find((b) => b.id === id);
    check(booking, "That shift was removed.", 404);
    return booking;
  };
  const put = (booking: Booking): Plan => ({
    ...plan,
    bookings: plan.bookings.some((b) => b.id === booking.id)
      ? plan.bookings.map((b) => (b.id === booking.id ? booking : b))
      : [...plan.bookings, booking],
  });

  switch (cmd.action) {
    case "invite": {
      const email = normalEmail(cmd.email);
      check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter their email address.");
      const existing = members.find((m) => normalEmail(m.email) === email);
      check(!existing?.joined, "Someone on the team already uses that email.", 409);
      if (existing) return plan;
      check(members.length < 100, "A team can have up to 100 people.");
      return {
        ...plan,
        members: [
          ...members,
          {
            id: crypto.randomUUID(),
            name: cmd.name.trim(),
            email,
            roles: ["cashier", "server"],
            rate: cmd.rate,
            owner: false,
            joined: false,
          },
        ],
      };
    }
    case "member": {
      const member = members.find((m) => m.id === cmd.memberId);
      check(member, "That person left the team.", 404);
      const next = { ...member, name: cmd.name.trim(), rate: cmd.rate };
      return {
        ...plan,
        members: members.map((m) => (m.id === member.id ? next : m)),
        bookings: plan.bookings.map((b) => ({
          ...b,
          staff: b.staff.map((s) => (s.memberId === member.id ? { ...s, name: next.name } : s)),
        })),
      };
    }
    case "removeMember": {
      const member = members.find((m) => m.id === cmd.memberId);
      check(member, "That person already left the team.", 404);
      check(!member.owner, "The owner stays on the team.");
      // Shifts that haven't started open their seat again. Past shifts keep the name for the books.
      return {
        ...plan,
        members: members.filter((m) => m.id !== member.id),
        bookings: plan.bookings.map((b) =>
          Date.parse(b.startsAt) > now
            ? { ...b, staff: b.staff.filter((s) => s.memberId !== member.id) }
            : b,
        ),
      };
    }
    case "organizers": {
      const ids = cmd.organizers.flatMap((o) => [o.id, ...o.events.map((e) => e.id)]);
      check(new Set(ids).size === ids.length, "Each organizer and event needs its own name.");
      check(cmd.organizers.length <= 200, "Keep up to 200 organizers.");
      return { ...plan, organizers: cmd.organizers };
    }
    case "booking": {
      const old = plan.bookings.find((b) => b.id === cmd.booking.id);
      const booking: Booking = {
        ...cmd.booking,
        staff: staffFrom(cmd.booking.staff, members),
        ...(old?.sales !== undefined ? { sales: old.sales } : {}),
      };
      checkBooking(booking, members);
      return put(booking);
    }
    case "bulkBookings": {
      check(cmd.bookings.length >= 1, "Pick at least one day.");
      check(cmd.bookings.length <= 120, "Add up to 120 shifts at a time.");
      let next = plan;
      for (const input of cmd.bookings) {
        check(!plan.bookings.some((b) => b.id === input.id), "Those shifts were already added.", 409);
        const booking = { ...input, staff: staffFrom(input.staff, members) };
        checkBooking(booking, members);
        next = { ...next, bookings: [...next.bookings, booking] };
      }
      return next;
    }
    case "deleteBooking": {
      find(cmd.bookingId);
      return { ...plan, bookings: plan.bookings.filter((b) => b.id !== cmd.bookingId) };
    }
    case "assign": {
      const booking = find(cmd.bookingId);
      const member = members.find((m) => m.id === cmd.memberId);
      check(member, "That person left the team.", 404);
      const slot: StaffSlot = { memberId: member.id, name: member.name, role: cmd.role, salary: member.rate };
      let staff = booking.staff;
      if (cmd.replace && cmd.replace !== member.id) {
        const at = staff.findIndex((s) => s.memberId === cmd.replace);
        check(at >= 0, "They're no longer on that shift.", 409);
        staff = staff.filter((s) => s.memberId !== member.id);
        staff = staff.map((s) => (s.memberId === cmd.replace ? slot : s));
      } else if (staff.some((s) => s.memberId === member.id)) {
        staff = staff.map((s) => (s.memberId === member.id ? { ...s, role: cmd.role } : s));
      } else {
        staff = [...staff, slot];
      }
      return put({ ...booking, staff, seats: Math.max(booking.seats, staff.length) });
    }
    case "leave": {
      const booking = find(cmd.bookingId);
      check(me.owner || cmd.memberId === me.memberId, "Only the owner can take someone else off a shift.", 400);
      check(
        me.owner || Date.parse(booking.startsAt) > now,
        "This shift already started. Ask the owner to take you off.",
        409,
      );
      return put({ ...booking, staff: booking.staff.filter((s) => s.memberId !== cmd.memberId) });
    }
    case "role": {
      const booking = find(cmd.bookingId);
      check(me.owner || cmd.memberId === me.memberId, "Only the owner can change someone else's role.", 400);
      check(me.owner || Date.parse(booking.endsAt) > now, "This shift is over.", 409);
      check(booking.staff.some((s) => s.memberId === cmd.memberId), "They're not on this shift.", 409);
      return put({
        ...booking,
        staff: booking.staff.map((s) => (s.memberId === cmd.memberId ? { ...s, role: cmd.role } : s)),
      });
    }
    case "join": {
      const booking = find(cmd.bookingId);
      check(Date.parse(booking.endsAt) > now, "This shift is over.", 409);
      if (booking.staff.some((s) => s.memberId === me.memberId)) return plan;
      check(booking.staff.length < booking.seats, "This shift just filled up.", 409);
      const member = members.find((m) => m.id === me.memberId);
      check(member, "Your invite was removed.", 404);
      return put({
        ...booking,
        staff: [...booking.staff, { memberId: member.id, name: member.name, role: cmd.role, salary: member.rate }],
      });
    }
  }
}

/** Ids of the bookings a command reads or writes. */
export function bookingIds(cmd: PlanCommand): string[] {
  if (cmd.action === "booking") return [cmd.booking.id];
  if (cmd.action === "bulkBookings") return cmd.bookings.map((b) => b.id);
  if ("bookingId" in cmd) return [cmd.bookingId];
  return [];
}

/** What a teammate who isn't the owner may see. */
export function redactBooking(b: Booking, me: Me): Booking {
  if (me.owner) return b;
  return {
    ...b,
    hit: b.quota > 0 && (b.sales ?? 0) >= b.quota,
    rent: undefined,
    sales: undefined,
    staff: b.staff.map((s) => (s.memberId === me.memberId ? s : { ...s, salary: undefined })),
  };
}

/* ---------- money ---------- */

export function bookingProfit(b: Booking) {
  const sales = b.sales ?? 0;
  const rent = b.rent ?? 0;
  const salaries = b.staff.reduce((sum, s) => sum + (s.salary ?? 0), 0);
  const hit = b.quota > 0 && sales >= b.quota;
  const incentives = hit ? b.incentive * b.staff.length : 0;
  const costs = rent + salaries + incentives;
  return { sales, rent, salaries, incentives, hit, costs, net: sales - costs };
}

/** Net sales rung up on tills opened for each booking, from what this device holds. */
export function salesByBooking(shifts: Shift[], sales: Sale[]) {
  const owner = new Map(shifts.filter((s) => s.bookingId).map((s) => [s.id, s.bookingId!]));
  const totals = new Map<string, number>();
  for (const sale of sales) {
    const id = owner.get(sale.shiftId);
    if (!id || sale.reversedAt) continue;
    totals.set(id, (totals.get(id) ?? 0) + sale.total);
  }
  return totals;
}

/* ---------- dates in the business time zone ---------- */

function parts(instant: number, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return values as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

function offset(instant: number, timeZone: string) {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-11-28" and "10:30" on the wall clock in a time zone, as an ISO instant. */
export function zonedInstant(day: string, time: string, timeZone: string) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let guess = wall - offset(wall, timeZone);
  guess = wall - offset(guess, timeZone);
  return new Date(guess).toISOString();
}

/** The calendar day of an instant in a time zone, as "YYYY-MM-DD". */
export function dayOf(instant: string | number, timeZone: string) {
  const p = parts(typeof instant === "string" ? Date.parse(instant) : instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" on the wall clock in a time zone. */
export function timeOf(instant: string, timeZone: string) {
  const p = parts(Date.parse(instant), timeZone);
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

export function addDays(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 is Sunday. */
export function weekday(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Every day from one date to another that falls on one of the weekdays. */
export function daysBetween(from: string, to: string, weekdays: number[]) {
  const out: string[] = [];
  for (let day = from; day <= to && out.length <= 400; day = addDays(day, 1))
    if (weekdays.includes(weekday(day))) out.push(day);
  return out;
}

/** A shift's start and end. An end time at or before the start runs past midnight. */
export function shiftTimes(day: string, start: string, end: string, timeZone: string) {
  const startsAt = zonedInstant(day, start, timeZone);
  const endsAt = zonedInstant(end <= start ? addDays(day, 1) : day, end, timeZone);
  return { startsAt, endsAt };
}

/** Kilometers between two points, for "0.4 km away". */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** A shift made on the spot for a till that opens without one scheduled: now, for a few hours, with whoever opened it. */
export function walkInBooking(
  input: { place?: string; hours: number },
  me: { memberId: string; name: string; roles: Role[] },
  now = Date.now(),
): Booking {
  const start = new Date(now);
  start.setSeconds(0, 0);
  return {
    id: crypto.randomUUID(),
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + input.hours * 3600000).toISOString(),
    place: input.place?.trim() ? { name: input.place.trim() } : null,
    organizer: null,
    event: null,
    seats: 1,
    staff: [{ memberId: me.memberId, name: me.name, role: shiftRole(me.roles) }],
    quota: 0,
    incentive: 0,
    rent: 0,
  };
}

/** A till can open this long before its scheduled shift starts. */
export const OPEN_EARLY = 30 * 60000;

/** Why a scheduled shift can't start now, or null when it can. Shifts start on their schedule. */
export function startProblem(
  b: Pick<Booking, "startsAt" | "endsAt">,
  timeZone: string,
  now = Date.now(),
): string | null {
  const start = Date.parse(b.startsAt);
  if (now >= Date.parse(b.endsAt)) return "This shift already ended. Add a new one on Shifts.";
  if (now < start - OPEN_EARLY) {
    const time = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" });
    const day = new Intl.DateTimeFormat("en", { timeZone, weekday: "short", month: "short", day: "numeric" });
    const sameDay = day.format(now) === day.format(start);
    return `This shift starts ${sameDay ? "at" : day.format(start) + ","} ${time.format(start)}. The till opens from ${time.format(start - OPEN_EARLY)}.`;
  }
  return null;
}
