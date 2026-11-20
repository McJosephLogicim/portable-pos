"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { reportText, shiftReport, type ShiftReport } from "@/lib/report";
import { reportImage } from "@/lib/report-image";
import type { Business, RegisterState, Shift } from "@/lib/types";
import { shiftCurrency } from "./receipt";
import { buzz, DoneCheck, errorText, facesOf, formatMoney, Money, Sheet } from "./ui";
import styles from "./operations.module.css";

type Preview = { report: ShiftReport } & ({ blob: Blob; url: string } | { error: string });

/** The end-of-shift report: a picture to send to the group chat, or the same as text. */
export function ReportSheet({
  shift,
  state,
  business,
  title,
  justClosed = false,
  onDismiss,
}: {
  shift: Shift;
  state: RegisterState;
  business: Business;
  title?: string;
  justClosed?: boolean;
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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [action, setAction] = useState<"copy" | "image" | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const name = `${business.name} shift ${shift.number}.png`.replace(/[^\w .-]/g, "");

  useEffect(() => {
    let live = true;
    let made = "";
    reportImage(report, (n) => formatMoney(n, currency))
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setPreview({ report, blob: b, url: made });
      })
      .catch(() => {
        if (!live) return;
        setPreview({ report, error: "The image couldn’t be prepared. You can still copy the report as text." });
        if (details.current) details.current.open = true;
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [report, currency]);

  const current = preview?.report === report ? preview : null;
  const image = current && "blob" in current ? current : null;
  const previewError = current && "error" in current ? current.error : "";
  const file = image ? new File([image.blob], name, { type: "image/png" }) : null;
  const canShare = Boolean(
    file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }),
  );

  function flash(message: string) {
    setDone(message);
    buzz.success();
  }

  return (
    <Sheet
      title={title ?? `Shift ${shift.number} report`}
      onClose={onDismiss}
      footer={
        <div className="stack gap-8">
          <p className={done ? `label ${styles.reportStatus}` : "sr-only"} role="status">{done}</p>
          <div className={`grid-2 ${styles.reportActions}`}>
            <button
              type="button"
              className="btn secondary"
              disabled={Boolean(action)}
              onClick={async () => {
                setAction("copy");
                setError("");
                setDone("");
                try {
                  await navigator.clipboard.writeText(text);
                  flash("Copied. Paste it in your group chat.");
                } catch {
                  setError("Couldn't copy here. Press and hold the text below to copy it.");
                  if (details.current) details.current.open = true;
                } finally {
                  setAction(null);
                }
              }}
            >
              <Copy size={17} /> {action === "copy" ? "Copying…" : "Copy text"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!image || Boolean(action)}
              onClick={async () => {
                if (!image || !file) return;
                setAction("image");
                setError("");
                setDone("");
                try {
                  if (canShare) {
                    await navigator.share({ files: [file], title: name });
                    return;
                  }
                  const a = document.createElement("a");
                  a.href = image.url;
                  a.download = name;
                  a.click();
                  flash("Image download started.");
                } catch (e) {
                  if ((e as Error).name !== "AbortError") setError(errorText(e));
                } finally {
                  setAction(null);
                }
              }}
            >
              {canShare ? <Share2 size={17} /> : <Download size={17} />}
              {previewError ? "Image unavailable" : !image ? "Preparing…" : action === "image" ? "Opening…" : canShare ? "Share image" : "Save image"}
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
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
        </div>
      )}
      <div className="report-preview" aria-busy={!current}>
        {image ? (
          <img src={image.url} alt={`Shift ${shift.number} report`} />
        ) : (
          <div className={`report-wait ${styles.reportWait}`} role={previewError ? "alert" : "status"}>
            {previewError || "Preparing the report image…"}
          </div>
        )}
      </div>
      <details ref={details} className={`report-text ${styles.details}`}>
        <summary>Show as text</summary>
        <pre>{text}</pre>
      </details>
    </Sheet>
  );
}
