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

export const inks = [
  "#0a0a0a", "#1f2937", "#3b2f2f", "#14342b", "#1e2a4a", "#3b1d4a",
  "#ffffff", "#fff2d9", "#ffe4ef", "#e5f7ed", "#e4eeff", "#efe5ff",
];
export const defaultBrand = "#0a0a0a";

export type FontId = (typeof fonts)[number]["id"];
export type RadiusId = (typeof radii)[number]["id"];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const hexColor = /^#[0-9a-f]{6}$/i;
const textContrast = 4.5;

/** Pick the higher-contrast automatic text color for a surface. */
export function onColor(hex: string) {
  const lightness = luminance(hex) + 0.05;
  const blackContrast = lightness / 0.05;
  const whiteContrast = 1.05 / lightness;
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

function mixHex(from: string, to: string, amount: number) {
  const channels = [1, 3, 5].map((i) => {
    const start = parseInt(from.slice(i, i + 2), 16);
    const end = parseInt(to.slice(i, i + 2), 16);
    return Math.round(start + (end - start) * amount).toString(16).padStart(2, "0");
  });
  return "#" + channels.join("");
}

/** Keep the chosen text color readable by tinting its background as needed. */
export function brandColors(brand: string, ink?: string) {
  if (!ink || !hexColor.test(ink)) return { background: brand, color: onColor(brand) };

  const foreground = luminance(ink) + 0.05;
  const shade = onColor(ink);
  let background = brand;
  for (let percent = 1; percent <= 100; percent++) {
    const surface = luminance(background) + 0.05;
    if (Math.max(surface, foreground) / Math.min(surface, foreground) >= textContrast) break;
    background = mixHex(brand, shade, percent / 100);
  }
  return { background, color: ink };
}

/** POP POS colors shared by the leaderboard and the share image. */
export const leaderboardColors = {
  background: "#080d1b",
  surface: "#171e30",
  line: "#29354d",
  ink: "#f5f8ff",
  muted: "#b5c2d9",
  halo: "#164186",
  first: "#91d9ff",
  second: "#aab9d6",
  third: "#adaaf0",
} as const;

const vars = ["--accent", "--accent-ring", "--accent-pressed", "--on-accent", "--hero", "--on-hero", "--glossy", "--ink", "--font-sans", "--brand",
  "--radius-xl", "--radius-lg", "--radius-md", "--radius-sm", "--radius-xs", "--radius-pill"];

/** Theme the whole app from the business's branding: buttons, text, font and corners. */
export function applyTheme(settings: Pick<Settings, "brand" | "font" | "radius" | "ink"> | undefined) {
  const root = document.documentElement;
  for (const v of vars) root.style.removeProperty(v);
  const brand = settings?.brand && hexColor.test(settings.brand) ? settings.brand : undefined;
  root.classList.toggle("branded", Boolean(brand));
  if (!settings) return;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  const ink = settings.ink && hexColor.test(settings.ink) ? settings.ink : undefined;
  const accent = brand ?? defaultBrand;
  if (brand || ink) {
    const { background, color } = brandColors(accent, ink);
    const lightText = luminance(color) > luminance(background);
    const shade = lightText ? "#000" : "#fff";
    const gloss = `color-mix(in srgb, ${background} 82%, ${shade})`;
    const glossStops = lightText ? `${background}, ${gloss}` : `${gloss}, ${background}`;
    set("--accent", background);
    set("--on-accent", color);
    set("--accent-pressed", `color-mix(in srgb, ${background} 88%, ${shade})`);
    set("--glossy", `linear-gradient(180deg in srgb, ${glossStops})`);
  }
  let brightestHero = luminance("#333333");
  if (brand) {
    set("--brand", brand);
    set("--accent-ring", brand);
    // Bright brands need a darker tint for white text across the hero gradient.
    const start = mixHex("#000000", brand, onColor(brand) === "#ffffff" ? 0.88 : 0.45);
    const middle = mixHex("#0b0b0b", brand, 0.35);
    set("--hero", `radial-gradient(130% 150% at 0% 0% in srgb, ${start} 0%, ${middle} 55%, #060606 100%)`);
    brightestHero = Math.max(luminance(start), luminance(middle), luminance("#060606"));
  }
  if (ink) {
    const lightness = luminance(ink) + 0.05;
    if (lightness / (brightestHero + 0.05) >= textContrast) set("--on-hero", ink);
    if ((luminance("#ededed") + 0.05) / lightness >= textContrast) set("--ink", ink);
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
