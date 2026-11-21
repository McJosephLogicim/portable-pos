"use client";

import Image from "next/image";
import { useState } from "react";
import { APP_NAME, popoLoading } from "@/lib/app-brand";
import styles from "./loading-screen.module.css";

export function LoadingScreen({ message }: { message: string }) {
  const [animationFailed, setAnimationFailed] = useState(false);
  return (
    <div className={styles.screen}>
      <div className={styles.lockup}>
        <picture className={styles.mascot} aria-hidden="true">
          {!animationFailed && (
            <source media="(prefers-reduced-motion: no-preference)" srcSet={popoLoading.wave} type="image/webp" />
          )}
          <Image src={popoLoading.poster} alt="" width={264} height={264} loading="eager" unoptimized
            onError={() => setAnimationFailed(true)} />
        </picture>
        <p className={styles.name}>{APP_NAME}</p>
      </div>
      <p className={styles.message} role="status">{message}</p>
    </div>
  );
}
