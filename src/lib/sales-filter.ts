import type { Booking, Sale, Shift } from "./types";
import { countFilterOptions, matchesFilters, type FilterSelection } from "./filters";

/** The ways the Sales page can narrow its list. Values within one are "any of"; across them, "all of". */
export type FilterKey = "shift" | "event" | "organizer" | "place" | "item" | "payment";
export type SalesFilter = FilterSelection<FilterKey>;

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

export function shiftFacet(shift: Shift, label: string, booking?: Booking): Facet {
  return {
    value: shiftKey(shift),
    label,
    at: booking?.startsAt ?? shift.openedAt,
  };
}

/** Everything a sale can be filtered by. */
export function saleFacets(
  sale: Sale,
  shifts: Map<string, Shift>,
  bookings: Map<string, Booking>,
  shiftFacets: ReadonlyMap<string, Facet>,
): Record<FilterKey, Facet[]> {
  const till = shifts.get(sale.shiftId);
  const b = till?.bookingId ? bookings.get(till.bookingId) : undefined;
  const shift = till && shiftFacets.get(shiftKey(till));
  const items = new Map<string, Facet>();
  for (const line of sale.lines) items.set(line.productId, { value: line.productId, label: line.name });
  return {
    shift: shift ? [shift] : [],
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
  return matchesFilters(facets, filter, ignore);
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
  shiftFacets?: ReadonlyMap<string, Facet>,
): Record<FilterKey, FilterOption[]> {
  const out = {} as Record<FilterKey, FilterOption[]>;
  const rows = all.map(({ facets }) => facets);
  for (const key of filterKeys) {
    const options = countFilterOptions(rows, filter, key);
    if (key === "shift") {
      const counted = new Set(options.map((option) => option.value));
      for (const value of filter.shift ?? []) {
        if (counted.has(value)) continue;
        const facet = shiftFacets?.get(value) ?? { value, label: "Unavailable" };
        options.push({ ...facet, count: 0 });
      }
    }
    out[key] = options.sort((a, b) =>
      key === "shift" ? (b.at ?? "").localeCompare(a.at ?? "") : b.count - a.count || a.label.localeCompare(b.label),
    );
  }
  return out;
}
