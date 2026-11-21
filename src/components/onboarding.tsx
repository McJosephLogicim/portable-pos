"use client";

import Image from "next/image";
import { APP_NAME, appIcons } from "@/lib/app-brand";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRACTICE, type OwnerAction } from "@/lib/demo";
import { saveMenuItem, shiftTotals } from "@/lib/domain";
import {
  checkout, loadRegister, logExpense, openPracticeRegister, removeExpense, saveCart,
  savePracticeAction, setAvailability,
} from "@/lib/register-store";
import { isSimpleMode } from "@/lib/settings";
import { dayOf } from "@/lib/team";
import type { RegisterState } from "@/lib/types";
import { ItemSheet } from "./menu-settings";
import { LoadingScreen } from "./loading-screen";
import { Popo } from "./popo";
import { ReportSheet } from "./report";
import { BookingEditor, TillShiftsSheet, type ScheduleProps } from "./schedule";
import { SellScreen } from "./sell";
import { CloseSheet } from "./shift";
import { TeamPage } from "./team";
import { errorText, Notice, PracticePinProvider, usePin } from "./ui";
import styles from "./onboarding.module.css";

const steps = [
  { id: "menu", title: "Add menu items", text: "Add a name and price for something you sell. It goes on your business menu.", button: "Add an item", image: "01-menu-items", pose: "menu" },
  { id: "sell", title: "Make your first sale", text: "Pick an item in Sell and run a practice checkout.", button: "Try Sell", image: "02-first-sale", pose: "sale" },
  { id: "schedule", title: "Add your first shift", text: "Choose a date and time for your business’s next shift.", button: "Add a shift", image: "03-add-a-shift", pose: "plan" },
  { id: "link", title: "Connect a shift in Till", text: "Use your scheduled shift to try linking the practice till.", button: "Open Till", image: "04-connect-till", pose: "connect" },
  { id: "close", title: "Close your shift", text: "Count the practice drawer and review its closing report.", button: "Count and close", image: "05-close-a-shift", pose: "close" },
  { id: "team", title: "Add your team", text: "Add the people who’ll work your shifts. Invite them by email or share an invite link.", button: "Add someone", image: "06-add-your-team", pose: "team" },
] as const;

type Step = (typeof steps)[number]["id"];
type Action = Step | "report";

function nextStep(live: RegisterState, practice: RegisterState): Step {
  if (!live.menu.length) return "menu";
  if (!practice.sales.length) return "sell";
  if (!live.bookings?.length) return "schedule";
  if (practice.shift && !practice.shift.bookingId) return "link";
  return practice.shift ? "close" : "team";
}

