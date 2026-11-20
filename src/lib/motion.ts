export function cssTimeMs(value: string, fallback: number): number {
  const time = value.trim();
  const amount = parseFloat(time);
  if (!Number.isFinite(amount)) return fallback;
  // CSS builds can serialize the same token as 200ms or .2s.
  if (time.endsWith("ms")) return amount;
  if (time.endsWith("s")) return amount * 1000;
  return fallback;
}
