"use client";

import Image from "next/image";
import { ArrowRight, Check, ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEMO_PIN, PRACTICE, type OwnerAction } from "@/lib/demo";
import { saveMenuItem, shiftTotals } from "@/lib/domain";
import {
  checkout,
  loadRegister,
  logExpense,
  openPracticeRegister,
  removeExpense,
  saveCart,
  savePracticeAction,
  setAvailability,
  subscribeRegister,
} from "@/lib/register-store";
import { dayOf } from "@/lib/team";
import type { RegisterState } from "@/lib/types";
import { onReject } from "@/lib/reject";
import { ItemSheet } from "./menu-settings";
import { LoadingScreen } from "./loading-screen";
import { ReportSheet } from "./report";
import { BookingEditor, TillShiftsSheet, type ScheduleProps } from "./schedule";
import { SellScreen } from "./sell";
import { CloseSheet } from "./shift";
import { MemberSheet } from "./team";
import { CelebrateProvider, errorText, Notice, PhotoProvider, PracticePinProvider, Toast } from "./ui";
import { compressPhoto, blobToDataUrl } from "@/lib/photo";
import styles from "./practice.module.css";

const steps = [
  { id: "menu", title: "Add menu items", text: "Add a name and price for something you sell.", button: "Add an item", image: "01-menu-items" },
  { id: "sell", title: "Make your first sale", text: "Pick your new item in Sell and run a practice checkout.", button: "Try Sell", image: "02-first-sale" },
  { id: "schedule", title: "Add your first shift", text: "Choose a date and time for your next pop-up.", button: "Add a shift", image: "03-add-a-shift" },
  { id: "link", title: "Connect a shift in Till", text: "Link your scheduled shift to the till and its practice sale.", button: "Open Till", image: "04-connect-till" },
  { id: "close", title: "Close your shift", text: "Count the drawer and review your closing report.", button: "Count and close", image: "05-close-a-shift" },
  { id: "team", title: "Add your team", text: "Practice adding someone to your team.", button: "Add someone", image: "06-add-your-team" },
  { id: "done", title: "Sign in to POP POS", text: "Your practice is complete. Sign in or create an account to start your own register.", button: "Continue to sign in", image: null },
] as const;

type Step = (typeof steps)[number]["id"];
type Action = Exclude<Step, "done"> | "report";

function nextStep(state: RegisterState): Step {
  if (!state.menu.length) return "menu";
  if (!state.sales.length) return "sell";
  if (!state.bookings?.length) return "schedule";
  if (state.shift && !state.shift.bookingId) return "link";
  if (state.shift) return "close";
  return state.team?.some((member) => member.id !== state.me?.memberId) ? "done" : "team";
}

async function localPhoto(file: File) {
  return blobToDataUrl(await compressPhoto(file));
}

