import { useState } from "react";
import { ChevronDown, ChevronRight, Receipt, Trash2 } from "lucide-react";
import { amountText, parseMoney } from "@/lib/domain";
import { blocked } from "@/lib/reject";
import type { Expense, ExpenseInput } from "@/lib/types";
import { AddButton } from "./add-menu";
import { SuggestInput } from "./combobox";
import { buzz, ConfirmSheet, EmptyRow, errorText, formatMoney, Money, MoneyField, Sheet } from "./ui";
import styles from "./operations.module.css";

function ExpenseSheet({
  currency,
  suggestions,
  name,
  expense,
  onSave,
  onDismiss,
}: {
  currency: string;
  suggestions: string[];
  name: string;
  expense?: Omit<Expense, "shiftId">;
  onSave: (input: ExpenseInput) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [label, setLabel] = useState(expense?.label ?? "");
  const [amount, setAmount] = useState(expense ? amountText(expense.amount, currency) : "");
  const [source, setSource] = useState<Expense["source"]>(expense?.source ?? "till");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
  const payee = expense
    ? expense.by || "the person who paid"
    : name && name !== "You" ? name.split(" ")[0] : "you";
  const submitLabel = expense
    ? busy ? "Saving…" : "Save changes"
    : busy ? "Logging…" : value ? `Log ${formatMoney(value, currency)}` : "Log expense";
  return (
    <Sheet
      title={expense ? "Edit expense" : "Log an expense"}
      onClose={onDismiss}
      busy={busy}
      footer={
        <button
          type="button"
          className="btn block"
          disabled={busy}
          {...blocked(!label.trim() ? "Say what the expense was for." : !value && "Enter how much it cost.")}
          onClick={async () => {
            if (busy || !label.trim() || !value) return;
            setBusy(true);
            setError("");
            try {
              await onSave({ label: label.trim(), amount: value, source });
              buzz.success();
              onDismiss();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {submitLabel}
        </button>
      }
    >
      <div className="field">
        <span>What for</span>
        <SuggestInput
          label="What for"
          value={label}
          onChange={setLabel}
          suggestions={suggestions.map((s) => ({ key: s, name: s }))}
          placeholder="Rent, Lalamove, ice…"
          maxLength={80}
          autoFocus={!expense}
        />
      </div>
      <MoneyField label="Amount" value={amount} onChange={setAmount} currency={currency} big />
      <div className="stack gap-8">
        <span className="label">Paid with</span>
        <div className="segmented" role="group" aria-label="Paid with">
          <button type="button" aria-pressed={source === "till"} onClick={() => setSource("till")}>
            Cash from the till
          </button>
          <button type="button" aria-pressed={source === "pocket"} onClick={() => setSource("pocket")}>
            Own pocket
          </button>
        </div>
        <p className="label">
          {source === "till"
            ? "Takes it out of the cash expected in the drawer."
            : `Leaves the drawer alone. The report says to pay back ${payee}.`}
        </p>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

const expenseIdeas = ["Rent", "Lalamove", "Grab", "Ice", "Supplies", "Parking", "Food", "Gas"];

export function ExpensesSection({
  expenses,
  currency,
  timeZone,
  name,
  suggestions,
  disabled,
  onExpense,
  onEditExpense,
  onUnexpense,
}: {
  expenses: Omit<Expense, "shiftId">[];
  currency: string;
  timeZone: string;
  name: string;
  suggestions: string[];
  disabled?: boolean;
  onExpense: (input: ExpenseInput) => void | Promise<void>;
  onEditExpense: (id: string, input: ExpenseInput) => void | Promise<void>;
  onUnexpense: (id: string) => void | Promise<void>;
}) {
  const [editor, setEditor] = useState<"new" | (typeof expenses)[number] | null>(null);
  const editing = editor === "new" ? undefined : editor ?? undefined;
  const [removing, setRemoving] = useState<(typeof expenses)[number] | null>(null);
  const [allExpenses, setAllExpenses] = useState(false);
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const pastLabels = [...new Set([...suggestions, ...expenses.map((e) => e.label), ...expenseIdeas])];
  const time = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" });
  return (
    <section className="stack gap-10" aria-label="Expenses">
      <div className="between section-head">
        <p className="group-title">Expenses</p>
        <div className="row gap-8">
          {expenses.length > 0 && <span className="label">{formatMoney(total, currency)}</span>}
          <AddButton
            disabled={disabled}
            onClick={() => setEditor("new")}
          />
        </div>
      </div>
      <div className="card card-list">
        {(allExpenses ? expenses : expenses.slice(0, 5)).map((e) => (
          <div className="row gap-8" key={e.id}>
            <button
              type="button"
              className="list-row grow"
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => {
                buzz.tap();
                setEditor(e);
              }}
            >
              <span className="well">
                <Receipt size={18} strokeWidth={1.8} />
              </span>
              <span className="grow stack">
                <span className="ellipsis">{e.label}</span>
                <span className="label ellipsis">
                  {e.source === "till" ? "From the till" : `Paid by ${e.by ? e.by.split(" ")[0] : "staff"}`}
                  {" · "}
                  {time.format(new Date(e.createdAt))}
                </span>
              </span>
              <Money value={e.amount} currency={currency} className="end" />
              <ChevronRight size={16} className="chev" aria-hidden />
            </button>
            <button
              type="button"
              className="round flat"
              aria-label={"Remove " + e.label}
              disabled={disabled}
              onClick={() => {
                buzz.tap();
                setRemoving(e);
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {!expenses.length && (
          <EmptyRow object="expense" title="Nothing spent yet" detail="Log ice, supplies or fares so the drawer adds up." />
        )}
        {expenses.length > 5 && (
          <button type="button" className="list-row" onClick={() => setAllExpenses((expanded) => !expanded)} aria-expanded={allExpenses}>
            <span className="grow">{allExpenses ? "Show less" : `Show ${expenses.length - 5} more`}</span>
            <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
          </button>
        )}
      </div>
      {editor && (
        <ExpenseSheet
          currency={currency}
          suggestions={pastLabels}
          name={name}
          expense={editing}
          onSave={editing ? (input) => onEditExpense(editing.id, input) : onExpense}
          onDismiss={() => setEditor(null)}
        />
      )}
      {removing && (
        <ConfirmSheet
          title="Remove expense?"
          detail={`${removing.label} (${formatMoney(removing.amount, currency)}) will come out of the shift’s expense total.`}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => onUnexpense(removing.id)}
        />
      )}
    </section>
  );
}
