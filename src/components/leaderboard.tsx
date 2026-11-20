"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Building2, CalendarDays, MapPin, Share2 } from "lucide-react";
import { leaderboard, leaderboardShareRows, leaderboardText, type Board, type LeaderboardShare, type Rank } from "@/lib/insights";
import { leaderboardImage } from "@/lib/report-image";
import { addDays, dayOf, weekday, zonedInstant } from "@/lib/team";
import { leaderboardPalette } from "@/lib/theme";
import type { RegisterState } from "@/lib/types";
import { ImageShareSheet } from "./share";
import { useBookingSales } from "./shift-list";
import { Avatar } from "./team";
import { buzz, formatMoney, useFaces } from "./ui";
import styles from "./leaderboard.module.css";

const categories = [
  { value: "people", label: "People" },
  { value: "event", label: "Event" },
  { value: "organizer", label: "Organizer" },
  { value: "place", label: "Places" },
] as const;

const periods = [
  { value: "all", label: "All time" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
] as const;
type Period = (typeof periods)[number]["value"];

const icons = { organizer: Building2, event: CalendarDays, place: MapPin };

function leaderboardPeriod(range: Period, zone: string, now: number) {
  if (range === "all") return { since: 0, title: "All time" };
  const today = dayOf(now, zone);
  const weekStart = addDays(today, -((weekday(today) + 6) % 7));
  const start = range === "week" ? weekStart : range === "month" ? today.slice(0, 8) + "01" : today.slice(0, 4) + "-01-01";
  const since = Date.parse(zonedInstant(start, "00:00", zone));
  const title = range === "year" ? start.slice(0, 4) : new Intl.DateTimeFormat("en", {
    timeZone: zone,
    month: range === "week" ? "short" : "long",
    day: range === "week" ? "numeric" : undefined,
    year: "numeric",
  }).format(since);
  return { since, title: range === "week" ? `Week of ${title}` : title };
}

function RankPortrait({ rank, board }: { rank: Rank; board: Board }) {
  if (board === "people") return <Avatar name={rank.label} id={rank.key} />;
  const Icon = icons[board];
  return <span className={styles.categoryIcon} aria-hidden="true"><Icon strokeWidth={1.6} /></span>;
}

export function LeaderboardPage({ state, demo, onBack }: { state: RegisterState; demo: boolean; onBack: () => void }) {
  const [board, setBoard] = useState<Board>("event");
  const [range, setRange] = useState<Period>("month");
  const [share, setShare] = useState<LeaderboardShare | null>(null);
  const buildShareImage = useMemo(() => share && (() => leaderboardImage(share)), [share]);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const business = state.business!;
  const faces = useFaces();
  const palette = leaderboardPalette(business.settings.brand);
  const stageStyle = Object.fromEntries(Object.entries(palette).map(([name, value]) => [`--podium-${name}`, value])) as CSSProperties;
  const owner = Boolean(state.me?.owner);
  const now = Date.now();
  const salesOf = useBookingSales(state, demo);
  const { since, title: period } = leaderboardPeriod(range, business.timeZone, now);
  const bookings = state.bookings ?? [];
  const rows = leaderboard(bookings, board, state.me, salesOf, since, now);
  const podium = rows.slice(0, 3);
  const ranking = owner ? "Ranked by sales" : "Ranked by quotas hit, then shifts worked";
  const format = (amount: number) => formatMoney(amount, business.currency);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  function openShare() {
    buzz.tap();
    const label = categories.find((option) => option.value === board)!.label;
    const category = board === "event" || board === "organizer" ? label + "s" : label;
    const icon = stage.current?.querySelector("svg")?.cloneNode(true) as SVGSVGElement | undefined;
    icon?.setAttribute("stroke", palette["portrait-ink"]);
    setShare({
      business: { name: business.name, logo: business.settings.logo, brand: business.settings.brand },
      category,
      period,
      ranking,
      owner,
      icon: icon ? `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(icon))}` : undefined,
      rows: leaderboardShareRows(rows, owner, format, board === "people" ? faces.byId : undefined),
    });
  }

  function score(rank: Rank) {
    return owner ? format(rank.sales ?? 0) : `${rank.hits} ${rank.hits === 1 ? "quota" : "quotas"} hit`;
  }

  function details(rank: Rank) {
    const shifts = `${rank.shifts} ${rank.shifts === 1 ? "shift" : "shifts"}`;
    if (!owner) return [shifts];
    const profit = rank.profit ?? 0;
    const result = [shifts, `${profit < 0 ? "Loss" : "Profit"} ${format(Math.abs(profit))}`];
    if (rank.hits) result.push(`${rank.hits} ${rank.hits === 1 ? "quota" : "quotas"} hit`);
    return result;
  }

  return (
    <div className={`page narrow ${styles.page}`}>
      <header className="page-top">
        <button type="button" className="round" aria-label="Back to shifts" onClick={onBack}>
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <h1 ref={heading} tabIndex={-1} className={`headline grow ${styles.heading}`}>Leaderboard</h1>
        <button type="button" className={`btn secondary responsive-icon ${styles.share}`} disabled={!rows.length} aria-haspopup="dialog" onClick={openShare}>
          <Share2 size={16} aria-hidden="true" /> <span className="button-label">Share</span>
        </button>
      </header>

      <div className={styles.filters}>
        <select
          className={`select ${styles.filter}`}
          aria-label="Leaderboard category"
          value={board}
          onChange={(event) => {
            buzz.tap();
            setBoard(event.target.value as Board);
          }}
        >
          {categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          className={`select ${styles.filter}`}
          aria-label="Date range"
          value={range}
          onChange={(event) => {
            buzz.tap();
            setRange(event.target.value as Period);
          }}
        >
          {periods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div ref={stage} className={styles.stage} style={stageStyle}>
        <div className={styles.stageHeader}>
          <h2>{period}</h2>
          <p>{ranking}</p>
        </div>
        {podium.length ? (
          <ol className={styles.podium} data-count={podium.length} aria-label="Top ranks" role="list">
            {podium.map((rank, i) => (
              <li key={rank.key} className={styles.placement} data-place={i + 1}>
                <div className={styles.portrait}><RankPortrait rank={rank} board={board} /></div>
                <div className={styles.identity}>
                  <p className={styles.name} title={rank.label}>{rank.label}{rank.me && <span className={styles.you}> · you</span>}</p>
                  <p className={styles.score}>{score(rank)}</p>
                </div>
                <div className={styles.pedestal}>
                  <span className={styles.position}><span className="sr-only">Rank </span>{i + 1}</span>
                  <div className={styles.pedestalDetails}>
                    {details(rank).map((detail) => <span key={detail}>{detail}</span>)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>
            {bookings.some((booking) => Date.parse(booking.endsAt) <= now)
              ? "No rankings for this category and date range."
              : "Rankings start once the first scheduled shift is over."}
          </p>
        )}
      </div>

      {rows.length > 3 && (
        <ol start={4} className={`card ${styles.rankList}`} aria-label="Remaining ranks" role="list">
          {rows.slice(3).map((rank, i) => (
            <li className={styles.rankRow} key={rank.key}>
              <span className="rank-num"><span className="sr-only">Rank </span>{i + 4}</span>
              <div className={styles.rowPortrait}><RankPortrait rank={rank} board={board} /></div>
              <div className={styles.rowIdentity}>
                <p className={styles.rowName}>{rank.label}{rank.me && <span className="g"> · you</span>}</p>
                <p className="label">{details(rank).join(" · ")}</p>
              </div>
              <span className={styles.rowScore}>{score(rank)}</span>
            </li>
          ))}
        </ol>
      )}

      {share && buildShareImage && (
        <ImageShareSheet
          title={`Share ${share.category.toLowerCase()} leaderboard`}
          filename={`${share.business.name} ${share.category} leaderboard - ${share.period}`}
          text={leaderboardText(share)}
          build={buildShareImage}
          onClose={() => setShare(null)}
        />
      )}
    </div>
  );
}
