import { countRows } from "./cash";
import { differenceText, type ShiftReport } from "./report";
import { round } from "./stock";

type Format = (minor: number) => string;
type Ctx = CanvasRenderingContext2D;

const W = 540;
const PAD = 20;
const INNER = W - PAD * 2;
const CARD_PAD = 18;
const ink = "#0a0a0a";
const ink2 = "#6b6b6b";
const ink3 = "#8c8c8c";
const line = "#ececec";
const green = "#1e9e5a";
const red = "#d93025";

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 4000);
  });
}

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draw the shift report as a tall PNG for a group chat: the totals first, then cash,
 * stock, what sold and expenses, each in its own card so it scans on a phone.
 */
export async function reportImage(r: ShiftReport, fmt: Format): Promise<Blob> {
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  await document.fonts?.ready;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${family}`;
  const measure = document.createElement("canvas").getContext("2d")!;
  const width = (text: string, f: string) => {
    measure.font = f;
    return measure.measureText(text).width;
  };
  const fit = (text: string, f: string, max: number) => {
    if (width(text, f) <= max) return text;
    let t = text;
    while (t.length > 1 && width(t + "…", f) > max) t = t.slice(0, -1);
    return t + "…";
  };
  const wrap = (text: string, f: string, max: number) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (width(next, f) > max && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const brand = r.business.brand && /^#[0-9a-f]{6}$/i.test(r.business.brand) ? r.business.brand : "#111111";
  const logo = r.business.logo ? await loadImage(r.business.logo) : null;

  const ops: ((ctx: Ctx) => void)[] = [];
  let y = PAD;

  /* ---- header ---- */
  {
    const top = y;
    const x = PAD + 22;
    let hy = top + 24;
    const nameX = logo ? x + 56 : x;
    const lines: [string, string, string][] = [];
    lines.push([fit(r.business.name, font(19, 600), INNER - 44 - (logo ? 56 : 0)), font(19, 600), "#ffffff"]);
    lines.push([`Shift ${r.number} · ${r.date}`, font(14, 500), "rgba(255,255,255,0.78)"]);
    const meta = [r.hours, r.place].filter(Boolean).join(" · ");
    const people = r.people.join(", ");
    const headLines = 2;
    const logoY = hy;
    const nameY = hy;
    hy += 24 + 20;
    const extra: [string, string][] = [];
    for (const l of wrap(meta, font(13), INNER - 44)) extra.push([l, font(13)]);
    if (people) for (const l of wrap(people, font(13, 500), INNER - 44)) extra.push([l, font(13, 500)]);
    const extraY = Math.max(hy, logo ? logoY + 56 : hy) + 2;
    const totalY = extraY + extra.length * 19 + 22;
    const height = totalY - top + 76;
    ops.push((ctx) => {
      const g = ctx.createLinearGradient(PAD, top, W - PAD, top + height);
      g.addColorStop(0, brand);
      g.addColorStop(1, "#050505");
      ctx.fillStyle = g;
      rounded(ctx, PAD, top, INNER, height, 26);
      ctx.fill();
      if (logo) {
        ctx.save();
        rounded(ctx, x, logoY, 44, 44, 12);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.fillRect(x, logoY, 44, 44);
        const s = Math.max(44 / logo.width, 44 / logo.height);
        ctx.drawImage(logo, x + (44 - logo.width * s) / 2, logoY + (44 - logo.height * s) / 2, logo.width * s, logo.height * s);
        ctx.restore();
      }
      ctx.textBaseline = "top";
      lines.slice(0, headLines).forEach(([t, f, c], i) => {
        ctx.font = f;
        ctx.fillStyle = c;
        ctx.fillText(t, nameX, nameY + (i === 0 ? 0 : 26));
      });
      extra.forEach(([t, f], i) => {
        ctx.font = f;
        ctx.fillStyle = "rgba(255,255,255,0.66)";
        ctx.fillText(t, x, extraY + i * 19);
      });
      ctx.font = font(12, 500);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("NET SALES", x, totalY - 16);
      ctx.font = font(40, 600);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(fmt(r.sales.total), x, totalY + 2);
      const count = `${r.sales.count} ${r.sales.count === 1 ? "sale" : "sales"}${r.sales.reversed ? ` · ${r.sales.reversed} reversed` : ""}`;
      ctx.font = font(13, 500);
      const cw = width(count, font(13, 500));
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      rounded(ctx, W - PAD - 22 - cw - 20, totalY + 12, cw + 20, 28, 14);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(count, W - PAD - 22 - cw - 10, totalY + 19);
    });
    y = top + height + 12;
  }

  /* ---- cards ---- */
  function card(title: string, body: () => void) {
    const top = y;
    const box = { h: 0 };
    ops.push((ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.04)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
      rounded(ctx, PAD, top, INNER, box.h, 22);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.textBaseline = "top";
      ctx.font = font(12, 600);
      ctx.fillStyle = ink3;
      ctx.fillText(title.toUpperCase(), PAD + CARD_PAD, top + 16);
    });
    y = top + 40;
    body();
    y += 8;
    box.h = y - top;
    y += 12;
  }
  const L = PAD + CARD_PAD;
  const R = W - PAD - CARD_PAD;
  function row(
    label: string,
    value: string,
    opts: { sub?: string; bold?: boolean; color?: string; rule?: boolean; size?: number } = {},
  ) {
    const top = y;
    const size = opts.size ?? 15;
    const h = opts.sub ? 42 : 30;
    const vf = font(size, opts.bold ? 600 : 500);
    const vw = width(value, vf);
    const labelText = fit(label, font(size, opts.bold ? 600 : 400), R - L - vw - 16);
    ops.push((ctx) => {
      if (opts.rule) {
        ctx.fillStyle = line;
        ctx.fillRect(L, top - 2, R - L, 1);
      }
      ctx.textBaseline = "top";
      ctx.font = font(size, opts.bold ? 600 : 400);
      ctx.fillStyle = ink;
      ctx.fillText(labelText, L, top + 6);
      if (opts.sub) {
        ctx.font = font(12.5);
        ctx.fillStyle = ink3;
        ctx.fillText(fit(opts.sub, font(12.5), R - L - vw - 16), L, top + 25);
      }
      ctx.font = vf;
      ctx.fillStyle = opts.color ?? ink;
      ctx.textAlign = "right";
      ctx.fillText(value, R, top + 6);
      ctx.textAlign = "left";
    });
    y += h;
  }
  function note(text: string) {
    const lines = wrap(text, font(12.5), R - L);
    const top = y;
    ops.push((ctx) => {
      ctx.font = font(12.5);
      ctx.fillStyle = ink2;
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, L, top + 4 + i * 18));
    });
    y += lines.length * 18 + 8;
  }
  function pill(text: string, tone: "good" | "bad" | "warn") {
    const top = y + 4;
    const f = font(13, 600);
    const w = width(text, f) + 22;
    ops.push((ctx) => {
      ctx.fillStyle = tone === "good" ? "#e7f6ee" : tone === "bad" ? "#fdeceb" : "#fff4e0";
      rounded(ctx, L, top, w, 28, 14);
      ctx.fill();
      ctx.font = f;
      ctx.fillStyle = tone === "good" ? green : tone === "bad" ? red : "#a15c00";
      ctx.textBaseline = "top";
      ctx.fillText(text, L + 11, top + 7);
    });
    y += 40;
  }

  if (r.methods.length)
    card("Payments", () => {
      for (const m of r.methods) row(m.name, fmt(m.amount), { sub: `${m.count} ${m.count === 1 ? "sale" : "sales"}` });
      if (r.sales.discounts) row("Discounts given", fmt(r.sales.discounts), { color: ink2 });
    });

  card("Cash in the drawer", () => {
    row("Float", fmt(r.cash.float));
    row("Cash sales", "+ " + fmt(r.cash.sales));
    if (r.cash.expenses) row("Paid from the till", "− " + fmt(r.cash.expenses));
    row("Expected", fmt(r.cash.expected), { bold: true, rule: true });
    if (r.cash.counted !== undefined) {
      row("Cash on hand", fmt(r.cash.counted), { bold: true });
      if (r.cash.difference !== undefined)
        pill(
          r.cash.difference === 0 ? "Drawer matches" : differenceText(r.cash.difference, fmt),
          r.cash.difference === 0 ? "good" : r.cash.difference < 0 ? "bad" : "warn",
        );
      if (r.cash.count) note(countRows(r.cash.count).map((c) => `${fmt(c.value)} × ${c.qty}`).join("   "));
    }
  });

  if (r.stock.length)
    card("Stock", () => {
      const cols = [R - 150, R - 100, R - 50, R];
      const head = y;
      ops.push((ctx) => {
        ctx.font = font(11.5, 500);
        ctx.fillStyle = ink3;
        ctx.textAlign = "right";
        ["Start", "Used", "Left", "±"].forEach((t, i) => ctx.fillText(t, cols[i], head));
        ctx.textAlign = "left";
      });
      y += 20;
      for (const s of r.stock) {
        const top = y;
        const left = s.counted ?? s.expected;
        const off = s.counted !== undefined ? round(s.counted - s.expected) : 0;
        const n = (v: number) => round(v).toLocaleString("en", { maximumFractionDigits: 3 });
        const name = fit(s.name, font(15), cols[0] - 44 - L);
        ops.push((ctx) => {
          ctx.fillStyle = line;
          ctx.fillRect(L, top, R - L, 1);
          ctx.textBaseline = "top";
          ctx.font = font(15);
          ctx.fillStyle = ink;
          ctx.fillText(name, L, top + 10);
          ctx.font = font(12);
          ctx.fillStyle = ink3;
          ctx.fillText(s.unit, L, top + 29);
          ctx.textAlign = "right";
          ctx.font = font(15, 500);
          ctx.fillStyle = ink2;
          ctx.fillText(n(s.start), cols[0], top + 10);
          ctx.fillText(n(s.used), cols[1], top + 10);
          ctx.fillStyle = ink;
          ctx.font = font(15, 600);
          ctx.fillText(n(left), cols[2], top + 10);
          ctx.font = font(14, 600);
          ctx.fillStyle = off === 0 ? ink3 : off < 0 ? red : "#a15c00";
          ctx.fillText(s.counted === undefined ? "–" : off === 0 ? "✓" : (off > 0 ? "+" : "") + n(off), cols[3], top + 10);
          ctx.textAlign = "left";
        });
        y += 50;
      }
    });

  if (r.sold.length)
    card("What sold", () => {
      const max = r.sold[0].quantity || 1;
      for (const s of r.sold) {
        const top = y;
        const name = fit(s.name, font(15), R - L - 70);
        ops.push((ctx) => {
          ctx.textBaseline = "top";
          ctx.font = font(15);
          ctx.fillStyle = ink;
          ctx.fillText(name, L, top + 4);
          ctx.font = font(15, 600);
          ctx.textAlign = "right";
          ctx.fillText(String(s.quantity), R, top + 4);
          ctx.textAlign = "left";
          ctx.fillStyle = "#f0f0f0";
          rounded(ctx, L, top + 26, R - L, 4, 2);
          ctx.fill();
          ctx.fillStyle = brand;
          rounded(ctx, L, top + 26, Math.max(4, ((R - L) * s.quantity) / max), 4, 2);
          ctx.fill();
        });
        y += 40;
      }
    });

  if (r.expenses.length)
    card("Expenses", () => {
      for (const e of r.expenses)
        row(e.label, fmt(e.amount), { sub: e.source === "till" ? "From the till" : `Paid by ${e.by || "staff"}` });
      row("Total", fmt(r.tillExpenses + r.pocketExpenses), { bold: true, rule: true });
    });

  if (r.payBack.length) {
    const top = y;
    const lines = r.payBack.map((p) => `Pay back ${p.name} ${fmt(p.amount)}`);
    const h = 22 + lines.length * 24 + 12;
    ops.push((ctx) => {
      ctx.fillStyle = "#fff4e0";
      rounded(ctx, PAD, top, INNER, h, 20);
      ctx.fill();
      ctx.textBaseline = "top";
      ctx.font = font(15, 600);
      ctx.fillStyle = "#7a4600";
      lines.forEach((l, i) => ctx.fillText(l, L, top + 17 + i * 24));
    });
    y += h + 12;
  }

  if (!r.closed) {
    const top = y;
    ops.push((ctx) => {
      ctx.font = font(12.5);
      ctx.fillStyle = ink3;
      ctx.textBaseline = "top";
      ctx.fillText("Shift still open. These are the numbers so far.", PAD + 4, top);
    });
    y += 22;
  }
  y += PAD - 12;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = Math.ceil(y * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ededed";
  ctx.fillRect(0, 0, W, y);
  for (const op of ops) op(ctx);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Couldn't make the image."))), "image/png"),
  );
}

