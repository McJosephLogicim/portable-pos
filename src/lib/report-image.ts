import { countRows } from "./cash";
import type { LeaderboardShare } from "./insights";
import { differenceText, type ShiftReport } from "./report";
import { round, unitText } from "./stock";

type Format = (minor: number) => string;
type Ctx = CanvasRenderingContext2D;
type Img = HTMLImageElement | null;

const W = 540;
const G = 20; // page gutter
const CARD = W - G * 2;
const P = 20; // card padding
const L = G + P;
const R = W - G - P;

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
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, h / 2, w / 2)));
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

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

/**
 * The shift report as a picture for the group chat, drawn like a screen of the app:
 * grey page, white cards, one black card, a sentence that says what happened, and
 * real photos of what sold.
 */
export async function reportImage(r: ShiftReport, fmt: Format): Promise<Blob> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  await document.fonts?.ready;
  const font = (size: number, weight = 400) => `${weight} ${size}px ${family}`;
  const canvasBg = v("--canvas", "#ededed");
  const surface = v("--surface", "#ffffff");
  const muted = v("--surface-muted", "#f2f2f2");
  const ink = v("--ink", "#0a0a0a");
  const ink2 = v("--ink-secondary", "#6b6b6b");
  const ink3 = v("--ink-tertiary", "#8c8c8c");
  const line = v("--line", "#ebebeb");
  const track = v("--track", "#eeeeee");
  const accent = v("--accent", "#0a0a0a");
  const onAccent = v("--on-accent", "#ffffff");
  const danger = v("--danger", "#d93025");
  const dangerDot = v("--danger-dot", "#e5484d");
  const success = v("--success", "#1e9e5a");
  const px = (name: string, fallback: number) => parseFloat(v(name, "")) || fallback;
  const rLg = Math.min(px("--radius-lg", 24), 28);
  const rMd = Math.min(px("--radius-md", 20), 24);
  const rSm = Math.min(px("--radius-sm", 14), 18);

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
  /** Wrap words that keep their own color, like the app's black-and-grey headlines. */
  const wrap = (parts: { text: string; color: string }[], f: string, max: number) => {
    const words = parts.flatMap((p) => p.text.split(/(?<= )/).filter(Boolean).map((w) => ({ w, color: p.color })));
    const lines: { w: string; color: string; x: number }[][] = [[]];
    let x = 0;
    for (const word of words) {
      const ww = width(word.w.trimEnd(), f);
      if (x > 0 && x + ww > max) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1].push({ ...word, x });
      x += width(word.w, f);
    }
    return lines;
  };

  const sold = r.sold.slice(0, 12);
  const [logo, ...pics] = await Promise.all([
    r.business.logo ? loadImage(r.business.logo) : Promise.resolve(null),
    ...sold.map((s) => (s.image ? loadImage(s.image) : Promise.resolve(null))),
  ]);
  const people = r.people.slice(0, 8);
  const faces = await Promise.all(people.map((p) => (r.faces[p] ? loadImage(r.faces[p]) : Promise.resolve(null))));
  const payFaces = await Promise.all(r.payBack.map((p) => (r.faces[p.name] ? loadImage(r.faces[p.name]) : Promise.resolve(null))));

  const ops: ((ctx: Ctx) => void)[] = [];
  let y = 28;

  const text = (ctx: Ctx, s: string, x: number, ty: number, f: string, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = f;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, ty);
    ctx.textAlign = "left";
  };
  const dot = (ctx: Ctx, x: number, cy: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 4, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  };
  const bar = (ctx: Ctx, x: number, ty: number, w: number, frac: number, color = accent) => {
    ctx.fillStyle = track;
    rr(ctx, x, ty, w, 3, 1.5);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = color;
      rr(ctx, x, ty, Math.max(3, w * Math.min(1, frac)), 3, 1.5);
      ctx.fill();
    }
  };
  const avatar = (ctx: Ctx, name: string, img: Img, x: number, ty: number, size: number) => {
    if (img) return cover(ctx, img, x, ty, size, size, size / 2);
    ctx.fillStyle = muted;
    ctx.beginPath();
    ctx.arc(x + size / 2, ty + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = "middle";
    text(ctx, initials(name), x + size / 2, ty + size / 2 + 0.5, font(size * 0.34, 500), ink2, "center");
    ctx.textBaseline = "top";
  };
  /** A white card, with an optional section title and a grey note on the right. */
  const card = (h: number, draw: (ctx: Ctx, top: number) => void, title?: string, note?: string) => {
    const t = y;
    const head = title ? 40 : 0;
    const total = P + head + h + P;
    ops.push((ctx) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.05)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = surface;
      rr(ctx, G, t, CARD, total, rLg);
      ctx.fill();
      ctx.restore();
      if (title) text(ctx, title, L, t + P, font(18, 500), ink);
      if (title && note) text(ctx, note, R, t + P + 3, font(14), ink3, "right");
      draw(ctx, t + P + head);
    });
    y += total + 12;
  };
  const divider = (ctx: Ctx, ty: number) => {
    ctx.fillStyle = line;
    ctx.fillRect(L, ty, R - L, 1);
  };

  /* ---------- header: the business and the shift ---------- */
  {
    const t = y;
    const where = [r.date, r.hours].join(" · ");
    ops.push((ctx) => {
      const size = 44;
      if (logo) cover(ctx, logo, G, t, size, size, rSm);
      else {
        const g = ctx.createLinearGradient(0, t, 0, t + size);
        g.addColorStop(0, "#3a3a3a");
        g.addColorStop(1, "#0e0e0e");
        ctx.fillStyle = accent === "#0a0a0a" ? g : accent;
        rr(ctx, G, t, size, size, rSm);
        ctx.fill();
        ctx.textBaseline = "middle";
        text(ctx, initials(r.business.name), G + size / 2, t + size / 2 + 0.5, font(16, 500), onAccent, "center");
        ctx.textBaseline = "top";
      }
      text(ctx, fit(r.business.name, font(16, 500), W - G * 2 - 60), G + size + 12, t + 3, font(16, 500), ink);
      text(ctx, fit(`Shift ${r.number} · ${where}`, font(13), W - G * 2 - 60), G + size + 12, t + 25, font(13), ink2);
    });
    y += 44 + 26;
  }

  /* ---------- the sentence ---------- */
  {
    const t = y;
    const f = font(30, 500);
    const sales = `${r.sales.count} ${r.sales.count === 1 ? "sale" : "sales"}`;
    const only = r.methods.length === 1 ? ` ${r.methods[0].name.toLowerCase() === "cash" ? "in cash" : `by ${r.methods[0].name}`}` : "";
    const parts = [
      { text: `${fmt(r.sales.total)} in sales `, color: ink },
      { text: `from ${sales}${only}${r.place ? ` at ${r.place}` : ""}${r.closed ? "." : " so far."}`, color: ink3 },
    ];
    const lines = wrap(parts, f, W - G * 2);
    ops.push((ctx) => {
      ctx.font = f;
      lines.forEach((ln, i) =>
        ln.forEach((w) => {
          ctx.fillStyle = w.color;
          ctx.fillText(w.w, G + w.x, t + i * 34);
        }),
      );
    });
    y += lines.length * 34 + 20;
  }

  /* ---------- the drawer: the one black card ---------- */
  {
    const t = y;
    const h = 142;
    const counted = r.cash.counted;
    const diff = r.cash.difference;
    ops.push((ctx) => {
      const g = ctx.createRadialGradient(G, t, 0, G, t, CARD * 1.2);
      if (accent === "#0a0a0a") {
        g.addColorStop(0, "#333333");
        g.addColorStop(0.45, "#111111");
        g.addColorStop(1, "#050505");
        ctx.fillStyle = g;
      } else ctx.fillStyle = accent;
      rr(ctx, G, t, CARD, h, rLg);
      ctx.fill();
      const soft = onAccent === "#ffffff" ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)";
      text(ctx, counted !== undefined ? "Cash on hand" : "Expected in the drawer", L, t + 22, font(14), soft);
      text(ctx, fmt(counted ?? r.cash.expected), L, t + 44, font(44, 500), onAccent);
      if (counted !== undefined && diff !== undefined) {
        dot(ctx, L, t + 112, diff === 0 ? success : dangerDot);
        text(
          ctx,
          diff === 0 ? `Matches the ${fmt(r.cash.expected)} expected` : `${differenceText(diff, fmt)} of the ${fmt(r.cash.expected)} expected`,
          L + 16,
          t + 104,
          font(14),
          onAccent,
        );
      } else text(ctx, `Float ${fmt(r.cash.float)} plus cash sales, less till expenses`, L, t + 104, font(14), soft);
    });
    y += h + 12;
  }

  /* ---------- three numbers ---------- */
  {
    const t = y;
    const avg = r.sales.count ? Math.round(r.sales.total / r.sales.count) : 0;
    const items = r.sold.reduce((n, s) => n + s.quantity, 0);
    const tiles = [
      { label: "Items sold", value: String(round(items)), note: `${r.sold.length} ${r.sold.length === 1 ? "kind" : "kinds"}` },
      { label: "Average sale", value: fmt(avg), note: r.peak && r.sales.count > 1 ? `Busiest at ${r.peak.hour}` : "per sale" },
      { label: "Expenses", value: fmt(r.tillExpenses + r.pocketExpenses), note: `${r.expenses.length} logged` },
    ];
    const gap = 10;
    const tw = (CARD - gap * 2) / 3;
    const h = 112;
    ops.push((ctx) => {
      tiles.forEach((tile, i) => {
        const x = G + i * (tw + gap);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.05)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.fillStyle = surface;
        rr(ctx, x, t, tw, h, rMd);
        ctx.fill();
        ctx.restore();
        text(ctx, tile.label, x + 16, t + 18, font(13), ink2);
        const vf = font(24, 500);
        let size = 24;
        while (size > 15 && width(tile.value, font(size, 500)) > tw - 32) size--;
        text(ctx, tile.value, x + 16, t + 42, size === 24 ? vf : font(size, 500), ink);
        text(ctx, fit(tile.note, font(12.5), tw - 32), x + 16, t + 80, font(12.5), ink3);
      });
    });
    y += h + 12;
  }

  /* ---------- who worked ---------- */
  if (people.length) {
    const row = 52;
    card(people.length * row - 8, (ctx, top) => {
      people.forEach((p, i) => {
        const ty = top + i * row;
        if (i) divider(ctx, ty - 8);
        avatar(ctx, p, faces[i], L, ty, 36);
        const role = r.roles[p];
        text(ctx, fit(p, font(15, 500), R - L - 52), L + 50, role ? ty : ty + 9, font(15, 500), ink);
        if (role) text(ctx, role, L + 50, ty + 20, font(13.5), ink2);
      });
    }, "On shift", r.place ? undefined : r.hours);
  }

  /* ---------- what sold ---------- */
  if (sold.length) {
    const row = 72;
    const more = r.sold.length - sold.length;
    card(sold.length * row - 12 + (more ? 28 : 0), (ctx, top) => {
      sold.forEach((s, i) => {
        const ty = top + i * row;
        if (i) divider(ctx, ty - 12);
        const size = 56;
        const img = pics[i];
        if (img) cover(ctx, img, L, ty, size, size, rSm);
        else {
          ctx.fillStyle = muted;
          rr(ctx, L, ty, size, size, rSm);
          ctx.fill();
          ctx.textBaseline = "middle";
          text(ctx, initials(s.name), L + size / 2, ty + size / 2, font(16, 500), ink3, "center");
          ctx.textBaseline = "top";
        }
        const money = fmt(s.revenue);
        const mw = width(money, font(15, 500));
        text(ctx, fit(s.name, font(15, 500), R - L - size - 30 - mw), L + size + 14, ty + 10, font(15, 500), ink);
        text(ctx, `${round(s.quantity)} sold`, L + size + 14, ty + 32, font(13.5), ink2);
        text(ctx, money, R, ty + 10, font(15, 500), ink, "right");
      });
      if (more) text(ctx, `and ${more} more`, L, top + sold.length * row - 4, font(13.5), ink2);
    }, "What sold", `${r.sold.reduce((n, s) => n + s.quantity, 0)} items`);
  }

  /* ---------- how they paid ---------- */
  // One way of paying needs no card: the sentence already has the total.
  if (r.methods.length > 1) {
    const row = 54;
    const total = r.methods.reduce((n, x) => n + x.amount, 0) || 1;
    card(r.methods.length * row - 10, (ctx, top) => {
      r.methods.forEach((x, i) => {
        const ty = top + i * row;
        text(ctx, x.name, L, ty, font(15, 500), ink);
        const amount = fmt(x.amount);
        text(ctx, amount, R, ty, font(15, 500), ink, "right");
        const cw = width(amount, font(15, 500));
        text(ctx, `${x.count} ${x.count === 1 ? "sale" : "sales"}`, R - cw - 10, ty + 1, font(14), ink3, "right");
        bar(ctx, L, ty + 28, R - L, x.amount / total);
      });
    }, "How they paid");
  }

  /* ---------- stock ---------- */
  if (r.stock.length) {
    const rows = r.stock.map((s) => {
      const left = s.counted ?? s.expected;
      const off = s.counted !== undefined ? round(s.counted - s.expected) : 0;
      return { s, left, off };
    });
    const heights = rows.map((x) => (x.off ? 70 : 52));
    card(heights.reduce((a, b) => a + b, 0) - 10, (ctx, top) => {
      let ty = top;
      rows.forEach(({ s, left, off }, i) => {
        text(ctx, fit(s.name, font(15, 500), 240), L, ty, font(15, 500), ink);
        text(ctx, `${unitText(left, s.unit)} left`, R, ty + 1, font(14), ink2, "right");
        bar(ctx, L, ty + 28, R - L, s.start ? left / s.start : 0);
        if (off) {
          dot(ctx, L, ty + 48, dangerDot);
          text(
            ctx,
            off < 0 ? `${unitText(-off, s.unit)} missing` : `${unitText(off, s.unit)} more than expected`,
            L + 16,
            ty + 41,
            font(13.5),
            off < 0 ? danger : ink2,
          );
        }
        ty += heights[i];
      });
    }, "Stock", "left of what you opened with");
  }

  /* ---------- the drawer, step by step ---------- */
  {
    const steps: { label: string; value: string; strong?: boolean }[] = [
      { label: "Float", value: fmt(r.cash.float) },
      { label: "Cash sales", value: "+ " + fmt(r.cash.sales) },
      ...(r.cash.expenses ? [{ label: "Paid from the till", value: "− " + fmt(r.cash.expenses) }] : []),
      { label: "Expected", value: fmt(r.cash.expected), strong: true },
      ...(r.cash.counted !== undefined ? [{ label: "Counted", value: fmt(r.cash.counted), strong: true }] : []),
    ];
    const coins = countRows(r.cash.count).map((c) => `${fmt(c.value)} × ${c.qty}`).join("   ");
    const coinLines = coins ? wrap([{ text: coins, color: ink2 }], font(13.5), R - L) : [];
    const row = 38;
    card(steps.length * row - 12 + (coinLines.length ? 18 + coinLines.length * 20 : 0), (ctx, top) => {
      steps.forEach((s, i) => {
        const ty = top + i * row;
        if (s.label === "Expected") divider(ctx, ty - 11);
        const f = font(15, s.strong ? 500 : 400);
        text(ctx, s.label, L, ty, f, s.strong ? ink : ink2);
        text(ctx, s.value, R, ty, f, ink, "right");
      });
      const ct = top + steps.length * row + 6;
      ctx.font = font(13.5);
      coinLines.forEach((ln, i) =>
        ln.forEach((w) => {
          ctx.fillStyle = ink2;
          ctx.fillText(w.w, L + w.x, ct + i * 20);
        }),
      );
    }, "Cash drawer");
  }

  /* ---------- expenses ---------- */
  if (r.expenses.length) {
    const row = 58;
    card(r.expenses.length * row - 14, (ctx, top) => {
      r.expenses.forEach((e, i) => {
        const ty = top + i * row;
        if (i) divider(ctx, ty - 14);
        const amount = fmt(e.amount);
        text(ctx, fit(e.label, font(15, 500), R - L - width(amount, font(15, 500)) - 16), L, ty, font(15, 500), ink);
        text(ctx, e.source === "till" ? "From the till" : `Paid by ${e.by || "staff"}`, L, ty + 22, font(13.5), ink2);
        text(ctx, amount, R, ty, font(15, 500), ink, "right");
      });
    }, "Expenses");
  }

  /* ---------- pay back ---------- */
  if (r.payBack.length) {
    const row = 52;
    card(r.payBack.length * row - 8, (ctx, top) => {
      r.payBack.forEach((p, i) => {
        const ty = top + i * row;
        if (i) divider(ctx, ty - 8);
        avatar(ctx, p.name, payFaces[i], L, ty, 36);
        text(ctx, p.name, L + 50, ty + 9, font(15, 500), ink);
        text(ctx, fmt(p.amount), R, ty + 9, font(15, 500), ink, "right");
      });
    }, "Pay back", "paid from their pocket");
  }

  /* ---------- footer ---------- */
  {
    const t = y + 6;
    ops.push((ctx) => text(ctx, fit(`${r.business.name} · Shift ${r.number} · ${r.date}`, font(12.5), CARD), W / 2, t, font(12.5), ink3, "center"));
    y = t + 34;
  }

  const scale = 2;
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = Math.ceil(y) * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, W, y);
  ctx.textBaseline = "top";
  for (const op of ops) op(ctx);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(Error("Couldn't draw the report."))), "image/png"));
}

