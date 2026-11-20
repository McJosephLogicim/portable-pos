import styles from "./loading-screen.module.css";

export function LoadingScreen({ message }: { message: string }) {
  return (
    <div className={styles.screen}>
      <div className={styles.lockup}>
        <div className={styles.mark} aria-hidden="true">
          <span className={styles.bottom} />
          <span className={styles.upperLeft} />
          <span className={styles.upperRight} />
        </div>
        <p className={styles.name}>Portable POS</p>
      </div>
      <p className={styles.message} role="status">{message}</p>
    </div>
  );
}