export function PracticeWalkthrough({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<RegisterState | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState({ text: "", stamp: 0 });
  const heading = useRef<HTMLHeadingElement>(null);
  const toastLayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void openPracticeRegister().then((value) => {
      if (alive) setState(value);
    }).catch((error) => {
      if (alive) setLoadError(errorText(error));
    });
    const unsubscribe = subscribeRegister(PRACTICE, () => {
      void loadRegister(PRACTICE).then((value) => {
        if (alive) setState(value);
      }).catch((error) => {
        if (alive) setLoadError(errorText(error));
      });
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  useEffect(() => onReject((text) => setToast((current) => ({ text, stamp: current.stamp + 1 }))), []);
  useEffect(() => {
    const node = toastLayer.current;
    if (toast.text && node && typeof node.showPopover === "function") node.showPopover();
  }, [toast]);
  useEffect(() => {
    if (!action && state) heading.current?.focus({ preventScroll: true });
  }, [action, Boolean(state)]);

  if (loadError) return (
    <main className="page stack gap-18">
      <Notice tone="danger">{loadError}</Notice>
      <button type="button" className="btn" onClick={onExit}>Back to sign in</button>
    </main>
  );
  if (!state?.business) return <main><LoadingScreen message="Opening your practice register…" /></main>;

  const business = state.business;
  const step = steps.find((entry) => entry.id === (action === "report" ? "close" : action ?? nextStep(state)))!;
  const index = steps.indexOf(step);
  const finish = () => { setAction(null); window.scrollTo(0, 0); };
  const start = () => {
    if (step.id === "done") onExit();
    else {
      window.scrollTo(0, 0);
      setAction(step.id);
    }
  };
  const save = async (input: OwnerAction) => {
    setState(await savePracticeAction(input));
  };
  const schedule: ScheduleProps = {
    state, online: true, demo: true, practice: true, onAction: save, onSaved: () => {}, onSales: finish,
  };
  const till = state.shift;
  const closed = state.shifts.find((shift) => shift.closedAt);

  let form: ReactNode = null;
  switch (action) {
    case "menu":
      form = (
        <ItemSheet
          simple
          practice
          currency={business.currency}
          menu={state.menu}
          onSave={async (item) => {
            await save({ action: "menu", menu: saveMenuItem(state.menu, item), pin: DEMO_PIN });
            return true;
          }}
          onClose={finish}
        />
      );
      break;
    case "schedule":
      form = <BookingEditor props={schedule} defaultDay={dayOf(Date.now(), business.timeZone)} onClose={finish} />;
      break;
    case "link":
      if (till) form = <TillShiftsSheet {...schedule} shiftId={till.id} onClose={finish} onSchedule={finish} />;
      break;
    case "close":
      if (till) {
        const expenses = state.expenses ?? [];
        form = (
          <CloseSheet
            shift={till}
            state={state}
            expected={shiftTotals(till, state.sales, expenses).expectedCash}
            currency={business.currency}
            expenseProps={{
              expenses: expenses.filter((expense) => expense.shiftId === till.id && !expense.voidedAt),
              suggestions: expenses.map((expense) => expense.label),
              name: state.me?.name ?? "",
              currency: business.currency,
              timeZone: business.timeZone,
              onExpense: async (input) => setState(await logExpense(PRACTICE, { ...input, by: state.me?.name })),
              onUnexpense: async (id) => setState(await removeExpense(PRACTICE, id)),
            }}
            onClose={async (closing, pin) => {
              await save({ action: "close", ...closing, pin });
              setAction("report");
            }}
            onDismiss={() => setAction((current) => current === "report" ? current : null)}
          />
        );
      }
      break;
    case "report":
      if (closed) form = (
        <ReportSheet shift={closed} state={state} business={business} justClosed
          title={`Shift ${closed.number} closed`} continueLabel="Continue" onDismiss={finish} />
      );
      break;
    case "team":
      form = (
        <MemberSheet practice canChangeAccess={false} currency={business.currency} onClose={finish}
          onSave={async (input) => {
            await save({ action: "invite", name: input.name, email: input.email, rate: input.rate });
            return true;
          }}
        />
      );
      break;
  }

  return (
    <CelebrateProvider>
      <PhotoProvider value={localPhoto}>
        <PracticePinProvider>
          {action === "sell" && till ? (
            <main className="page">
              <button type="button" className="btn ghost compact" onClick={finish}>
                <ChevronLeft size={17} aria-hidden /> Walkthrough
              </button>
              <SellScreen
                state={state} status="Practice" online pending={false}
                onCart={async (cart) => setState(await saveCart(PRACTICE, cart, state.cart))}
                onCheckout={async (tender, received, discount, proofs) => {
                  const result = await checkout(PRACTICE, tender, received, state.cart, discount, proofs, till.menuVersion ?? "opening");
                  setState(result.state);
                  return result.sale;
                }}
                onAvailability={async (id, out) => setState(await setAvailability(PRACTICE, id, out))}
                onReverse={(saleId, reason, pin) => save({ action: "reverse", saleId, reason, pin })}
                onMenu={(menu, pin, stock) => save({ action: "menu", menu, pin, stock })}
                onSaved={() => {}}
                onTill={finish}
                onPracticeDone={finish}
              />
            </main>
          ) : (
            <main className={styles.page}>
              <header className={styles.header}>
                <div className={styles.brand}>
                  <Image src="/icon-192.png" width={28} height={28} alt="" unoptimized />
                  POP POS
                </div>
                {step.id !== "done" && (
                  <button type="button" className={styles.exit} onClick={onExit}>Skip to sign in</button>
                )}
              </header>
              <div className={styles.content}>
                <div className={styles.preview} aria-hidden="true">
                  {step.image ? (
                    <Image src={`/onboarding/${step.image}.webp`} alt="" width={780} height={880} unoptimized />
                  ) : (
                    <span className={styles.doneMark}><Check size={40} strokeWidth={1.8} /></span>
                  )}
                </div>
                <h1 ref={heading} tabIndex={-1}>{step.title}</h1>
                <p className={styles.description}>{step.text}</p>
              </div>
              <footer className={styles.footer}>
                <div className={styles.progress} role="progressbar" aria-label="Practice progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}>
                  {steps.map((entry, i) => <span key={entry.id} data-status={i === index ? "current" : i < index ? "complete" : undefined} />)}
                </div>
                <button type="button" className={`btn block ${styles.cta}`} onClick={start}>
                  {step.button} <ArrowRight size={18} aria-hidden />
                </button>
                <p className={styles.storage}>Practice data stays on this device.</p>
              </footer>
            </main>
          )}
          {form}
          {toast.text && (
            <div ref={toastLayer} popover="manual" className="toast-viewport">
              <Toast text={toast.text} stamp={toast.stamp} onDone={() => setToast({ text: "", stamp: 0 })} />
            </div>
          )}
        </PracticePinProvider>
      </PhotoProvider>
    </CelebrateProvider>
  );
}
