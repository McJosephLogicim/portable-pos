"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { mergeableShifts, mergeLeftovers } from "@/lib/domain";
import { unitText } from "@/lib/stock";
import { bookingTitle, dayOf } from "@/lib/team";
import type { RegisterState, Shift } from "@/lib/types";
import { buzz, errorText, Sheet, usePin } from "./ui";

/** Finished shifts whose leftovers can be added into what each shift starts with. */
export function useMergeable(state: RegisterState) {
  return mergeableShifts(state.shifts, state.business?.settings.stockItems).sort((a, b) => b.number - a.number);
}

/**
 * After booths at the same event close, add up what each had left and make that
 * what the next shifts start with. Each finished shift merges once.
 */
export function MergeLeftoversSheet({
  state,
  online,
  onMerge,
  onSaved,
  onClose,
}: {
  state: RegisterState;
  online: boolean;
  onMerge: (shiftIds: string[], pin: string) => Promise<void>;
  onSaved: (text: string) => void;
  onClose: () => void;
}) {
  const business = state.business!;
  const zone = business.timeZone;
  const items = business.settings.stockItems ?? [];
  const shifts = useMergeable(state);
  const withPin = usePin();
  // The latest day's booths are picked to start with.
  const latest = shifts[0]?.closedAt && dayOf(shifts[0].closedAt, zone);
  const [picked, setPicked] = useState<string[]>(() =>
    shifts.filter((s) => s.closedAt && dayOf(s.closedAt, zone) === latest).map((s) => s.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = shifts.filter((s) => picked.includes(s.id));
  const total = mergeLeftovers(chosen, items);
  const still = state.shifts.filter((s) => !s.closedAt);
  const day = new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const title = (s: Shift) => {
    const booking = state.bookings?.find((b) => b.id === s.bookingId);
    return booking ? bookingTitle(booking) : `Shift ${s.number}`;
  };

  async function merge() {
    setBusy(true);
    setError("");
    try {
      const done = await withPin((pin) => onMerge(picked, pin));
      if (done) {
        buzz.success();
        onSaved("Starting amounts updated");
        onClose();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Merge leftovers"
      busy={busy}
      onClose={onClose}
      help={
        <>
          <p>When booths at the same event are done, add up what each one had left. That total becomes what every shift starts with.</p>
          <p>A count at closing is used when there is one. Otherwise it's what the sales left. Each shift merges once.</p>
        </>
      }
      footer={
        <button className="btn block" disabled={!online || busy || !Object.keys(total).length} onClick={merge}>
          {busy ? "Saving…" : "Set starting amounts"}
        </button>
      }
    >
      <div className="stack gap-18">
        {still.length > 0 && (
          <p className="label" role="status">
            {still.length === 1
              ? `Shift ${still[0].number} is still open. Merge after it closes to include it.`
              : `${still.length} shifts are still open. Merge after they close to include them.`}
          </p>
        )}
        <div className="stack gap-10">
          <p className="group-title">Finished shifts</p>
          <div className="card card-list">
            {shifts.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  className="list-row record-row selecting"
                  aria-pressed={on}
                  onClick={() => {
                    buzz.tap();
                    setPicked(on ? picked.filter((id) => id !== s.id) : [...picked, s.id]);
                  }}
                >
                  <span className="grow stack">
                    <span className="ellipsis">{title(s)}</span>
                    <span className="label ellipsis">
                      Shift {s.number} · {day.format(new Date(s.closedAt!))}
                      {s.openedBy ? " · " + s.openedBy.split(" ")[0] : ""}
                    </span>
                  </span>
                  <span className={"tick" + (on ? " on" : "")} aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="stack gap-10">
          <p className="group-title">Each shift starts with</p>
          <div className="card card-list">
            {!Object.keys(total).length && (
              <div className="list-row">
                <span className="grow label">Pick a shift to see the totals.</span>
              </div>
            )}
            {items.filter((item) => item.id in total).map((item) => (
              <div className="list-row" key={item.id}>
                <span className="grow stack">
                  <span className="ellipsis">{item.name}</span>
                  {item.onHand !== undefined && (
                    <span className="label ellipsis">Now {unitText(item.onHand, item.unit)}</span>
                  )}
                </span>
                <span className="num">{unitText(total[item.id], item.unit)}</span>
              </div>
            ))}
          </div>
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
      </div>
    </Sheet>
  );
}
