"use client";

import { useRef, type PointerEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { blocked, type Reason } from "@/lib/reject";
import { buzz } from "./ui";
import styles from "./confirm-sale-slider.module.css";

let audio: AudioContext | undefined;

export function saleSlideSound(cue: "grab" | "ready" | "release" | "reset" | "saved") {
  const notes = { grab: [350], ready: [560], release: [440], reset: [270], saved: [660, 880] }[cue];
  try {
    audio ??= new AudioContext();
    const context = audio;
    if (context.state !== "running") void context.resume().catch(() => {});
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.065;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = "sine";
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.085);
      tone.connect(gain).connect(context.destination);
      tone.start(start);
      tone.stop(start + 0.09);
    });
  } catch {
    // Keep the gesture usable when a browser or device has audio disabled.
  }
}

const finishAt = 0.88;

export function ConfirmSaleSlider({
  preview,
  phase,
  refusal,
  sound,
  onConfirm,
}: {
  preview: boolean;
  phase: "idle" | "saving" | "saved";
  refusal: Reason;
  sound: boolean;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; start: number; offset: number; travel: number; ready: boolean } | null>(null);
  const locked = phase !== "idle";
  const label = preview ? "Slide to simulate sale" : "Slide to confirm sale";

  function start(event: PointerEvent<HTMLButtonElement>) {
    const element = track.current;
    if (!element || locked || refusal || drag.current || !event.isPrimary || event.button !== 0) return;
    const travel = (event.currentTarget.parentElement?.clientWidth ?? 0) - event.currentTarget.offsetWidth;
    if (travel <= 0) return;
    const offset = Math.max(0, event.currentTarget.offsetLeft);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, start: event.clientX, offset, travel, ready: false };
    element.dataset.dragging = "";
    move(event);
    buzz.tap();
    if (sound) saleSlideSound("grab");
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const motion = drag.current;
    const element = track.current;
    if (!element || motion?.pointer !== event.pointerId || locked || refusal) return;
    const distance = Math.max(0, Math.min(motion.travel, motion.offset + event.clientX - motion.start));
    const progress = distance / motion.travel;
    const ready = progress >= finishAt;
    if (ready && !motion.ready) {
      buzz.tick();
      if (sound) saleSlideSound("ready");
    }
    motion.ready = ready;
    element.style.setProperty("--drag-x", `${distance}px`);
    element.style.setProperty("--label-opacity", String(Math.max(0, 1 - progress * 1.6)));
  }

  function finish(event: PointerEvent<HTMLButtonElement>, released: boolean) {
    const motion = drag.current;
    const element = track.current;
    if (!element || motion?.pointer !== event.pointerId) return;
    drag.current = null;
    delete element.dataset.dragging;
    const delta = event.clientX - motion.start;
    const pastEnd = delta > 6 && motion.offset + delta >= motion.travel * finishAt;
    element.style.removeProperty("--drag-x");
    element.style.removeProperty("--label-opacity");
    if (released && pastEnd && !locked && !refusal) {
      confirm();
    } else if (released && sound && Math.abs(delta) > 6) {
      saleSlideSound("reset");
    }
  }

  function confirm() {
    if (sound) saleSlideSound("release");
    onConfirm();
  }

  return (
    <div ref={track} className={styles.track} data-phase={phase} data-refused={refusal ? "" : undefined}>
      <div className={styles.lane}>
        <span className={styles.fill} aria-hidden="true" />
        <span className={styles.label} aria-hidden="true">{locked ? "Saving…" : label}</span>
        <button
          className={styles.thumb}
          type="button"
          aria-label={label}
          aria-description="Press Enter or Space to confirm."
          aria-disabled={locked || undefined}
          {...blocked(refusal)}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
          onLostPointerCapture={(event) => finish(event, false)}
          onClick={(event) => {
            if (event.detail === 0 && !locked && !refusal && !drag.current) confirm();
          }}
        >
          <ArrowRight className={styles.arrow} size={21} strokeWidth={2.1} aria-hidden="true" />
          <span className={styles.saved} aria-hidden="true">
            <Check size={19} strokeWidth={2.4} /> {preview ? "Simulated" : "Sale saved"}
          </span>
        </button>
        <span className="sr-only" role="status">
          {phase === "saving" ? "Saving sale" : phase === "saved" ? preview ? "Test sale simulated" : "Sale saved" : ""}
        </span>
      </div>
    </div>
  );
}
