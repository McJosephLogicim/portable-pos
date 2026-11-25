import { CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfirmSheet, usePin } from "./ui";
import type { CommandEvent } from "@/lib/offline-command";
import type { RegisterEvent } from "@/lib/types";

export function OfflineBanner({ checked, onRefresh }: { checked: boolean; onRefresh: () => void }) {
  return (
    <section className="register-banner register-banner-offline" aria-label="Offline">
      <span className="register-banner-icon"><CloudOff size={19} aria-hidden="true" /></span>
      <div className="register-banner-copy" role="status">
        <strong className="register-banner-title">You’re offline</strong>
        <p>{checked ? "Still offline. Check Wi-Fi or mobile data." : "Are you online?"}</p>
      </div>
      <button className="register-banner-button" type="button" onClick={onRefresh}>
        <RefreshCw size={15} aria-hidden="true" /> Refresh
      </button>
    </section>
  );
}

const eventLabels = [
  ["sale", "sale", "sales"],
  ["reversal", "sale reversal", "sale reversals"],
  ["stockCount", "stock adjustment", "stock adjustments"],
  ["expense", "expense", "expenses"],
  ["editExpense", "expense edit", "expense edits"],
  ["unexpense", "expense removal", "expense removals"],
  ["command", "register change", "register changes"],
  ["availability", "item availability update", "item availability updates"],
] as const;

export function SyncBanner({ events, online, syncing, failed, action }: {
  events: (RegisterEvent | CommandEvent)[];
  online: boolean;
  syncing: boolean;
  failed: boolean;
  action?: ReactNode;
}) {
  const counts: Record<(RegisterEvent | CommandEvent)["type"], number> = { command: 0, sale: 0, reversal: 0, stockCount: 0, expense: 0, editExpense: 0, unexpense: 0, availability: 0 };
  for (const event of events) counts[event.type]++;
  const title = syncing ? "Syncing changes" : failed ? "Sync paused" : "Waiting to sync";
  const detail = !online ? "Saved on this device. Sync starts when you’re back online."
    : syncing ? "Sending saved changes from this device."
    : failed ? "Your changes are still saved on this device."
    : "Your saved changes will sync automatically.";

  return (
    <section className="register-banner register-banner-sync" aria-label="Register sync">
      <span className="register-banner-icon"><CloudUpload size={20} aria-hidden="true" /></span>
      <div className="register-banner-copy">
        <div role="status">
          <strong className="register-banner-title">{title}</strong>
          <p>{detail}</p>
          <ul className="register-banner-items" role="list" aria-label="Changes left to sync">
            {eventLabels.map(([type, singular, plural]) => {
              const count = counts[type];
              return count > 0 && <li key={type}>{count} {count === 1 ? singular : plural}</li>;
            })}
          </ul>
        </div>
      </div>
      {action}
    </section>
  );
}


export function ReviewCommand({ event, online, onRetry, onDiscard, onCompare }: {
  event: CommandEvent; online: boolean; onRetry: (pin?: string, before?: string) => Promise<void>; onDiscard: () => Promise<void>;
  onCompare: () => Promise<{ before: string; saved: unknown; latest: unknown }>;
}) {
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState("");
  const [comparison, compare] = useState<Awaited<ReturnType<typeof onCompare>>>();
  const withPin = usePin();
  const canReplace = ["settings", "menu", "booking", "deleteBooking", "organizers"].includes(String(event.request.command.action))
    && event.failure?.includes("edited this business");
  return <div className="card card-pad stack gap-8">
    <strong>Review saved change</strong>
    <p role="alert">{event.failure}</p>
    <div className="row gap-8">
      {canReplace ? <button className="btn small" disabled={!online} onClick={() => {
        void onCompare().then(compare).catch((e) => setError(e.message));
      }}>Compare changes</button> : <button className="btn small" disabled={!online} onClick={() => {
        void (event.approval ? withPin(onRetry, { fresh: true, remember: false }) : onRetry()).catch((e) => setError(e.message));
      }}>{event.approval ? "Enter PIN and retry" : "Retry change"}</button>}
      <button className="btn small secondary" disabled={!online} onClick={() => setDiscard(true)}>Discard change</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {comparison && <ConfirmSheet title="Use the version saved on this phone?" detail={<>
      <p>This replaces the latest version for this change. Later sales and edits will sync in order.</p>
      {[["Latest version", comparison.latest], ["Saved change", comparison.saved]].map(([label, value]) =>
        <details key={String(label)}><summary>{String(label)}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(value, null, 2)}</pre></details>)}
    </>} confirmLabel="Use saved change" onClose={() => compare(undefined)}
      onConfirm={() => withPin((pin) => onRetry(pin, comparison.before), { fresh: true, remember: false })} />}
    {discard && <ConfirmSheet title="Discard this saved change?" detail="Later changes and sales stay on this phone. Changes that depend on this one may need review." confirmLabel="Discard change" onClose={() => setDiscard(false)} onConfirm={onDiscard} />}
  </div>;
}