export function Onboarding({
  userId, live, online, onAction, onSaved, onLater, onFinish,
}: {
  userId: string;
  live: RegisterState;
  online: boolean;
  onAction: (input: OwnerAction) => Promise<void>;
  onSaved: (text: string) => void;
  onLater: () => void;
  onFinish: () => Promise<void>;
}) {
  const business = live.business!;
  const practiceKey = `${PRACTICE}:${userId}:${business.id}`;
  const [practice, setPractice] = useState<RegisterState | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const withPin = usePin();

  useEffect(() => {
    let alive = true;
    void loadRegister(practiceKey).then((stored) => {
      if (alive) setPractice(stored);
    }).catch((cause) => {
      if (alive) setError(errorText(cause));
    });
    return () => { alive = false; };
  }, [practiceKey]);

  const activeStep = practice && nextStep(live, practice);
  useEffect(() => {
    if (!action) heading.current?.focus({ preventScroll: true });
  }, [action, activeStep]);

  if (!practice) return (
    <main>
      {error ? (
        <div className="page stack gap-18">
          <Notice tone="danger">{error}</Notice>
          <button type="button" className="btn" onClick={onLater}>Finish later</button>
        </div>
      ) : <LoadingScreen message="Opening your setup guide…" />}
    </main>
  );

  const step = steps.find((entry) => entry.id === (action === "report" ? "close" : action ?? activeStep))!;
  const index = steps.indexOf(step);
  const hasTeammate = live.team?.some((member) => member.id !== live.me?.memberId);
  const practiceStep = step.id === "sell" || step.id === "link" || step.id === "close";
  const finish = () => { setAction(null); window.scrollTo(0, 0); };
  const saveLocal = async (input: OwnerAction) => {
    setPractice(await savePracticeAction(practiceKey, input));
  };
  async function run(runAction: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await runAction();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (practiceStep) setPractice(await openPracticeRegister(practiceKey, live));
    setAction(step.id);
    window.scrollTo(0, 0);
  }

  const liveSchedule: ScheduleProps = {
    state: live, online, demo: false, onAction, onSaved, onSales: finish,
  };
  const till = practice.shift;
  const closed = practice.shifts.find((shift) => shift.closedAt);
  let form: ReactNode = null;
  switch (action) {
    case "menu":
      form = (
        <ItemSheet
          simple={isSimpleMode(business.settings)}
          currency={business.currency}
          menu={live.menu}
          stockItems={business.settings.stockItems}
          pricing={business.settings.pricing}
          onSave={(item) => withPin((pin) => onAction({ action: "menu", menu: saveMenuItem(live.menu, item), pin }))}
          onClose={finish}
        />
      );
      break;
    case "schedule":
      form = <BookingEditor props={liveSchedule} defaultDay={dayOf(Date.now(), business.timeZone)} onClose={finish} />;
      break;
    case "link":
      if (till) form = (
        <TillShiftsSheet {...liveSchedule} state={practice} online demo practice
          onAction={saveLocal} shiftId={till.id} onClose={finish} onSchedule={finish} />
      );
      break;
    case "close":
      if (till) {
        const expenses = practice.expenses ?? [];
        form = (
          <PracticePinProvider>
            <CloseSheet
              shift={till}
              state={practice}
              expected={shiftTotals(till, practice.sales, expenses).expectedCash}
              currency={till.settings.currency}
              expenseProps={{
                expenses: expenses.filter((expense) => expense.shiftId === till.id && !expense.voidedAt),
                suggestions: expenses.map((expense) => expense.label),
                name: live.me?.name ?? "",
                currency: till.settings.currency,
                timeZone: business.timeZone,
                onExpense: async (input) => setPractice(await logExpense(practiceKey, { ...input, by: live.me?.name })),
                onUnexpense: async (id) => setPractice(await removeExpense(practiceKey, id)),
              }}
              onClose={async (closing, pin) => {
                await saveLocal({ action: "close", ...closing, pin });
                setAction("report");
              }}
              onDismiss={() => setAction((current) => current === "report" ? current : null)}
            />
          </PracticePinProvider>
        );
      }
      break;
    case "report":
      if (closed) form = (
        <ReportSheet shift={closed} state={practice} business={practice.business!} justClosed
          title={`Shift ${closed.number} closed`} continueLabel="Continue" onDismiss={finish} />
      );
      break;
  }

  if (action === "sell" && till) return (
    <main className="page">
      <button type="button" className="btn ghost compact" onClick={finish}>
        <ChevronLeft size={17} aria-hidden /> Setup guide
      </button>
      <SellScreen
        state={practice} status="Practice" online pending={false}
        onCart={async (cart) => setPractice(await saveCart(practiceKey, cart, practice.cart))}
        onCheckout={async (tender, received, discount, proofs) => {
          const result = await checkout(practiceKey, tender, received, practice.cart, discount, proofs, till.menuVersion ?? "opening");
          setPractice(result.state);
          return result.sale;
        }}
        onAvailability={async (id, out) => setPractice(await setAvailability(practiceKey, id, out))}
        onReverse={(saleId, reason, pin) => saveLocal({ action: "reverse", saleId, reason, pin })}
        onMenu={(menu, pin, stock) => saveLocal({ action: "menu", menu, pin, stock })}
        onSaved={onSaved}
        onTill={finish}
        onPracticeDone={finish}
      />
    </main>
  );

  if (action === "team") return (
    <main>
      <TeamPage startAdding state={live} online={online} demo={false}
        onAction={onAction} onSaved={onSaved} onPage={finish} />
      {hasTeammate && (
        <div className="page">
          {error && <Notice tone="danger">{error}</Notice>}
          <button type="button" className="btn block" disabled={!online || busy} onClick={() => void run(onFinish)}>
            {busy ? "Finishing…" : "Finish setup"}
          </button>
        </div>
      )}
    </main>
  );

  return (
    <>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image src={appIcons.small} width={28} height={28} alt="" unoptimized />
            {APP_NAME}
          </div>
          <button type="button" className={styles.exit} onClick={onLater}>Finish later</button>
        </header>
        <div className={styles.content}>
          <div className={styles.preview} aria-hidden="true">
            <Image src={`/onboarding/${step.image}.webp`} className={styles.previewCard} alt="" width={780} height={880} unoptimized />
            <Popo key={step.id} pose={step.pose} size={120} className={styles.previewPopo} />
          </div>
          <h1 ref={heading} tabIndex={-1}>{step.title}</h1>
          <p className={styles.description}>{step.text}</p>
        </div>
        <footer className={styles.footer}>
          <div className={styles.progress} role="progressbar" aria-label="Onboarding progress" aria-valuemin={1} aria-valuemax={7} aria-valuenow={index + 2}>
            <span data-status="complete" />
            {steps.map((entry, i) => <span key={entry.id} data-status={i === index ? "current" : i < index ? "complete" : undefined} />)}
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <button type="button" className={`btn block ${styles.cta}`} disabled={busy || (!practiceStep && !online)} onClick={() => void run(start)}>
            {step.button} <ArrowRight size={18} aria-hidden />
          </button>
          {step.id === "team" && hasTeammate && (
            <button type="button" className="btn ghost block" disabled={!online || busy} onClick={() => void run(onFinish)}>Finish setup</button>
          )}
          {!practiceStep && !online && <p className={styles.storage}>Connect to save changes to your business.</p>}
        </footer>
      </main>
      {form}
    </>
  );
}
