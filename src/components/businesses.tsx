"use client";

import { Check, Plus } from "lucide-react";
import type { BusinessSummary, RegisterState } from "@/lib/types";
import { onColor } from "@/lib/theme";
import { Sheet } from "./ui";
import { blocked, OFFLINE } from "@/lib/reject";

export function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "P"
  );
}

/** The business's logo, or its initials on its brand color. */
export function BusinessMark({
  name,
  logo,
  brand,
  ink,
  size = 40,
}: {
  name: string;
  logo?: string;
  brand?: string;
  ink?: string;
  size?: number;
}) {
  return (
    <span
      className="mark"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        fontSize: Math.round(size * 0.35),
        ...(brand && !logo ? { background: brand, color: onColor(brand, ink) } : {}),
        ...(logo ? { background: "var(--surface)" } : {}),
      }}
    >
      {logo ? <img src={logo} alt="" /> : initialsOf(name)}
    </span>
  );
}

/** Every business this account is on, the current one first. */
export function businessList(state: RegisterState): BusinessSummary[] {
  const business = state.business!;
  const current: BusinessSummary = {
    id: business.id,
    name: business.name,
    owner: Boolean(state.me?.owner ?? true),
    logo: business.settings.logo,
    brand: business.settings.brand,
  };
  const others = (state.businesses ?? []).filter((b) => b.id !== business.id);
  return [current, ...others];
}

export function BusinessSwitcher({
  state,
  demo,
  online,
  onSwitch,
  onAdd,
  onClose,
}: {
  state: RegisterState;
  demo: boolean;
  online: boolean;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const list = businessList(state);
  const current = state.business!.id;
  return (
    <Sheet
      title="Your businesses"
      onClose={onClose}
      help={
        <>
          {demo && <p>Sign in to run more than one business.</p>}
          <p>Each business has its own menu, team, shifts and till.</p>
          <p>Sales waiting to sync stay with their business.</p>
        </>
      }
      footer={
        <button className="btn secondary block" {...blocked(demo ? "Sign in to run more than one business." : !online && OFFLINE)} onClick={onAdd}>
          <Plus size={18} /> Add
        </button>
      }
    >
      <div className="card card-list">
        {list.map((b) => (
          <button
            key={b.id}
            type="button"
            className="list-row"
            aria-current={b.id === current}
            {...blocked(b.id !== current && !online && "Connect to the internet to switch business.")}
            onClick={() => (b.id === current ? onClose() : onSwitch(b.id))}
          >
            <BusinessMark name={b.name} logo={b.logo} brand={b.brand} ink={b.id === current ? state.business!.settings.ink : undefined} />
            <span className="grow stack">
              <span className="ellipsis strong-ish">{b.name}</span>
              <span className="label">{b.owner ? "Owner" : "On the team"}</span>
            </span>
            {b.id === current && <Check size={18} className="pick-check" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
