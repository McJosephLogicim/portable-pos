"use client";

import { useState } from "react";
import type { Business, Sale, Shift } from "@/lib/types";
import { errorText, Money, Sheet, usePin } from "./ui";

export function receiptNumber(shiftNumber: number, sequence: number) {
  return "#" + shiftNumber + "-" + String(sequence).padStart(3, "0");
}

export function shiftCurrency(shift: Shift | undefined, business: Business) {
  return shift?.settings?.currency ?? business.currency;
}

export function ReceiptBody({
  sale,
  shift,
  business,
  pending,
}: {
  sale: Sale;
  shift: Shift;
  business: Business;
  pending?: boolean;
}) {
  const currency = shiftCurrency(shift, business);
  const created = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(sale.createdAt));
  const note = shift.settings.receiptNote || business.settings.receiptNote;
  return (
    <div className="receipt">
      <div className="stack gap-4" style={{ textAlign: "center" }}>
        <p className="strong">{business.name}</p>
        <p className="label">
          {receiptNumber(shift.number, sale.sequence)} · {created}
        </p>
        {pending && (
          <p className="label row gap-6" style={{ justifyContent: "center" }}>
            <span className="dot" /> Saved on this phone, syncs when online
          </p>
        )}
        {sale.reversedAt && (
          <p className="row gap-6 danger" style={{ justifyContent: "center" }}>
            <span className="dot danger" /> Reversed · {sale.reason}
          </p>
        )}
      </div>
      <hr />
      <ul className="receipt-lines">
        {sale.lines.map((line, index) => (
          <li key={index} className="between" style={{ alignItems: "start" }}>
            <span className="grow">
              <span>
                {line.quantity > 1 && (
                  <span className="muted">{line.quantity}× </span>
                )}
                {line.name}
              </span>
              {line.options.length > 0 && (
                <span className="label" style={{ display: "block" }}>
                  {line.options.join(", ")}
                </span>
              )}
            </span>
            <Money value={line.unitPrice * line.quantity} currency={currency} />
          </li>
        ))}
      </ul>
      <hr />
      <dl className="stack gap-8">
        {sale.discount && (
          <>
            <div className="kv">
              <dt>Subtotal</dt>
              <dd>
                <Money value={sale.subtotal} currency={currency} />
              </dd>
            </div>
            <div className="kv">
              <dt>{sale.discount.name}</dt>
              <dd>
                <Money
                  value={-sale.discount.amount}
                  currency={currency}
                  sign
                />
              </dd>
            </div>
          </>
        )}
        <div className="kv" style={{ alignItems: "baseline" }}>
          <dt className="strong" style={{ color: "var(--ink)" }}>
            Total
          </dt>
          <dd>
            <Money
              value={sale.total}
              currency={currency}
              className={sale.reversedAt ? "struck" : ""}
            />
          </dd>
        </div>
        <div className="kv">
          <dt>Paid with</dt>
          <dd>{sale.payment.name}</dd>
        </div>
        {sale.payment.kind === "cash" && (
          <>
            <div className="kv">
              <dt>Cash received</dt>
              <dd>
                <Money value={sale.received} currency={currency} />
              </dd>
            </div>
            <div className="kv">
              <dt>Change</dt>
              <dd>
                <Money value={sale.change} currency={currency} />
              </dd>
            </div>
          </>
        )}
      </dl>
      {note && (
        <>
          <hr />
          <p className="label" style={{ textAlign: "center" }}>
            {note}
          </p>
        </>
      )}
    </div>
  );
}

const reasons = ["Rang up twice", "Wrong item", "Customer changed mind"];

export function ReceiptSheet({
  sale,
  shift,
  business,
  pending,
  canReverse,
  reverseBlocked,
  onReverse,
  onClose,
}: {
  sale: Sale;
  shift: Shift;
  business: Business;
  pending?: boolean;
  canReverse: boolean;
  reverseBlocked?: string;
  onReverse: (reason: string, pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const withPin = usePin();
  const currency = shiftCurrency(shift, business);
  if (reversing)
    return (
      <Sheet
        title={"Reverse " + receiptNumber(shift.number, sale.sequence)}
        onClose={() => setReversing(false)}
        busy={busy}
        footer={
          <button
            className="btn block"
            disabled={!reason.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const done = await withPin((pin) =>
                  onReverse(reason.trim(), pin),
                );
                if (done) onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Reversing…" : "Reverse "}
            {!busy && <Money value={sale.total} currency={currency} />}
          </button>
        }
      >
        <p className="muted">
          {sale.payment.kind === "cash"
            ? "Hand back the cash, then record it here. It comes off the drawer total."
            : `Refund it in ${sale.payment.name} first, then record it here.`}
        </p>
        <div className="chips" role="group" aria-label="Reason">
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Reason</span>
          <input
            className="input"
            maxLength={200}
            value={reason}
            placeholder="Or type one"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    );
  return (
    <Sheet
      title="Receipt"
      onClose={onClose}
      footer={
        !sale.reversedAt && (canReverse || reverseBlocked) ? (
          <>
            <button
              className="btn secondary block"
              disabled={!canReverse}
              onClick={() => setReversing(true)}
            >
              Reverse sale
            </button>
            {reverseBlocked && (
              <p className="label" style={{ textAlign: "center" }}>
                {reverseBlocked}
              </p>
            )}
          </>
        ) : undefined
      }
    >
      <ReceiptBody
        sale={sale}
        shift={shift}
        business={business}
        pending={pending}
      />
    </Sheet>
  );
}
