import Image from "next/image";
import styles from "./loading-screen.module.css";

export function LoadingScreen({ message }: { message: string }) {
  return (
    <div className={styles.screen}>
      <div className={styles.sweep} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <Image className={styles.mark} src="/icon-192.png" alt="" width={192} height={192} loading="eager" unoptimized />
      <div className={styles.footer}>
        <p className={styles.name}>Portable POS</p>
        <p className={styles.message} role="status">{message}</p>
      </div>
    </div>
  );
}
