import { countRows } from "./cash";
import { differenceText, type ShiftReport } from "./report";
import { round, unitText } from "./stock";

type Format = (minor: number) => string;
type Ctx = CanvasRenderingContext2D;
type Img = HTMLImageElement | null;

const W = 540;
const PAD = 18;
const INNER = W - PAD * 2;
const CP = 20; // card padding
const L = PAD + CP;
const R = W - PAD - CP;
const bg = "#f3f1ec";
const ink2 = "#6b6b6b";
const ink3 = "#9a9a9a";
const line = "#efefef";
const green = "#16a34a";
const red = "#dc2626";
const amber = "#b45309";
/** Colors for the payment donut, after the brand color. */
const palette = ["#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#64748b"];

function loadImage(src: string) {
  return new Promise<Img>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 5000);
  });
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

/** Draw an image to fill a box, cropped to the middle, with rounded corners. */
function cover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
}

function mix(hex: string, other: string, amount: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16));
  return "#" + a.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount).toString(16).padStart(2, "0")).join("");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

/**
 * The shift report as a picture for the group chat. It leads with the money, shows
 * where it came from, what sold with each item's photo, what's left in stock, and
 * whether the drawer matches, each in its own card so it reads at a glance on a phone.
 */
export async function reportImage(r: ShiftReport, fmt: Format): Promise<Blob> {
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  await document.fonts?.ready;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${family}`;
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#0a0a0a";
  const m = document.createElement("canvas").getContext("2d")!;
  const width = (text: string, f: string) => {
    m.font = f;
    return m.measureText(text).width;
  };
  const fit = (text: string, f: string, max: number) => {
    if (width(text, f) <= max) return text;
    let t = text;
    while (t.length > 1 && width(t + "…", f) > max) t = t.slice(0, -1);
    return t + "…";
  };
  const brand = r.business.brand && /^#[0-9a-f]{6}$/i.test(r.business.brand) ? r.business.brand : "#111111";
  const soft = mix(brand, "#ffffff", 0.88);

  // Load every picture first so drawing is one pass.
  const top = r.sold.slice(0, 6);
  const [logo, ...pics] = await Promise.all([
    r.business.logo ? loadImage(r.business.logo) : Promise.resolve(null),
    ...top.map((s) => (s.image ? loadImage(s.image) : Promise.resolve(null))),
  ]);
  const faces = await Promise.all(r.people.slice(0, 6).map((p) => (r.faces[p] ? loadImage(r.faces[p]) : Promise.resolve(null))));
  const payFaces = await Promise.all(r.payBack.map((p) => (r.faces[p.name] ? loadImage(r.faces[p.name]) : Promise.resolve(null))));

  const ops: ((ctx: Ctx) => void)[] = [];
  let y = PAD;

  const avatar = (ctx: Ctx, name: string, img: Img, x: number, cy: number, size: number, ring: string, fill: string, color: string) => {
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(x + size / 2, cy, size / 2 + 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (img) cover(ctx, img, x, cy - size / 2, size, size, size / 2);
    else {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x + size / 2, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = font(size * 0.36, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(name), x + size / 2, cy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    }
  };

  /* ---------- hero ---------- */
  {
    const t = y;
    const x = PAD + 22;
    const hasPeople = r.people.length > 0;
    const h = 236 + (hasPeople ? 58 : 0);
    const avg = r.sales.count ? Math.round(r.sales.total / r.sales.count) : 0;
    const stats = [
      `${r.sales.count} ${r.sales.count === 1 ? "sale" : "sales"}`,
      r.sales.count ? `avg ${fmt(avg)}` : "",
      r.peak && r.sales.count > 1 ? `busiest ${r.peak.hour}` : "",
    ].filter(Boolean);
    const where = [r.place, r.hours].filter(Boolean).join("  ·  ");
    ops.push((ctx) => {
      const g = ctx.createLinearGradient(PAD, t, W - PAD, t + h);
      g.addColorStop(0, mix(brand, "#ffffff", 0.08));
      g.addColorStop(0.55, brand);
      g.addColorStop(1, mix(brand, "#000000", 0.55));
      ctx.fillStyle = g;
      rr(ctx, PAD, t, INNER, h, 30);
      ctx.fill();
      // Soft light circles for depth.
      ctx.save();
      rr(ctx, PAD, t, INNER, h, 30);
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.arc(W - PAD - 40, t + 30, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.arc(W - PAD - 10, t + h - 10, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.textBaseline = "top";
      let nx = x;
      if (logo) {
        ctx.fillStyle = "#fff";
        rr(ctx, x - 2, t + 20, 48, 48, 14);
        ctx.fill();
        cover(ctx, logo, x, t + 22, 44, 44, 12);
        nx = x + 58;
      }
      ctx.font = font(11.5, 700);
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.fillText(`SHIFT ${r.number} REPORT`, nx, t + 24);
      ctx.font = font(20, 700);
      ctx.fillStyle = "#fff";
      ctx.fillText(fit(r.business.name, font(20, 700), R - nx - 110), nx, t + 41);
      // Date chip
      const date = r.date;
      const dw = width(date, font(13, 600)) + 24;
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      rr(ctx, W - PAD - 20 - dw, t + 26, dw, 30, 15);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = font(13, 600);
      ctx.fillText(date, W - PAD - 20 - dw + 12, t + 34);

      ctx.font = font(13, 500);
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.fillText(fit(where, font(13, 500), INNER - 44), x, t + 84);

      ctx.font = font(12, 600);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("NET SALES", x, t + 118);
      ctx.font = font(48, 700);
      ctx.fillStyle = "#fff";
      ctx.fillText(fmt(r.sales.total), x - 1, t + 134);

      let sx = x;
      ctx.font = font(13, 600);
      for (const s of stats) {
        const sw = width(s, font(13, 600)) + 22;
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        rr(ctx, sx, t + 196, sw, 28, 14);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(s, sx + 11, t + 203);
        sx += sw + 8;
      }

      if (hasPeople) {
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(x, t + 238, INNER - 44, 1);
        let px = x;
        r.people.slice(0, 6).forEach((name, i) => {
          avatar(ctx, name, faces[i], px, t + 266, 30, "rgba(255,255,255,0.35)", "#ffffff", brand);
          const first = name.split(" ")[0];
          ctx.font = font(13, 600);
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.fillText(first, px + 38, t + 267);
          ctx.textBaseline = "top";
          px += 38 + width(first, font(13, 600)) + 18;
        });
      }
    });
    y = t + h + 12;
  }

  /* ---------- three tiles ---------- */
  {
    const t = y;
    const tw = (INNER - 16) / 3;
    const itemsSold = r.sold.reduce((s, i) => s + i.quantity, 0);
    const diff = r.cash.difference;
    const tiles: { label: string; value: string; note: string; tone?: string }[] = [
      {
        label: "Cash on hand",
        value: fmt(r.cash.counted ?? r.cash.expected),
        note: diff === undefined ? "expected so far" : diff === 0 ? "✓ matches" : differenceText(diff, fmt),
        tone: diff === undefined ? ink3 : diff === 0 ? green : diff < 0 ? red : amber,
      },
      {
        label: "Expenses",
        value: fmt(r.tillExpenses + r.pocketExpenses),
        note: r.expenses.length ? `${r.expenses.length} logged` : "none",
      },
      {
        label: "Items sold",
        value: String(itemsSold),
        note: `${r.sold.length} ${r.sold.length === 1 ? "kind" : "kinds"}`,
      },
    ];
    ops.push((ctx) => {
      tiles.forEach((tile, i) => {
        const x = PAD + i * (tw + 8);
        ctx.fillStyle = "#fff";
        rr(ctx, x, t, tw, 92, 20);
        ctx.fill();
        ctx.textBaseline = "top";
        ctx.font = font(11.5, 600);
        ctx.fillStyle = ink3;
        ctx.fillText(tile.label.toUpperCase(), x + 14, t + 14);
        ctx.font = font(21, 700);
        ctx.fillStyle = ink;
        ctx.fillText(fit(tile.value, font(21, 700), tw - 28), x + 14, t + 36);
        ctx.font = font(12.5, 600);
        ctx.fillStyle = tile.tone ?? ink2;
        ctx.fillText(fit(tile.note, font(12.5, 600), tw - 28), x + 14, t + 66);
      });
    });
    y = t + 92 + 12;
  }

  /* ---------- cards ---------- */
  function card(title: string, body: () => void, right?: string) {
    const t = y;
    const box = { h: 0 };
    ops.push((ctx) => {
      ctx.fillStyle = "#fff";
      rr(ctx, PAD, t, INNER, box.h, 24);
      ctx.fill();
      ctx.textBaseline = "top";
      ctx.font = font(16, 700);
      ctx.fillStyle = ink;
      ctx.fillText(title, L, t + 20);
      if (right) {
        ctx.font = font(13, 600);
        ctx.fillStyle = ink3;
        ctx.textAlign = "right";
        ctx.fillText(right, R, t + 22);
        ctx.textAlign = "left";
      }
    });
    y = t + 54;
    body();
    y += 14;
    box.h = y - t;
    y += 12;
  }

  /* payments donut */
  if (r.methods.length) {
    card("Where the money came from", () => {
      const t = y;
      const size = 132;
      const total = r.methods.reduce((s, x) => s + x.amount, 0) || 1;
      const colors = r.methods.map((_, i) => (i === 0 ? brand : palette[(i - 1) % palette.length]));
      const rows = r.methods.length;
      const h = Math.max(size, rows * 46);
      ops.push((ctx) => {
        const cx = L + size / 2;
        const cy = t + h / 2;
        let a = -Math.PI / 2;
        ctx.lineWidth = 20;
        ctx.lineCap = "butt";
        r.methods.forEach((x, i) => {
          const sweep = (x.amount / total) * Math.PI * 2;
          ctx.strokeStyle = colors[i];
          ctx.beginPath();
          ctx.arc(cx, cy, size / 2 - 10, a, a + Math.max(sweep - 0.03, 0.01));
          ctx.stroke();
          a += sweep;
        });
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = font(22, 800);
        ctx.fillStyle = ink;
        ctx.fillText(String(r.sales.count), cx, cy - 7);
        ctx.font = font(12, 600);
        ctx.fillStyle = ink3;
        ctx.fillText(r.sales.count === 1 ? "sale" : "sales", cx, cy + 14);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const lx = L + size + 22;
        const top0 = cy - (rows * 46) / 2;
        r.methods.forEach((x, i) => {
          const ry = top0 + i * 46;
          ctx.fillStyle = colors[i];
          rr(ctx, lx, ry + 6, 12, 12, 4);
          ctx.fill();
          ctx.font = font(15, 600);
          ctx.fillStyle = ink;
          ctx.fillText(fit(x.name, font(15, 600), R - lx - 110), lx + 20, ry + 3);
          ctx.font = font(12.5, 500);
          ctx.fillStyle = ink3;
          ctx.fillText(`${Math.round((x.amount / total) * 100)}% · ${x.count} ${x.count === 1 ? "sale" : "sales"}`, lx + 20, ry + 23);
          ctx.font = font(15, 700);
          ctx.fillStyle = ink;
          ctx.textAlign = "right";
          ctx.fillText(fmt(x.amount), R, ry + 3);
          ctx.textAlign = "left";
        });
      });
      y = t + h;
      if (r.sales.discounts) {
        const dt = y + 10;
        ops.push((ctx) => {
          ctx.font = font(13, 500);
          ctx.fillStyle = ink2;
          ctx.fillText(`Discounts given: ${fmt(r.sales.discounts)}`, L, dt);
        });
        y = dt + 22;
      }
    }, fmt(r.sales.total));
  }

  /* sales by hour */
  if (r.hourly.length > 1) {
    card("Sales by hour", () => {
      const t = y;
      const ch = 96;
      const max = Math.max(...r.hourly.map((h) => h.total), 1);
      const n = r.hourly.length;
      const gap = 6;
      const bw = (R - L - gap * (n - 1)) / n;
      ops.push((ctx) => {
        r.hourly.forEach((h, i) => {
          const bh = Math.max(4, (h.total / max) * ch);
          const x = L + i * (bw + gap);
          ctx.fillStyle = h.label === r.peak?.hour ? brand : soft;
          rr(ctx, x, t + ch - bh, bw, bh, Math.min(8, bw / 2));
          ctx.fill();
          if (n <= 12 || i % 2 === 0) {
            ctx.font = font(10.5, 600);
            ctx.fillStyle = ink3;
            ctx.textAlign = "center";
            ctx.fillText(h.label.replace(" ", ""), x + bw / 2, t + ch + 8);
            ctx.textAlign = "left";
          }
        });
      });
      y = t + ch + 26;
    }, r.peak ? `busiest ${r.peak.hour}` : undefined);
  }

  /* best sellers with photos */
  if (top.length) {
    card("Best sellers", () => {
      const cols = 3;
      const gap = 10;
      const tw = (R - L - gap * (cols - 1)) / cols;
      const th = tw + 58;
      const rows = Math.ceil(top.length / cols);
      const t = y;
      ops.push((ctx) => {
        top.forEach((s, i) => {
          const x = L + (i % cols) * (tw + gap);
          const ty = t + Math.floor(i / cols) * (th + gap);
          const img = pics[i];
          if (img) cover(ctx, img, x, ty, tw, tw, 16);
          else {
            const g = ctx.createLinearGradient(x, ty, x + tw, ty + tw);
            g.addColorStop(0, mix(brand, "#ffffff", 0.75));
            g.addColorStop(1, mix(brand, "#ffffff", 0.55));
            ctx.fillStyle = g;
            rr(ctx, x, ty, tw, tw, 16);
            ctx.fill();
            ctx.fillStyle = mix(brand, "#000000", 0.2);
            ctx.font = font(28, 700);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(initials(s.name), x + tw / 2, ty + tw / 2);
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
          }
          // Rank and quantity badges
          ctx.fillStyle = i === 0 ? brand : "rgba(0,0,0,0.55)";
          rr(ctx, x + 8, ty + 8, 26, 22, 11);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = font(12, 700);
          ctx.textAlign = "center";
          ctx.fillText(String(i + 1), x + 21, ty + 12);
          ctx.textAlign = "left";
          const q = `×${s.quantity}`;
          const qw = width(q, font(15, 700)) + 18;
          ctx.fillStyle = "#fff";
          rr(ctx, x + tw - qw - 8, ty + tw - 36, qw, 28, 14);
          ctx.fill();
          ctx.fillStyle = ink;
          ctx.font = font(15, 700);
          ctx.fillText(q, x + tw - qw + 1, ty + tw - 30);
          ctx.font = font(13.5, 600);
          ctx.fillStyle = ink;
          ctx.fillText(fit(s.name, font(13.5, 600), tw), x, ty + tw + 10);
          ctx.font = font(12.5, 500);
          ctx.fillStyle = ink3;
          ctx.fillText(fmt(s.revenue), x, ty + tw + 30);
        });
      });
      y = t + rows * th + (rows - 1) * gap;
      const rest = r.sold.slice(top.length);
      if (rest.length) {
        const rt = y + 12;
        const text = rest.map((s) => `${s.name} ×${s.quantity}`).join("  ·  ");
        const lines: string[] = [];
        let cur = "";
        for (const part of text.split("  ·  ")) {
          const next = cur ? cur + "  ·  " + part : part;
          if (width(next, font(13, 500)) > R - L && cur) {
            lines.push(cur);
            cur = part;
          } else cur = next;
        }
        if (cur) lines.push(cur);
        ops.push((ctx) => {
          ctx.font = font(13, 500);
          ctx.fillStyle = ink2;
          lines.forEach((l, i) => ctx.fillText(l, L, rt + i * 20));
        });
        y = rt + lines.length * 20;
      }
    }, `${r.sold.reduce((s, i) => s + i.quantity, 0)} items`);
  }

  /* stock bars */
  if (r.stock.length) {
    card("Stock", () => {
      for (const s of r.stock) {
        const t = y;
        const left = s.counted ?? s.expected;
        const off = s.counted !== undefined ? round(s.counted - s.expected) : 0;
        const n = (v: number) => round(v).toLocaleString("en", { maximumFractionDigits: 3 });
        const chip =
          s.counted === undefined ? "" : off === 0 ? "✓ matches" : off < 0 ? `${n(-off)} missing` : `${n(off)} extra`;
        const tone = off === 0 ? green : off < 0 ? red : amber;
        ops.push((ctx) => {
          ctx.textBaseline = "top";
          ctx.font = font(15, 600);
          ctx.fillStyle = ink;
          ctx.fillText(fit(s.name, font(15, 600), R - L - 170), L, t);
          const right = `${n(left)} of ${unitText(s.start, s.unit)} left`;
          ctx.font = font(13, 600);
          ctx.fillStyle = ink2;
          ctx.textAlign = "right";
          ctx.fillText(right, R, t + 2);
          ctx.textAlign = "left";
          // Track = what we opened with; colored part = what's left.
          const bw = R - L;
          ctx.fillStyle = "#f1f1f1";
          rr(ctx, L, t + 26, bw, 10, 5);
          ctx.fill();
          const frac = s.start ? Math.max(0, Math.min(1, left / s.start)) : 0;
          ctx.fillStyle = frac < 0.2 ? red : brand;
          if (frac > 0) {
            rr(ctx, L, t + 26, Math.max(10, bw * frac), 10, 5);
            ctx.fill();
          }
          ctx.font = font(12, 500);
          ctx.fillStyle = ink3;
          ctx.fillText(`${n(s.used)} used`, L, t + 44);
          if (chip) {
            ctx.font = font(12, 700);
            ctx.fillStyle = tone;
            ctx.textAlign = "right";
            ctx.fillText(chip, R, t + 44);
            ctx.textAlign = "left";
          }
        });
        y = t + 70;
      }
      y -= 8;
    });
  }

  /* cash drawer */
  card("Cash drawer", () => {
    const steps: [string, string, string?][] = [
      ["Float", fmt(r.cash.float)],
      ["Cash sales", "+ " + fmt(r.cash.sales), green],
    ];
    if (r.cash.expenses) steps.push(["Paid from the till", "− " + fmt(r.cash.expenses), red]);
    for (const [label, value, color] of steps) {
      const t = y;
      ops.push((ctx) => {
        ctx.font = font(15, 500);
        ctx.fillStyle = ink2;
        ctx.fillText(label, L, t);
        ctx.font = font(15, 600);
        ctx.fillStyle = color ?? ink;
        ctx.textAlign = "right";
        ctx.fillText(value, R, t);
        ctx.textAlign = "left";
      });
      y += 30;
    }
    {
      const t = y + 4;
      ops.push((ctx) => {
        ctx.fillStyle = line;
        ctx.fillRect(L, t - 6, R - L, 1);
        ctx.font = font(16, 700);
        ctx.fillStyle = ink;
        ctx.fillText("Expected", L, t + 4);
        ctx.textAlign = "right";
        ctx.fillText(fmt(r.cash.expected), R, t + 4);
        ctx.textAlign = "left";
      });
      y = t + 34;
    }
    if (r.cash.counted !== undefined) {
      const t = y;
      const diff = r.cash.difference ?? 0;
      const tone = diff === 0 ? green : diff < 0 ? red : amber;
      const toneBg = diff === 0 ? "#e8f7ee" : diff < 0 ? "#fdecec" : "#fff3e0";
      const status = diff === 0 ? "Drawer matches" : differenceText(diff, fmt);
      ops.push((ctx) => {
        ctx.fillStyle = toneBg;
        rr(ctx, L - 6, t, R - L + 12, 58, 16);
        ctx.fill();
        ctx.font = font(12, 700);
        ctx.fillStyle = tone;
        ctx.fillText(status.toUpperCase(), L + 8, t + 11);
        ctx.font = font(16, 700);
        ctx.fillStyle = ink;
        ctx.fillText("Cash on hand", L + 8, t + 30);
        ctx.font = font(22, 700);
        ctx.textAlign = "right";
        ctx.fillText(fmt(r.cash.counted!), R - 8, t + 18);
        ctx.textAlign = "left";
      });
      y = t + 70;
      const coins = countRows(r.cash.count);
      if (coins.length) {
        let x = L;
        let cy = y;
        const chips: { x: number; y: number; text: string; w: number }[] = [];
        for (const c of coins) {
          const text = `${fmt(c.value)} × ${c.qty}`;
          const w = width(text, font(12.5, 600)) + 20;
          if (x + w > R) {
            x = L;
            cy += 34;
          }
          chips.push({ x, y: cy, text, w });
          x += w + 6;
        }
        ops.push((ctx) => {
          for (const c of chips) {
            ctx.fillStyle = "#f4f4f2";
            rr(ctx, c.x, c.y, c.w, 28, 14);
            ctx.fill();
            ctx.font = font(12.5, 600);
            ctx.fillStyle = ink2;
            ctx.fillText(c.text, c.x + 10, c.y + 7);
          }
        });
        y = cy + 30;
      }
    }
  });

  /* expenses */
  if (r.expenses.length)
    card("Expenses", () => {
      for (const e of r.expenses) {
        const t = y;
        const tag = e.source === "till" ? "From till" : `Paid by ${(e.by || "staff").split(" ")[0]}`;
        ops.push((ctx) => {
          ctx.fillStyle = e.source === "till" ? soft : "#fff3e0";
          ctx.beginPath();
          ctx.arc(L + 16, t + 16, 16, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = font(14, 700);
          ctx.fillStyle = e.source === "till" ? brand : amber;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(e.label.slice(0, 1).toUpperCase(), L + 16, t + 17);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.font = font(15, 600);
          ctx.fillStyle = ink;
          ctx.fillText(fit(e.label, font(15, 600), R - L - 160), L + 44, t);
          ctx.font = font(12.5, 500);
          ctx.fillStyle = ink3;
          ctx.fillText(tag, L + 44, t + 19);
          ctx.font = font(15, 700);
          ctx.fillStyle = ink;
          ctx.textAlign = "right";
          ctx.fillText(fmt(e.amount), R, t + 8);
          ctx.textAlign = "left";
        });
        y += 46;
      }
      y -= 6;
    }, fmt(r.tillExpenses + r.pocketExpenses));

  /* pay back */
  r.payBack.forEach((p, i) => {
    const t = y;
    ops.push((ctx) => {
      ctx.fillStyle = "#fff3e0";
      rr(ctx, PAD, t, INNER, 68, 22);
      ctx.fill();
      avatar(ctx, p.name, payFaces[i], L, t + 34, 36, "#ffffff", amber, "#fff");
      ctx.textBaseline = "top";
      ctx.font = font(12, 700);
      ctx.fillStyle = amber;
      ctx.fillText("PAY BACK", L + 50, t + 16);
      ctx.font = font(16, 700);
      ctx.fillStyle = "#5c3200";
      ctx.fillText(fit(p.name, font(16, 700), R - L - 160), L + 50, t + 34);
      ctx.font = font(22, 700);
      ctx.textAlign = "right";
      ctx.fillText(fmt(p.amount), R, t + 22);
      ctx.textAlign = "left";
    });
    y = t + 68 + 12;
  });

  /* footer */
  {
    const t = y + 2;
    ops.push((ctx) => {
      ctx.font = font(12, 500);
      ctx.fillStyle = ink3;
      ctx.textAlign = "center";
      ctx.fillText(r.closed ? `${r.business.name} · ${r.date} · ${r.hours}` : "Shift still open · numbers so far", W / 2, t);
      ctx.textAlign = "left";
    });
    y = t + 18 + PAD;
  }

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = Math.ceil(y * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, y);
  ctx.textBaseline = "top";
  for (const op of ops) {
    ctx.save();
    op(ctx);
    ctx.restore();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Couldn't make the image."))), "image/png"),
  );
}
