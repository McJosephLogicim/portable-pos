import Image from "next/image";
import { APP_NAME, popoLoading } from "@/lib/app-brand";
import styles from "./loading-screen.module.css";

export function LoadingScreen({ message }: { message: string }) {
  return (
    <div className={styles.screen}>
      <div className={styles.lockup}>
        <picture className={styles.mascot} aria-hidden="true">
          <source media="(prefers-reduced-motion: reduce)" srcSet={popoLoading.poster} />
          <Image src={popoLoading.wave} alt="" width={264} height={264} loading="eager" unoptimized />
        </picture>
        <p className={styles.name}>{APP_NAME}</p>
      </div>
      <p className={styles.message} role="status">{message}</p>
    </div>
  );
}
