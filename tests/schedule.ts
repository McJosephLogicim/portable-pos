import { randomUUID } from "node:crypto";

/** Schedule a shift running right now, so a till can open for it. */
export async function shiftNow(cmd: (input: object) => Promise<unknown>, pin: string) {
  const id = randomUUID();
  await cmd({
    action: "booking",
    pin,
    booking: {
      id,
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      endsAt: new Date(Date.now() + 6 * 3600000).toISOString(),
      place: { name: "Legazpi Park" },
      organizer: null,
      event: null,
      seats: 2,
      staff: [],
      rent: 0,
      quota: 0,
      incentive: 0,
    },
  });
  return id;
}
