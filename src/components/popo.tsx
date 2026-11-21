"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { popoPoses } from "@/lib/app-brand";
import styles from "./popo.module.css";

export function Popo({
  pose = "neutral",
  motion = "idle",
  size,
  className,
}: {
  pose?: keyof typeof popoPoses;
  motion?: "greet" | "idle";
  size: number;
  className?: string;
}) {
  const src = popoPoses[pose];
  const image = useRef<HTMLImageElement>(null);
  const [visibleSrc, setVisibleSrc] = useState<string>();

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    let observer: IntersectionObserver | undefined;
    let inView = false;

    function updateMotion() {
      setVisibleSrc(inView && !document.hidden ? src : undefined);
    }

    function watchVisibility() {
      if (!element?.naturalWidth) return;
      if (!("IntersectionObserver" in window)) {
        inView = true;
        updateMotion();
        return;
      }
      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return;
        inView = entry.isIntersecting && (inView || entry.intersectionRatio >= 0.15);
        updateMotion();
      }, { threshold: [0, 0.15] });
      observer.observe(element);
    }

    document.addEventListener("visibilitychange", updateMotion);
    if (element.complete) watchVisibility();
    else element.addEventListener("load", watchVisibility, { once: true });

    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      element.removeEventListener("load", watchVisibility);
    };
  }, [src]);

  return (
    <Image
      ref={image}
      src={src}
      alt=""
      width={size}
      height={size}
      className={[styles.image, visibleSrc === src && styles[motion], className].filter(Boolean).join(" ")}
      loading="eager"
      unoptimized
    />
  );
}
