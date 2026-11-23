import { useState } from "react";
import { paymentPreset } from "@/lib/payment-presets";
import type { PaymentMethod } from "@/lib/types";
import { MethodIcon } from "./ui";

export function PaymentMethodIcon({ method, size = 24 }: {
  method: Pick<PaymentMethod, "kind"> & Partial<Pick<PaymentMethod, "id" | "name" | "icon" | "presetId">>;
  size?: number;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const preset = method.name ? paymentPreset({ ...method, id: method.id ?? "", name: method.name }) : undefined;
  const builtIn = preset?.icon ?? (method.kind === "cash" ? "/payment-icons/cash.svg" : undefined);
  const image = [method.icon, builtIn].find((url) => url && !failed.includes(url));
  return image ? (
    <img className="payment-icon" src={image} width={size} height={size} alt="" loading="lazy"
      onError={() => setFailed((previous) => [...previous, image])} />
  ) : <MethodIcon kind={method.kind} size={size} />;
}
