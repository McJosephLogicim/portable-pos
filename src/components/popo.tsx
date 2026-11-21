"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { popoLoading, popoPoses } from "@/lib/app-brand";
import styles from "./popo.module.css";

export function Popo({
  pose = "neutral",
  size,
  className,
}: {
  pose?: keyof typeof popoPoses;
  size: number;
  className?: string;
}) {
  const src = popoPoses[pose];
  const art = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [waveReady, setWaveReady] = useState(false);
  const [waveFailed, setWaveFailed] = useState(false);

  useEffect(() => {
    const element = art.current;
    if (!element) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let inView = !("IntersectionObserver" in window);

    function updateMotion() {
      const shouldPlay = inView && !document.hidden && !reducedMotion.matches;
      setPlaying(shouldPlay);
      if (!shouldPlay) setWaveReady(false);
    }

    let observer: IntersectionObserver | undefined;
    if (!inView) {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        inView = entry.isIntersecting && (inView || entry.intersectionRatio >= 0.15);
        updateMotion();
      }, { threshold: [0, 0.15] });
      observer.observe(element);
    }

    document.addEventListener("visibilitychange", updateMotion);
    reducedMotion.addEventListener("change", updateMotion);
    updateMotion();

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      reducedMotion.removeEventListener("change", updateMotion);
    };
  }, []);

  const showWave = playing && !waveFailed;
  return (
    <span
      ref={art}
      className={[styles.art, className].filter(Boolean).join(" ")}
      style={{ "--popo-size": `${size}px` } as CSSProperties}
      data-waving={showWave && waveReady ? "" : undefined}
      aria-hidden="true"
    >
      <Image src={src} alt="" width={size} height={size} className={styles.poster} unoptimized />
      {showWave && (
        <Image src={popoLoading.wave} alt="" width={size} height={size} className={styles.wave}
          loading="eager" unoptimized onLoad={() => setWaveReady(true)} onError={() => setWaveFailed(true)} />
      )}
    </span>
  );
}
