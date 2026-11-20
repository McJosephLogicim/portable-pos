import { useState } from "react";
import { ChevronDown, Receipt, Trash2 } from "lucide-react";
import { parseMoney } from "@/lib/domain";
import { blocked } from "@/lib/reject";
import type { Expense, ExpenseInput } from "@/lib/types";
import { AddMenu } from "./add-menu";
import { BulkRecordsSheet } from "./bulk-add";
import { SuggestInput } from "./combobox";
import { buzz, ConfirmSheet, EmptyRow, errorText, formatMoney, Money, MoneyField, Sheet } from "./ui";
import styles from "./operations.module.css";

function ExpenseSheet({
  currency,
  suggestions,
  name,
  staging = false,
  onSave,
  onDismiss,
}: {
  currency: string;
  suggestions: string[];
  name: string;
  staging?: boolean;
  onSave: (input: ExpenseInput) => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<Expense["source"]>("till");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
  return (
    <Sheet
      title="Log an expense"
      onClose={onDismiss}
      busy={busy}
      footer={
        <button
          className="btn block"
          disabled={busy}
          {...blocked(!label.trim() ? "Say what the expense was for." : !value && "Enter how much it cost.")}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave({ label: label.trim(), amount: value!, source });
              if (!staging) buzz.success();
              onDismiss();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Logging…" : staging ? "Add to batch" : value ? `Log ${formatMoney(value, currency)}` : "Log expense"}
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
          autoFocus
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
            : `Leaves the drawer alone. The report says to pay back ${name && name !== "You" ? name.split(" ")[0] : "you"}.`}
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
  note,
  disabled,
  onExpense,
  onUnexpense,
}: {
  expenses: Omit<Expense, "shiftId">[];
  currency: string;
  timeZone: string;
  name: string;
  suggestions: string[];
  note?: string;
  disabled?: boolean;
  onExpense: (input: ExpenseInput[]) => void | Promise<void>;
  onUnexpense: (id: string) => void | Promise<void>;
}) {
  const [addingExpense, setAddingExpense] = useState<"single" | "bulk" | null>(null);
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
          <AddMenu
            singleLabel="Add an expense"
            disabled={disabled}
            onSingle={() => setAddingExpense("single")}
            onBulk={() => setAddingExpense("bulk")}
          />
        </div>
      </div>
      {note && <p className="label">{note}</p>}
      <div className="card card-list">
        {(allExpenses ? expenses : expenses.slice(0, 5)).map((e) => (
          <div className="list-row" key={e.id}>
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
            <Money value={e.amount} currency={currency} />
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
          <EmptyRow title="Nothing spent yet" detail="Log ice, supplies or fares so the drawer adds up." />
        )}
        {expenses.length > 5 && (
          <button type="button" className="list-row" onClick={() => setAllExpenses((expanded) => !expanded)} aria-expanded={allExpenses}>
            <span className="grow">{allExpenses ? "Show less" : `Show ${expenses.length - 5} more`}</span>
            <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
          </button>
        )}
      </div>
      {addingExpense === "single" && (
        <ExpenseSheet
          currency={currency}
          suggestions={pastLabels}
          name={name}
          onSave={(input) => onExpense([input])}
          onDismiss={() => setAddingExpense(null)}
        />
      )}
      {addingExpense === "bulk" && (
        <BulkRecordsSheet<ExpenseInput>
          noun="expense"
          singleLabel="Add an expense"
          nameOf={(expense) => `${expense.label} · ${formatMoney(expense.amount, currency)}`}
          onClose={() => setAddingExpense(null)}
          onSave={async (inputs) => {
            await onExpense(inputs);
            buzz.success();
            return true;
          }}
          editor={({ add, close }) => (
            <ExpenseSheet staging currency={currency} suggestions={pastLabels} name={name} onSave={add} onDismiss={close} />
          )}
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
