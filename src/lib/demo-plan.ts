import { addDays, dayOf, shiftTimes } from "./team";
import type { Booking, Bootstrap, Me, Member, Organizer, StaffSlot } from "./types";

/** A sample team and a fortnight of pop-ups for the demo stall. */
export function demoPlan(state: Pick<Bootstrap, "business">): Required<
  Pick<Bootstrap, "me" | "team" | "organizers" | "bookings">
> {
  const zone = state.business?.timeZone ?? "Asia/Manila";
  const peso = 100;
  const team: Member[] = [
    { id: "demo-you", name: "Ana Cruz", email: "owner@example.com", roles: ["cashier", "server"], rate: 0, owner: true, joined: true },
    { id: "demo-bea", name: "Bea Santos", email: "bea@example.com", roles: ["cashier"], rate: 700 * peso, owner: false, joined: true },
    { id: "demo-paolo", name: "Paolo Reyes", email: "paolo@example.com", roles: ["server"], rate: 600 * peso, owner: false, joined: true },
    { id: "demo-kim", name: "Kim Dela Cruz", email: "kim@example.com", roles: ["cashier", "server"], rate: 650 * peso, owner: false, joined: false },
  ];
  const organizers: Organizer[] = [
    {
      id: "weekend-market-co",
      name: "Weekend Market Co.",
      events: [
        { id: "legazpi-sunday", name: "Legazpi Sunday Market" },
        { id: "salcedo-saturday", name: "Salcedo Saturday Market" },
      ],
    },
    { id: "mercato", name: "Mercato Centrale", events: [{ id: "bgc-night", name: "BGC Night Market" }] },
  ];
  const places = {
    legazpi: { name: "Legazpi Active Park", address: "Legazpi Village, Makati", lat: 14.5547, lon: 121.0164 },
    salcedo: { name: "Jaime Velasquez Park", address: "Salcedo Village, Makati", lat: 14.5606, lon: 121.0228 },
    bgc: { name: "Bonifacio High Street", address: "Taguig, Metro Manila", lat: 14.5509, lon: 121.0509 },
  };
  const slot = (m: Member, role: StaffSlot["role"]): StaffSlot => ({ memberId: m.id, name: m.name, role, salary: m.rate });
  const [you, bea, paolo, kim] = team;
  const today = dayOf(Date.now(), zone);
  const make = (
    offset: number,
    start: string,
    end: string,
    where: keyof typeof places,
    organizer: Organizer,
    eventIndex: number,
    staff: StaffSlot[],
    seats: number,
    sales?: number,
  ): Booking => ({
    id: `demo-${offset}-${where}`,
    ...shiftTimes(addDays(today, offset), start, end, zone),
    place: places[where],
    organizer: { id: organizer.id, name: organizer.name },
    event: organizer.events[eventIndex],
    seats,
    staff,
    rent: (where === "bgc" ? 2500 : 1500) * peso,
    quota: 8000 * peso,
    incentive: 200 * peso,
    sales,
  });
  const [wm, mc] = organizers;
  const bookings = [
    make(-6, "07:00", "14:00", "legazpi", wm, 0, [slot(you, "cashier"), slot(paolo, "server")], 2, 9420 * peso),
    make(-2, "17:00", "23:00", "bgc", mc, 0, [slot(bea, "cashier"), slot(paolo, "server")], 2, 5180 * peso),
    make(0, "07:00", "14:00", "legazpi", wm, 0, [slot(you, "cashier"), slot(paolo, "server")], 2),
    make(1, "07:00", "14:00", "salcedo", wm, 1, [slot(bea, "cashier")], 2),
    make(3, "17:00", "23:00", "bgc", mc, 0, [slot(kim, "cashier")], 3),
    make(4, "17:00", "23:00", "bgc", mc, 0, [], 2),
    make(7, "07:00", "14:00", "legazpi", wm, 0, [slot(you, "cashier")], 2),
    make(8, "07:00", "14:00", "salcedo", wm, 1, [], 2),
  ];
  const me: Me = { memberId: you.id, name: you.name, roles: you.roles, owner: true };
  return { me, team, organizers, bookings };
}
