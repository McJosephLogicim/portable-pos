import { CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
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
  ["availability", "item availability update", "item availability updates"],
] as const;

export function SyncBanner({ events, online, syncing, failed, action }: {
  events: RegisterEvent[];
  online: boolean;
  syncing: boolean;
  failed: boolean;
  action?: ReactNode;
}) {
  const counts: Record<RegisterEvent["type"], number> = { sale: 0, reversal: 0, stockCount: 0, expense: 0, editExpense: 0, unexpense: 0, availability: 0 };
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
