import { useState } from "react";
import { ChevronDown, ChevronRight, Receipt, Trash2 } from "lucide-react";
import { amountText, parseMoney } from "@/lib/domain";
import { blocked } from "@/lib/reject";
import { expenseSourceLabel } from "@/lib/report";
import type { Expense, ExpenseDeduction, ExpenseInput, PaymentMethod, RegisterState, TeamRosterMember } from "@/lib/types";
import { AddButton } from "./add-menu";
import { SuggestInput } from "./combobox";
import { FilterSelect } from "./filter-select";
import { ShiftRecordList, type ShiftRecordStatus } from "./shift-record-list";
import { buzz, ConfirmSheet, EmptyRow, errorText, formatMoney, Money, MoneyField, Sheet } from "./ui";
import styles from "./operations.module.css";

type ExpenseSources = { payments: PaymentMethod[]; teammates: TeamRosterMember[] };

export function expenseTeammates(state: RegisterState): TeamRosterMember[] {
  const roster = state.teamRoster ?? (state.team ?? []).filter((person) => person.joined);
  return [...roster].sort((a, b) =>
    Number(Boolean(b.primaryOwner)) - Number(Boolean(a.primaryOwner)) ||
    Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name),
  );
}

function ExpenseSheet({
  currency,
  suggestions,
  sources,
  expense,
  onSave,
  onRemove,
  onDismiss,
}: {
  currency: string;
  suggestions: string[];
  sources: ExpenseSources;
  expense?: Omit<Expense, "shiftId">;
  onSave: (input: ExpenseInput) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [label, setLabel] = useState(expense?.label ?? "");
  const [amount, setAmount] = useState(expense ? amountText(expense.amount, currency) : "");
  const [source, setSource] = useState<Expense["source"]>(expense?.source ?? "till");
  const cash = sources.payments.find((method) => method.on && method.kind === "cash");
  const legacy = expense && !expense.deduction ? expense.source : undefined;
  const [paymentId, setPaymentId] = useState(expense?.source === "till" ? expense.deduction?.id ?? "" : cash?.id ?? "");
  const [memberId, setMemberId] = useState(expense?.source === "pocket" ? expense.deduction?.id ?? "" : "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
  const payments = sources.payments.filter((method) => method.on || method.id === paymentId || (expense?.source === "till" && method.id === expense.deduction?.id));
  const payment = payments.find((method) => method.id === paymentId);
  const member = sources.teammates.find((person) => person.id === memberId);
  const oldDeduction = expense?.source === source && expense.deduction?.id === (source === "till" ? paymentId : memberId)
    ? expense.deduction
    : undefined;
  const deduction: ExpenseDeduction | null = source === "till"
    ? oldDeduction ?? (payment ? { id: payment.id, name: payment.name, kind: payment.kind } : null)
    : oldDeduction ?? (member ? { id: member.id, name: member.name, kind: "member" } : null);
  const paymentOptions = payments.map((method) => ({ id: method.id, name: method.name }));
  const memberOptions = sources.teammates.map((person) => ({
    id: person.id,
    name: `${person.name} · ${person.primaryOwner ? "Owner" : person.owner ? "Co-owner" : "Member"}`,
  }));
  const options = source === "till" ? paymentOptions : memberOptions;
  if (expense?.deduction && expense.source === source) {
    const saved = expense.deduction;
    if (!options.some((option) => option.id === saved.id)) options.push({ id: saved.id, name: saved.name });
  }
  if (legacy === "till") paymentOptions.unshift({ id: "", name: "Cash" });
  if (legacy === "pocket") memberOptions.unshift({ id: "", name: expense?.by || "Staff" });
  const sourceLabel = source === "till" ? "Payment method" : "Teammate";
  const sourceId = source === "till" ? paymentId : memberId;
  const sourcePlaceholder = options.length
    ? `Select ${sourceLabel.toLowerCase()}`
    : source === "till" ? "No payment methods available" : "No teammates available";
  const missingSource = !deduction && source !== legacy;
  const invalid = !label.trim() ? "Say what the expense was for."
    : !value ? "Enter how much it cost."
    : missingSource && (source === "till" ? "Choose a payment method." : "Choose a teammate.");
  const submitLabel = expense
    ? busy ? "Saving…" : "Save changes"
    : busy ? "Logging…" : value ? `Log ${formatMoney(value, currency)}` : "Log expense";
  return (
    <>
      <Sheet
        title={expense ? "Edit expense" : "Log an expense"}
        onClose={onDismiss}
        busy={busy}
        footer={
          <>
            <button
              type="button"
              className="btn block"
              disabled={busy}
              {...blocked(invalid)}
              onClick={async () => {
                if (busy || invalid || !value) return;
                setBusy(true);
                setError("");
                try {
                  await onSave({ label: label.trim(), amount: value, source, deduction });
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
            {expense && onRemove && (
              <button
                type="button"
                className="btn ghost danger compact block"
                aria-haspopup="dialog"
                disabled={busy}
                onClick={() => {
                  buzz.tap();
                  setConfirmRemove(true);
                }}
              >
                <Trash2 size={16} aria-hidden /> Remove expense
              </button>
            )}
          </>
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
          <span className="label">Deduct from</span>
          <div className="segmented" role="group" aria-label="Deduct from">
            <button type="button" aria-pressed={source === "till"} onClick={() => setSource("till")}>
              From till
            </button>
            <button type="button" aria-pressed={source === "pocket"} onClick={() => setSource("pocket")}>
              From team
            </button>
          </div>
          <div className="field">
            <span>{sourceLabel}</span>
            <FilterSelect label={sourceLabel} value={sourceId} onChange={source === "till" ? setPaymentId : setMemberId} disabled={busy || !options.length}>
              {legacy !== source && <option value="" disabled>{sourcePlaceholder}</option>}
              {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </FilterSelect>
          </div>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
      {expense && onRemove && confirmRemove && (
        <ConfirmSheet
          title="Remove expense?"
          detail={`${expense.label} (${formatMoney(expense.amount, currency)}) will come out of the shift’s expense total.`}
          confirmLabel="Remove"
          onClose={() => setConfirmRemove(false)}
          onConfirm={async () => {
            await onRemove();
            onDismiss();
          }}
        />
      )}
    </>
  );
}

function ExpenseRowContent({ expense, currency, time }: {
  expense: Omit<Expense, "shiftId">;
  currency: string;
  time: Intl.DateTimeFormat;
}) {
  return (
    <>
      <span className="well"><Receipt size={18} strokeWidth={1.8} /></span>
      <span className="grow stack">
        <span className="ellipsis">{expense.label}</span>
        <span className="label ellipsis">
          {expenseSourceLabel(expense)}
          {" · "}
          {time.format(new Date(expense.createdAt))}
        </span>
      </span>
      <Money value={expense.amount} currency={currency} className="end" />
    </>
  );
}

export function ShiftExpensesSheet({ title, expenses, total, currency, timeZone, status, editableTillId, sources, onEdit, onRemove, onClose }: {
  title: string;
  expenses: Expense[];
  total: number;
  currency: string;
  timeZone: string;
  status?: ShiftRecordStatus;
  editableTillId?: string;
  sources: ExpenseSources;
  onEdit?: (id: string, input: ExpenseInput) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);
  const time = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" });
  return (
    <>
      <Sheet title="Expenses" onClose={onClose}>
        <div className="stack gap-4">
          <Money value={total} currency={currency} className="big-num" />
          <p className="muted">{title}</p>
        </div>
        <ShiftRecordList
          status={status}
          label="Expenses"
          withIcon
          hasRecords={expenses.length > 0}
          empty={<EmptyRow object="expense" title="No expenses yet" detail="Expenses logged for this shift will show here." />}
        >
          {expenses.map((expense) => {
            const content = <ExpenseRowContent expense={expense} currency={currency} time={time} />;
            return onEdit && expense.shiftId === editableTillId ? (
              <button key={expense.id} type="button" className="list-row" aria-haspopup="dialog" onClick={() => {
                buzz.tap();
                setEditing(expense);
              }}>
                {content}
                <ChevronRight size={16} className="chev" aria-hidden />
              </button>
            ) : <div key={expense.id} className="list-row">{content}</div>;
          })}
        </ShiftRecordList>
      </Sheet>
      {editing && onEdit && (
        <ExpenseSheet
          currency={currency}
          suggestions={[...new Set(expenses.map((expense) => expense.label))]}
          sources={sources}
          expense={editing}
          onSave={(input) => onEdit(editing.id, input)}
          onRemove={onRemove && editing.shiftId === editableTillId ? () => onRemove(editing.id) : undefined}
          onDismiss={() => setEditing(null)}
        />
      )}
    </>
  );
}

const expenseIdeas = ["Rent", "Lalamove", "Grab", "Ice", "Supplies", "Parking", "Food", "Gas"];

export function ExpensesSection({
  expenses,
  currency,
  timeZone,
  sources,
  suggestions,
  disabled,
  onExpense,
  onEditExpense,
  onUnexpense,
}: {
  expenses: Omit<Expense, "shiftId">[];
  currency: string;
  timeZone: string;
  sources: ExpenseSources;
  suggestions: string[];
  disabled?: boolean;
  onExpense: (input: ExpenseInput) => void | Promise<void>;
  onEditExpense: (id: string, input: ExpenseInput) => void | Promise<void>;
  onUnexpense: (id: string) => void | Promise<void>;
}) {
  const [editor, setEditor] = useState<"new" | (typeof expenses)[number] | null>(null);
  const editing = editor === "new" ? undefined : editor ?? undefined;
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
            secondary
            disabled={disabled}
            onClick={() => setEditor("new")}
          />
        </div>
      </div>
      <div className="card card-list">
        {(allExpenses ? expenses : expenses.slice(0, 5)).map((e) => (
          <button
            key={e.id}
            type="button"
            className="list-row"
            aria-haspopup="dialog"
            disabled={disabled}
            onClick={() => {
              buzz.tap();
              setEditor(e);
            }}
          >
            <ExpenseRowContent expense={e} currency={currency} time={time} />
            <ChevronRight size={16} className="chev" aria-hidden />
          </button>
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
          sources={sources}
          expense={editing}
          onSave={editing ? (input) => onEditExpense(editing.id, input) : onExpense}
          onRemove={editing && !disabled ? () => onUnexpense(editing.id) : undefined}
          onDismiss={() => setEditor(null)}
        />
      )}
    </section>
  );
}
