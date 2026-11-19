"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Download, Share2 } from "lucide-react";
import { reportText, shiftReport } from "@/lib/report";
import { reportImage } from "@/lib/report-image";
import type { Business, RegisterState, Shift } from "@/lib/types";
import { shiftCurrency } from "./receipt";
import { buzz, errorText, facesOf, formatMoney, Sheet } from "./ui";

/** The end-of-shift report: a picture to send to the group chat, or the same as text. */
export function ReportSheet({
  shift,
  state,
  business,
  title,
  onDismiss,
}: {
  shift: Shift;
  state: RegisterState;
  business: Business;
  title?: string;
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
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const name = `${business.name} shift ${shift.number}.png`.replace(/[^\w .-]/g, "");

  useEffect(() => {
    let live = true;
    let made = "";
    reportImage(report, (n) => formatMoney(n, currency))
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [report, currency]);

  const file = blob ? new File([blob], name, { type: "image/png" }) : null;
  const canShare = Boolean(
    file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }),
  );

  function flash(message: string) {
    setDone(message);
    buzz.success();
    setTimeout(() => setDone(""), 2200);
  }

  return (
    <Sheet
      title={title ?? `Shift ${shift.number} report`}
      onClose={onDismiss}
      footer={
        <div className="stack gap-8">
          {done && (
            <p className="label" role="status" style={{ textAlign: "center" }}>
              {done}
            </p>
          )}
          <div className="grid-2">
            <button
              className="btn secondary"
              onClick={async () => {
                setError("");
                try {
                  await navigator.clipboard.writeText(text);
                  flash("Copied. Paste it in your group chat.");
                } catch {
                  setError("Couldn't copy here. Press and hold the text below to copy it.");
                }
              }}
            >
              <Copy size={17} /> Copy text
            </button>
            <button
              className="btn"
              disabled={!blob}
              onClick={async () => {
                if (!blob || !file) return;
                setError("");
                try {
                  if (canShare) {
                    await navigator.share({ files: [file], title: name });
                    return;
                  }
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = name;
                  a.click();
                  flash("Image saved.");
                } catch (e) {
                  if ((e as Error).name !== "AbortError") setError(errorText(e));
                }
              }}
            >
              {canShare ? <Share2 size={17} /> : <Download size={17} />} {canShare ? "Send image" : "Save image"}
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
      <div className="report-preview">
        {url ? <img src={url} alt={`Shift ${shift.number} report`} /> : <div className="report-wait">Making the picture…</div>}
      </div>
      <details className="report-text">
        <summary>Show as text</summary>
        <pre>{text}</pre>
      </details>
    </Sheet>
  );
}
