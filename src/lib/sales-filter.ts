import type { Booking, Sale, Shift } from "./types";

/** The ways the Sales page can narrow its list. Values within one are "any of"; across them, "all of". */
export type FilterKey = "shift" | "event" | "organizer" | "place" | "item" | "payment";
export type SalesFilter = Partial<Record<FilterKey, string[]>>;

export const filterKeys: FilterKey[] = ["shift", "event", "organizer", "place", "item", "payment"];
export const filterNames: Record<FilterKey, string> = {
  shift: "Shift",
  event: "Event",
  organizer: "Organizer",
  place: "Place",
  item: "Item",
  payment: "Payment",
};

export interface Facet {
  value: string;
  label: string;
  /** When it happened, for shifts. */
  at?: string;
}

/** A till belongs to a scheduled shift; a till without one stands on its own. */
export function shiftKey(shift: Shift) {
  return shift.bookingId ?? "till:" + shift.id;
}

function bookingName(b: Booking) {
  return b.event?.name ?? b.place?.name ?? b.organizer?.name ?? "Shift";
}

/** Everything a sale can be filtered by. */
export function saleFacets(
  sale: Sale,
  shifts: Map<string, Shift>,
  bookings: Map<string, Booking>,
): Record<FilterKey, Facet[]> {
  const till = shifts.get(sale.shiftId);
  const b = till?.bookingId ? bookings.get(till.bookingId) : undefined;
  const items = new Map<string, Facet>();
  for (const line of sale.lines) items.set(line.productId, { value: line.productId, label: line.name });
  return {
    shift: till
      ? [{ value: shiftKey(till), label: b ? bookingName(b) : "Shift " + till.number, at: b?.startsAt ?? till.openedAt }]
      : [],
    event: b?.event ? [{ value: b.event.id, label: b.event.name }] : [],
    organizer: b?.organizer ? [{ value: b.organizer.id, label: b.organizer.name }] : [],
    place: b?.place ? [{ value: b.place.name, label: b.place.name }] : [],
    item: [...items.values()],
    payment: [{ value: sale.payment.id, label: sale.payment.name }],
  };
}

export function activeCount(filter: SalesFilter) {
  return filterKeys.reduce((n, key) => n + (filter[key]?.length ?? 0), 0);
}

/** Whether a sale passes every filter, optionally ignoring one of them. */
export function matchesFilter(facets: Record<FilterKey, Facet[]>, filter: SalesFilter, ignore?: FilterKey) {
  return filterKeys.every((key) => {
    const values = filter[key];
    if (key === ignore || !values?.length) return true;
    return facets[key].some((f) => values.includes(f.value));
  });
}

export interface FilterOption extends Facet {
  /** Sales it would show alongside the other filters. */
  count: number;
}

/**
 * The choices for each filter, from the sales there are. Counts follow the other filters,
 * so picking an event shows how many sales each item had there. Newest shifts first;
 * everything else by how many sales it has.
 */
export function filterOptions(
  all: { facets: Record<FilterKey, Facet[]> }[],
  filter: SalesFilter,
): Record<FilterKey, FilterOption[]> {
  const out = {} as Record<FilterKey, FilterOption[]>;
  for (const key of filterKeys) {
    const map = new Map<string, FilterOption>();
    for (const { facets } of all) {
      const counts = matchesFilter(facets, filter, key);
      for (const f of facets[key]) {
        const row = map.get(f.value) ?? { ...f, count: 0 };
        if (counts) row.count += 1;
        map.set(f.value, row);
      }
    }
    out[key] = [...map.values()].sort((a, b) =>
      key === "shift" ? (b.at ?? "").localeCompare(a.at ?? "") : b.count - a.count || a.label.localeCompare(b.label),
    );
  }
  return out;
}
