export type FilterSelection<Key extends string> = Partial<Record<Key, string[]>>;

export interface FilterValue {
  value: string;
  label: string;
}

export type FilterFacets<Key extends string, Value extends FilterValue = FilterValue> = Partial<Record<Key, Value[]>>;

export function matchesFilters<Key extends string>(
  facets: FilterFacets<Key>,
  selection: FilterSelection<Key>,
  ignore?: Key,
) {
  return (Object.keys(selection) as Key[]).every((key) => {
    const picked = selection[key];
    return key === ignore || !picked?.length || Boolean(facets[key]?.some((option) => picked.includes(option.value)));
  });
}

/** Count each choice alongside the picks in other groups. */
export function countFilterOptions<Key extends string, Value extends FilterValue>(
  rows: FilterFacets<Key, Value>[],
  selection: FilterSelection<Key>,
  key: Key,
) {
  const options = new Map<string, Value & { count: number }>();
  for (const facets of rows) {
    const matches = matchesFilters(facets, selection, key);
    for (const option of facets[key] ?? []) {
      const counted = options.get(option.value) ?? { ...option, count: 0 };
      if (matches) counted.count++;
      options.set(option.value, counted);
    }
  }
  return [...options.values()];
}
