/**
 * Short join links for the group chat: /j/<team><shift>.
 * The code is cut from the ids themselves, so nothing new is stored. The phone that opens it
 * matches the team among the businesses it belongs to, then the shift in that team's schedule.
 */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const TEAM_CODE = 3;
export const SHIFT_CODE = 6;

/** A short base62 code from an id's first 64 bits. */
export function shortCode(id: string, length: number) {
  let n = BigInt("0x" + (id.replace(/[^0-9a-f]/gi, "").slice(0, 16) || "0"));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += DIGITS[Number(n % 62n)];
    n /= 62n;
  }
  return out;
}

export function joinLink(origin: string, businessId: string, bookingId?: string) {
  const code = shortCode(businessId, TEAM_CODE) + (bookingId ? shortCode(bookingId, SHIFT_CODE) : "");
  return new URL("/j/" + code, origin).href;
}

export function readJoinCode(code: string) {
  if (!/^[0-9a-zA-Z]+$/.test(code)) return null;
  if (code.length === TEAM_CODE) return { team: code, shift: null };
  if (code.length === TEAM_CODE + SHIFT_CODE)
    return { team: code.slice(0, TEAM_CODE), shift: code.slice(TEAM_CODE) };
  return null;
}

export function matchCode<T extends { id: string }>(items: readonly T[] | undefined, code: string, length: number) {
  return items?.find((item) => shortCode(item.id, length) === code);
}
