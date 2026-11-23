import directories from "./ph-payment-directory.json";
import type { PaymentKind, PaymentMethod } from "./types";

export type PaymentPreset = {
  id: string;
  name: string;
  kind: PaymentKind;
  category: string;
  icon?: string;
  searchText?: string;
};

const categories = {
  bank: "Bank",
  digital: "Digital bank",
  wallet: "E-wallet",
  cash: "Cash",
  card: "Card",
} as const;

export const paymentPresets: PaymentPreset[] = directories.map(({ id, name, group, logo, aliases }) => ({
  id,
  name,
  kind: group === "digital" ? "bank" : group as PaymentKind,
  category: categories[group as keyof typeof categories],
  ...(logo ? { icon: `/payment-icons/${logo}` } : {}),
  ...(aliases ? { searchText: aliases } : {}),
}));

const byId = new Map(paymentPresets.map((preset) => [preset.id, preset]));
const byName = new Map(paymentPresets.map((preset) => [`${preset.kind}:${preset.name.toLowerCase()}`, preset]));

export function paymentPreset(method: Pick<PaymentMethod, "id" | "name" | "kind" | "presetId">) {
  if (method.presetId !== undefined) return method.presetId ? byId.get(method.presetId) : undefined;
  return byName.get(`${method.kind}:${method.name.toLowerCase()}`);
}
