"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { popoPoses } from "@/lib/app-brand";
import styles from "./popo.module.css";

export function Popo({
  pose = "neutral",
  motion = "settle",
  size,
  className,
}: {
  pose?: keyof typeof popoPoses;
  motion?: "greet" | "settle";
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

    function startWhenVisible() {
      if (!element?.naturalWidth) return;
      if (!("IntersectionObserver" in window)) {
        setVisibleSrc(src);
        return;
      }
      observer = new IntersectionObserver(([entry], current) => {
        if (!entry || entry.intersectionRatio < 0.15) return;
        setVisibleSrc(src);
        current.disconnect();
      }, { threshold: 0.15 });
      observer.observe(element);
    }

    if (element.complete) startWhenVisible();
    else element.addEventListener("load", startWhenVisible, { once: true });

    return () => {
      observer?.disconnect();
      element.removeEventListener("load", startWhenVisible);
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
