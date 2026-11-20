"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { cssTimeMs } from "@/lib/motion";
import styles from "./liquid-segments.module.css";

type Segment<T extends string> = { value: T; label: string };
type Pill = { x: number; y: number; width: number; height: number };

function paintedPill(clip: string, width: number, height: number): Pill | undefined {
  // The browser may serialize four equal/repeated insets as one, two, or three.
  const insets = clip.match(/^inset\(([-.\dpx ]+)\s+round /)?.[1].trim().split(/\s+/).map(parseFloat);
  if (!insets?.length || insets.some((value) => !Number.isFinite(value))) return;
  const [top, right = top, bottom = top, left = right] = insets;
  return {
    x: (left + width - right) / 2,
    y: (top + height - bottom) / 2,
    width: width - left - right,
    height: height - top - bottom,
  };
}

function morphHighlight(
  layer: HTMLDivElement,
  previous: number,
  selected: number,
  count: number,
  running: Animation | null,
) {
  if (document.documentElement.dataset.input === "keyboard" ||
    !matchMedia("(prefers-reduced-motion: no-preference)").matches ||
    typeof layer.animate !== "function") {
    running?.cancel();
    return null;
  }

  const css = getComputedStyle(layer);
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  const gap = parseFloat(css.columnGap);
  const padding = parseFloat(css.getPropertyValue("--segment-padding"));
  const cell = (width - gap * (count - 1)) / count;
  const resting = (index: number): Pill => ({
    x: (cell + gap) * index + cell / 2,
    y: height / 2,
    width: cell,
    height: height - padding * 2,
  });
  const from = (running?.playState === "running" || running?.playState === "paused"
    ? paintedPill(css.clipPath, width, height) : undefined) ?? resting(previous);
  running?.cancel();
  if (cell <= 0 || height <= padding * 2) return null;

  const to = resting(selected);
  const distance = to.x - from.x;
  const direction = Math.sign(distance);
  const stretch = Math.min(Math.abs(distance) / cell * 0.26, 0.35);
  const easeOut = css.getPropertyValue("--ease-out").trim();
  const easeMove = css.getPropertyValue("--ease-move").trim();
  const radius = css.getPropertyValue("--radius-pill").trim();
  const duration = cssTimeMs(css.getPropertyValue("--dur-base"), 200);
  const frame = (pill: Pill, offset: number, easing = easeOut): Keyframe => {
    const top = Math.max(0, pill.y - pill.height / 2);
    const right = Math.max(0, width - pill.x - pill.width / 2);
    const bottom = Math.max(0, height - pill.y - pill.height / 2);
    const left = Math.max(0, pill.x - pill.width / 2);
    return { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius})`, offset, easing };
  };

  // Only the mask changes shape. Its duplicate labels stay aligned to the real buttons.
  return layer.animate([
    frame(from, 0),
    frame({ ...from, x: from.x - direction * 1.5, width: from.width * 0.97 }, 0.12, easeMove),
    frame({
      x: from.x + distance * 0.54,
      y: to.y - 2.5,
      width: to.width * (1 + stretch),
      height: to.height / (1 + stretch * 0.76),
    }, 0.52, easeMove),
    frame({ ...to, x: to.x + direction * 1.5, width: to.width * 0.955, height: to.height * 1.06 }, 0.83),
    frame(to, 1),
  ], { duration });
}

export function LiquidSegments<T extends string>({ label, options, value, onChange, disabled }: {
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const index = options.findIndex((option) => option.value === value);
  const layer = useRef<HTMLDivElement>(null);
  const previous = useRef(index);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const oldIndex = previous.current;
    previous.current = index;
    if (!layer.current || oldIndex === index) return;
    animation.current = morphHighlight(layer.current, oldIndex, index, options.length, animation.current);
  }, [index, options.length]);

  return (
    <div
      className={`segmented ${styles.control}`}
      style={{ "--segment-count": options.length, "--segment-index": index } as CSSProperties}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      <div className={styles.highlight} ref={layer} aria-hidden="true">
        {options.map((option) => <span key={option.value}>{option.label}</span>)}
      </div>
    </div>
  );
}
