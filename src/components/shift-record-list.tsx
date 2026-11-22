import type { ReactNode } from "react";
import { Notice } from "./ui";
import styles from "./operations.module.css";

export type ShiftRecordStatus =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string; retry?: () => void };

export function ShiftRecordList({ status, label, withIcon, hasRecords, empty, children }: {
  status?: ShiftRecordStatus;
  label: string;
  withIcon?: boolean;
  hasRecords: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  const loading = status?.kind === "loading";
  return (
    <>
      {status?.kind === "unavailable" && (
        <Notice action={status.retry && (
          <button type="button" className="link" onClick={status.retry}>Retry</button>
        )}>
          {status.message}
        </Notice>
      )}
      {(hasRecords || status?.kind !== "unavailable") && (
        <div className="card card-list" role="group" aria-label={label} aria-busy={loading || undefined}>
          {hasRecords ? children : loading ? (
            <>
              {[0, 1].map((row) => (
                <div className="list-row" key={row} aria-hidden="true">
                  {withIcon && <span className={styles.recordPlaceholderIcon} />}
                  <span className={`grow stack gap-6 ${styles.recordPlaceholderText}`}>
                    <i /><i />
                  </span>
                  <span className={styles.recordPlaceholderAmount} />
                </div>
              ))}
            </>
          ) : empty}
        </div>
      )}
    </>
  );
}