/** The Studio palette and type from the app, laid out as a readable group-chat card. */
export async function leaderboardImage(report: LeaderboardShare): Promise<Blob> {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  const [logo] = await Promise.all([
    report.business.logo ? loadImage(report.business.logo) : Promise.resolve(null),
    document.fonts?.ready,
  ]);
  const surface = color("--surface", "#fff");
  const ink = color("--ink", "#0a0a0a");
  const muted = color("--ink-secondary", "#6b6b6b");
  const accent = color("--accent", "#0a0a0a");
  const onAccent = color("--on-accent", "#fff");
  const radius = parseFloat(color("--radius-lg", "24"));
  const rowHeight = 68;
  const rowsTop = 154;
  const end = rowsTop + report.rows.length * rowHeight + 10;
  const height = end + 44;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) throw Error("Couldn't draw the leaderboard.");
  const ctx = context;
  ctx.scale(2, 2);
  ctx.textBaseline = "middle";

  function box(x: number, y: number, w: number, h: number, rad: number, fill: string) {
    ctx.fillStyle = fill;
    rr(ctx, x, y, w, h, rad);
    ctx.fill();
  }
  function text(value: string, x: number, y: number, size: number, weight: number, fill: string, max = CARD, align: CanvasTextAlign = "left") {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    if (ctx.measureText(value).width > max) {
      const chars = Array.from(value);
      while (chars.length && ctx.measureText(chars.join("") + "…").width > max) chars.pop();
      value = chars.join("") + "…";
    }
    ctx.fillText(value, x, y);
  }

  ctx.fillStyle = color("--canvas", "#ededed");
  ctx.fillRect(0, 0, W, height);
  if (logo) {
    cover(ctx, logo, G, 24, 38, 38, 10);
  } else {
    box(G, 24, 38, 38, 10, accent);
    text(initials(report.business.name), G + 19, 43, 14, 600, onAccent, 32, "center");
  }
  text(report.business.name, G + 50, 43, 17, 600, ink, CARD - 50);
  text(`${report.category} leaderboard`, G, 93, 34, 600, ink);
  text(`${report.period} · ${report.ranking}`, G, 126, 15, 500, muted);

  // The first place card uses the same accent as the primary action in the app.
  box(G, rowsTop, CARD, rowHeight, radius, accent);
  if (report.rows.length > 1) {
    box(G, rowsTop + rowHeight + 10, CARD, (report.rows.length - 1) * rowHeight, radius, surface);
  }
  const nameX = L + 41;
  report.rows.forEach(({ name, score, detail }, i) => {
    const first = i === 0;
    const y = rowsTop + i * rowHeight + (first ? 0 : 10);
    if (i > 1) {
      ctx.fillStyle = color("--line", "#ebebeb");
      ctx.fillRect(L, y, R - L, 1);
    }
    const fg = first ? onAccent : ink;
    ctx.font = `600 16px ${family}`;
    const scoreWidth = Math.min(208, ctx.measureText(score).width);
    text(String(i + 1), L + 10, y + 34, 17, 600, first ? onAccent : muted, 26, "center");
    text(name, nameX, y + 24, 17, 600, fg, R - nameX - scoreWidth - 14);
    text(score, R, y + 24, 16, 600, fg, 208, "right");
    text(detail, nameX, y + 46, 14, 400, first ? onAccent : muted, R - nameX);
  });
  text("Portable POS", W / 2, end + 21, 13, 500, muted, CARD, "center");

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error("Couldn't draw the leaderboard.")), "image/png");
  });
}
