"use client";

import { useCallback, useMemo } from "react";
import { reportText, shiftReport } from "@/lib/report";
import { reportImage } from "@/lib/report-image";
import type { Business, RegisterState, Shift } from "@/lib/types";
import { shiftCurrency } from "./receipt";
import { ImageShareSheet } from "./share";
import { Popo } from "./popo";
import { DoneCheck, facesOf, formatMoney, Money } from "./ui";
import styles from "./operations.module.css";

/** The end-of-shift report: a picture to send to the group chat, or the same as text. */
export function ReportSheet({
  shift,
  state,
  business,
  title,
  justClosed = false,
  continueLabel,
  onDismiss,
}: {
  shift: Shift;
  state: RegisterState;
  business: Business;
  title?: string;
  justClosed?: boolean;
  continueLabel?: string;
  onDismiss: () => void;
}) {
  const currency = shiftCurrency(shift, business);
  const booking = state.bookings?.find((b) => b.id === shift.bookingId);
  const report = useMemo(
    () => shiftReport(shift, state.sales, state.expenses ?? [], business, booking, {
        menu: state.menu,
        faces: facesOf(state).byId,
        names: Object.fromEntries([
          ...(state.team ?? []).map((m) => [m.id, m.name]),
          ...(state.me ? [[state.me.memberId, state.me.name]] : []),
        ]),
      }),
    [shift, state, business, booking],
  );
  const fmt = (n: number) => formatMoney(n, currency);
  const text = reportText(report, fmt);
  const build = useCallback(() => reportImage(report, (n) => formatMoney(n, currency)), [report, currency]);

  return (
    <ImageShareSheet
      title={title ?? `Shift ${shift.number} report`}
      filename={`${business.name} shift ${shift.number}`}
      text={text}
      build={build}
      onClose={onDismiss}
      continueLabel={continueLabel}
    >
      {justClosed && (
        <div className="hero shift-complete">
          <DoneCheck />
          <div className="stack gap-4">
            <span className="hero-label">
              {report.sales.count} {report.sales.count === 1 ? "sale" : "sales"} recorded
            </span>
            <Money value={report.sales.total} currency={currency} className="big-num" />
            {report.cash.difference !== undefined && (
              <span className="hero-label">
                {report.cash.difference === 0
                  ? "Drawer balanced"
                  : `${fmt(Math.abs(report.cash.difference))} ${report.cash.difference > 0 ? "over" : "short"} in the drawer`}
              </span>
            )}
          </div>
          <Popo pose="close" motion="victoryHop" size={64} className={styles.reportMascot} />
        </div>
      )}
    </ImageShareSheet>
  );
}
