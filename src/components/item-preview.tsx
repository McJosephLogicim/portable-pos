"use client";

import { useState } from "react";
import { itemInitials } from "@/lib/item-photos";
import type { ReceiptLine } from "@/lib/types";

export function ItemPreview({ name, image, size, tile = false }: {
  name: string;
  image?: string;
  size?: 24 | 36 | 40 | 48;
  tile?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  return (
    <span
      className={`item-preview${tile ? " item-preview-tile" : ""}`}
      style={size ? { width: size, fontSize: size * 0.35 } : undefined}
      aria-hidden="true"
    >
      {image && failed !== image ? (
        <img src={image} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(image)} />
      ) : itemInitials(name)}
    </span>
  );
}

export function ReceiptItemPreviews({ lines, photos, fallbackPhotos, max = 2, announce = false }: {
  lines: Pick<ReceiptLine, "productId" | "name">[];
  photos?: ReadonlyMap<string, string>;
  fallbackPhotos?: ReadonlyMap<string, string>;
  max?: number;
  announce?: boolean;
}) {
  const items = new Map<string, string>();
  for (const line of lines) {
    if (!items.has(line.productId)) items.set(line.productId, line.name);
  }
  if (!items.size) return null;
  const rest = items.size - max;
  return (
    <span
      className="item-preview-stack"
      role={announce ? "img" : undefined}
      aria-label={announce ? [...items.values()].join(", ") : undefined}
      aria-hidden={announce ? undefined : true}
    >
      {[...items].slice(0, max).map(([id, name]) => (
        <span key={id} className="item-preview-layer">
          <ItemPreview name={name} image={photos?.get(id) ?? fallbackPhotos?.get(id)} />
        </span>
      ))}
      {rest > 0 && (
        <span className="item-preview-layer" aria-hidden="true">
          <span className="item-preview item-preview-more">+{rest}</span>
        </span>
      )}
    </span>
  );
}
