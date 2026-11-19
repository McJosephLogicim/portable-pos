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
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or black text, whichever reads better on the color. */
export function onColor(hex: string) {
  return luminance(hex) > 0.36 ? "#0a0a0a" : "#ffffff";
}

const vars = ["--accent", "--accent-ring", "--on-accent", "--on-accent-secondary", "--glossy", "--ink", "--font-sans", "--brand",
  "--radius-xl", "--radius-lg", "--radius-md", "--radius-sm", "--radius-xs", "--radius-pill"];

/** Theme the whole app from the business's branding: buttons, text, font and corners. */
export function applyTheme(settings: Pick<Settings, "brand" | "font" | "radius" | "ink"> | undefined) {
  const root = document.documentElement;
  for (const v of vars) root.style.removeProperty(v);
  root.classList.toggle("branded", Boolean(settings?.brand));
  if (!settings) return;
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  if (settings.brand && /^#[0-9a-f]{6}$/i.test(settings.brand)) {
    const on = onColor(settings.brand);
    set("--brand", settings.brand);
    set("--accent", settings.brand);
    set("--accent-ring", settings.brand);
    set("--on-accent", on);
    set("--on-accent-secondary", on === "#ffffff" ? "rgb(255 255 255 / 0.7)" : "rgb(0 0 0 / 0.55)");
    set("--glossy", `linear-gradient(180deg, color-mix(in srgb, ${settings.brand} 82%, #fff) 0%, ${settings.brand} 100%)`);
  }
  if (settings.ink && /^#[0-9a-f]{6}$/i.test(settings.ink)) set("--ink", settings.ink);
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
