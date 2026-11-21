"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MaskoHandle } from "@masko/player/react";
import { popoClips, popoLoading, popoPoses } from "@/lib/app-brand";
import styles from "./popo.module.css";

export function Popo({
  pose = "neutral",
  motion,
  size,
  className,
}: {
  pose?: keyof typeof popoPoses;
  motion?: keyof typeof popoClips;
  size: number;
  className?: string;
}) {
  const src = popoPoses[pose];
  const clip = motion ? popoClips[motion] : undefined;
  const art = useRef<HTMLSpanElement>(null);
  const clipHost = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [motionFailed, setMotionFailed] = useState(false);

  useEffect(() => {
    const element = art.current;
    if (!element) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let inView = !("IntersectionObserver" in window);

    function updateMotion() {
      const shouldPlay = inView && !document.hidden && !reducedMotion.matches;
      setPlaying(shouldPlay);
      if (!shouldPlay) {
        setMotionReady(false);
        setMotionFailed(false);
      }
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

  const showMotion = playing && !motionFailed;
  useEffect(() => {
    const host = clipHost.current;
    if (!showMotion || !clip || !host) return;
    let released = false;
    let player: MaskoHandle | undefined;
    // Load the player only when a video placement comes into view.
    void import("@masko/player").then(({ mountMascot }) => {
      if (released) return;
      player = mountMascot(host, { clip, sound: false });
      player.on("clip", () => setMotionReady(true));
      player.on("error", () => setMotionFailed(true));
    }).catch(() => {
      if (!released) setMotionFailed(true);
    });
    return () => {
      released = true;
      player?.destroy();
    };
  }, [clip, showMotion]);

  return (
    <span
      ref={art}
      className={[styles.art, className].filter(Boolean).join(" ")}
      style={{ "--popo-size": `${size}px` } as CSSProperties}
      data-animating={showMotion && motionReady ? "" : undefined}
      data-popo-motion={motion}
      aria-hidden="true"
    >
      <Image src={src} alt="" width={size} height={size} className={styles.poster} unoptimized />
      {showMotion && (clip ? (
        <span className={styles.clip} ref={clipHost} inert />
      ) : (
        <Image src={popoLoading.wave} alt="" width={size} height={size} className={styles.wave}
          loading="eager" unoptimized onLoad={() => setMotionReady(true)} onError={() => setMotionFailed(true)} />
      ))}
    </span>
  );
}
