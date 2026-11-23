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
  const image = [method.icon, preset?.icon].find((url) => url && !failed.includes(url));
  if (!image) return <MethodIcon kind={method.kind} size={size} />;

  const builtIn = image === preset?.icon;
  const background = builtIn ? preset.logoBackground : undefined;
  return (
    <img className={builtIn ? "payment-icon payment-icon-preset" : "payment-icon"}
      style={background ? { backgroundColor: background, padding: size / 10 } : undefined}
      src={image} width={size} height={size} alt="" loading="lazy"
      onError={() => setFailed((previous) => [...previous, image])} />
  );
}
