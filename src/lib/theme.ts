import type { Settings } from "./types";

/** Fonts a business can pick for its till and receipts. Geist ships with the app. */
export const fonts = [
  { id: "geist", name: "Geist", family: '"Geist Variable"', google: "" },
  { id: "inter", name: "Inter", family: '"Inter"', google: "Inter:wght@400;500;600;700" },
  { id: "dm-sans", name: "DM Sans", family: '"DM Sans"', google: "DM+Sans:wght@400;500;600;700" },
  { id: "poppins", name: "Poppins", family: '"Poppins"', google: "Poppins:wght@400;500;600;700" },
  { id: "nunito", name: "Nunito", family: '"Nunito"', google: "Nunito:wght@400;500;600;700;800" },
  { id: "space-grotesk", name: "Space Grotesk", family: '"Space Grotesk"', google: "Space+Grotesk:wght@400;500;600;700" },
  { id: "fredoka", name: "Fredoka", family: '"Fredoka"', google: "Fredoka:wght@400;500;600;700" },
  { id: "lora", name: "Lora", family: '"Lora"', google: "Lora:wght@400;500;600;700" },
] as const;

export const radii = [
  { id: "square", name: "Square", sizes: [10, 8, 8, 6, 4, 8] },
  { id: "soft", name: "Soft", sizes: [18, 16, 14, 10, 8, 14] },
  { id: "round", name: "Round", sizes: [28, 24, 20, 14, 10, 999] },
] as const;

/** Text colors: near-black by default, or a dark shade that suits the brand. */
export const inks = ["#0a0a0a", "#1f2937", "#3b2f2f", "#14342b", "#1e2a4a", "#3b1d4a"];

export type FontId = (typeof fonts)[number]["id"];
export type RadiusId = (typeof radii)[number]["id"];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or black text, whichever reads better on the color. */
export function onColor(hex: string) {
  const lightness = luminance(hex) + 0.05;
  const blackContrast = lightness / 0.05;
  const whiteContrast = 1.05 / lightness;
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

/** Shared by the on-screen leaderboard and its PNG export. */
export function leaderboardPalette(brand?: string) {
  const color = brand && /^#[0-9a-f]{6}$/i.test(brand) ? brand : "#d2874b";
  function tint(base: string, amount: number) {
    const rgb = [1, 3, 5].map((i) => {
      const from = parseInt(base.slice(i, i + 2), 16);
      const to = parseInt(color.slice(i, i + 2), 16);
      return Math.round(from + (to - from) * amount);
    });
    return `rgb(${rgb.join(", ")})`;
  }

  return {
    base: tint("#131313", 0.12),
    tint: tint("#1d1d1d", 0.24),
    glow: tint("#191919", 0.4),
    muted: tint("#ffffff", 0.2),
    portrait: tint("#ffffff", 0.22),
    "portrait-first": tint("#ffffff", 0.12),
    "portrait-line": tint("#ffffff", 0.35),
    "portrait-ink": tint("#191919", 0.42),
    first: tint("#353535", 0.44),
    second: tint("#353535", 0.31),
    third: tint("#353535", 0.24),
    middle: tint("#242424", 0.2),
    "edge-left": tint("#ffffff", 0.86),
    "edge-glint": tint("#ffffff", 0.7),
    "edge-right": tint("#ffffff", 0.92),
  };
}

const vars = ["--accent", "--accent-ring", "--accent-pressed", "--on-accent", "--hero-brand-strength", "--glossy", "--ink", "--font-sans", "--brand",
  "--radius-xl", "--radius-lg", "--radius-md", "--radius-sm", "--radius-xs", "--radius-pill"];

/** Theme the whole app from the business's branding: buttons, text, font and corners. */
export function applyTheme(settings: Pick<Settings, "brand" | "font" | "radius" | "ink"> | undefined) {
  const root = document.documentElement;
  for (const v of vars) root.style.removeProperty(v);
  root.classList.toggle("branded", Boolean(settings?.brand));
  if (!settings) return;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  const { brand, ink } = settings;
  if (brand && /^#[0-9a-f]{6}$/i.test(brand)) {
    const on = onColor(brand);
    const dark = on === "#ffffff";
    const shade = dark ? "#000" : "#fff";
    const gloss = `color-mix(in srgb, ${brand} 82%, ${shade})`;
    const glossStops = dark ? `${brand}, ${gloss}` : `${gloss}, ${brand}`;
    set("--brand", brand);
    set("--accent", brand);
    set("--accent-ring", brand);
    set("--on-accent", on);
    set("--accent-pressed", `color-mix(in srgb, ${brand} 88%, ${shade})`);
    set("--glossy", `linear-gradient(180deg in srgb, ${glossStops})`);
    // Bright brands need a darker tint for white text across the hero gradient.
    set("--hero-brand-strength", dark ? "88%" : "45%");
  }
  if (ink && /^#[0-9a-f]{6}$/i.test(ink) && (luminance("#ededed") + 0.05) / (luminance(ink) + 0.05) >= 4.5) {
    set("--ink", ink);
  }
  const font = fonts.find((f) => f.id === settings.font);
  if (font && font.google) {
    const id = "brand-font-" + font.id;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
      document.head.appendChild(link);
    }
    set("--font-sans", `${font.family}, system-ui, -apple-system, "Segoe UI", sans-serif`);
  }
  const radius = radii.find((r) => r.id === settings.radius);
  if (radius && radius.id !== "round") {
    ["--radius-xl", "--radius-lg", "--radius-md", "--radius-sm", "--radius-xs", "--radius-pill"].forEach((k, i) =>
      set(k, radius.sizes[i] + "px"),
    );
  }
}
