export const SHARE_BRAND_NAME = "Portable POS";

export function brandShareText(text: string) {
  return text ? `${text}\n\n${SHARE_BRAND_NAME}` : "";
}
