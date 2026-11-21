import Image from "next/image";
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
  return (
    <Image
      src={popoPoses[pose]}
      alt=""
      width={size}
      height={size}
      className={[styles.image, styles[motion], className].filter(Boolean).join(" ")}
      loading="eager"
      unoptimized
    />
  );
}
