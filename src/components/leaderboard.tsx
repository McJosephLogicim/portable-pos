"use client";

import { blocked } from "@/lib/reject";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Building2, CalendarDays, ChevronDown, MapPin, Share } from "lucide-react";
import { appIcons, leaderboardCrown } from "@/lib/app-brand";
import { leaderboard, leaderboardShareRows, leaderboardText, type Board, type LeaderboardShare, type Rank } from "@/lib/insights";
import { leaderboardImage } from "@/lib/report-image";
import { addDays, dayOf, weekday, zonedInstant } from "@/lib/team";
import { leaderboardColors } from "@/lib/theme";
import type { RegisterState } from "@/lib/types";
import { ImageShareSheet } from "./share";
import { useBookingExpenses, useBookingSales } from "./shift-list";
import { Avatar } from "./team";
import { buzz, EmptyState, formatMoney, Sheet, useFaces } from "./ui";
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
const colors = Object.fromEntries(Object.entries(leaderboardColors).map(([name, value]) => [`--board-${name}`, value])) as CSSProperties;

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
  const [board, setBoard] = useState<Board>("people");
  const [range, setRange] = useState<Period>("month");
  const [share, setShare] = useState<LeaderboardShare | null>(null);
  const [selectedRank, setSelectedRank] = useState<{ rank: Rank; position: number } | null>(null);
  const buildShareImage = useMemo(() => share && (() => leaderboardImage(share)), [share]);
  const heading = useRef<HTMLHeadingElement>(null);
  const podiumList = useRef<HTMLOListElement>(null);
  const myRow = useRef<HTMLLIElement>(null);
  const business = state.business!;
  const faces = useFaces();
  const owner = Boolean(state.me?.owner);
  const now = Date.now();
  const salesOf = useBookingSales(state, demo);
  const { since, title: period } = leaderboardPeriod(range, business.timeZone, now);
  const expensesOf = useBookingExpenses(state);
  const bookings = (state.bookings ?? []).map((booking) => ({ ...booking, expenses: expensesOf(booking) }));
  const rows = leaderboard(bookings, board, state.me, salesOf, since, now);
  const podium = rows.slice(0, 3);
  const myIndex = rows.findIndex((rank) => rank.me);
  const myRank = myIndex >= podium.length ? rows[myIndex] : undefined;
  const ranking = owner ? "Ranked by sales" : "Ranked by quotas hit, then shifts worked";
  const format = (amount: number) => formatMoney(amount, business.currency);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeColor) return;
    const previous = themeColor.content;
    themeColor.content = "#101d3a";
    return () => { themeColor.content = previous; };
  }, []);

  function openShare() {
    buzz.tap();
    const label = categories.find((option) => option.value === board)!.label;
    const category = board === "event" || board === "organizer" ? label + "s" : label;
    const icon = podiumList.current?.querySelector(`.${styles.categoryIcon} svg`)?.cloneNode(true) as SVGSVGElement | undefined;
    icon?.setAttribute("stroke", leaderboardColors.ink);
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

  function shifts(rank: Rank) {
    return `${rank.shifts} ${rank.shifts === 1 ? "shift" : "shifts"}`;
  }

  function details(rank: Rank) {
    if (!owner) return [shifts(rank)];
    const profit = rank.profit ?? 0;
    const result = [shifts(rank), `${profit < 0 ? "Loss" : "Profit"} ${format(Math.abs(profit))}`];
    if (rank.hits) result.push(`${rank.hits} ${rank.hits === 1 ? "quota" : "quotas"} hit`);
    return result;
  }

  function jumpToMyRank() {
    buzz.tap();
    myRow.current?.focus({ preventScroll: true });
    myRow.current?.scrollIntoView({ block: "center" });
  }

  return (
    <div className={styles.page} style={colors}>
      <div className={styles.content} data-my-rank={myRank ? "" : undefined}>
        <header className={styles.header}>
          <button type="button" className={`round ${styles.back}`} aria-label="Back to shifts" onClick={onBack}>
            <ArrowLeft size={19} aria-hidden="true" />
          </button>
          <img className={styles.appIcon} src={appIcons.small} width={54} height={54} alt="" />
          <button type="button" className={`btn responsive-icon ${styles.share}`} {...blocked(!rows.length && "There are no results to share yet.")} aria-haspopup="dialog" onClick={openShare}>
            <Share size={17} aria-hidden="true" /> <span className="button-label">Share</span>
          </button>
          <h1 ref={heading} tabIndex={-1} className={styles.heading}>Leaderboard</h1>
        </header>

        <div className={styles.filters}>
          <div className={styles.filterControl}>
            <select
              className={styles.filter}
              aria-label="Leaderboard category"
              value={board}
              onChange={(event) => {
                buzz.tap();
                setBoard(event.target.value as Board);
              }}
            >
              {categories.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <ChevronDown className={styles.filterChevron} size={15} aria-hidden="true" />
          </div>
          <div className={styles.filterControl}>
            <select
              className={styles.filter}
              aria-label="Date range"
              value={range}
              onChange={(event) => {
                buzz.tap();
                setRange(event.target.value as Period);
              }}
            >
              {periods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
            <ChevronDown className={styles.filterChevron} size={15} aria-hidden="true" />
          </div>
        </div>

        {podium.length > 0 ? (
          <>
            <p id="leaderboard-ranking" className="sr-only">{ranking}</p>
            <ol ref={podiumList} className={styles.podium} data-count={podium.length} aria-label="Top ranks" aria-describedby="leaderboard-ranking" role="list">
              {podium.map((rank, i) => (
                <li key={rank.key} className={styles.placement} data-place={i + 1}>
                  <div className={styles.medal}>
                    {i === 0 && <img className={styles.crown} src={leaderboardCrown} alt="" />}
                    <div className={styles.portrait}><RankPortrait rank={rank} board={board} /></div>
                    <span className={styles.position}><span className="sr-only">Rank </span>{i + 1}</span>
                  </div>
                  <div className={styles.identity}>
                    <p className={styles.name} title={rank.label}>{rank.label}{rank.me && <span className={styles.you}> · you</span>}</p>
                    <p className={styles.score}>{score(rank)}</p>
                    <p className={styles.shifts}>{shifts(rank)}</p>
                  </div>
                  {owner && (
                    <button
                      type="button"
                      className={styles.rankDetailsButton}
                      aria-label={`View rank ${i + 1} details for ${rank.label}`}
                      aria-haspopup="dialog"
                      onClick={() => {
                        buzz.tap();
                        setSelectedRank({ rank, position: i + 1 });
                      }}
                    />
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <EmptyState
            pose="sale"
            object="leaderboardTrophy"
            title="No rankings yet"
            text={bookings.some((booking) => Date.parse(booking.endsAt) <= now)
              ? "Try another category or date range."
              : "Rankings start once the first scheduled shift is over."}
          />
        )}

        {rows.length > 3 && (
          <ol start={4} className={styles.rankList} aria-label="Remaining ranks" role="list">
            {rows.slice(3).map((rank, i) => (
              <li className={styles.rankRow} key={rank.key} ref={rank.me ? myRow : undefined} tabIndex={rank.me ? -1 : undefined}>
                <span className={styles.rowPosition}><span className="sr-only">Rank </span>{i + 4}</span>
                <div className={styles.rowPortrait}><RankPortrait rank={rank} board={board} /></div>
                <p className={styles.rowName}>{rank.label}{rank.me && <span className={styles.you}> · you</span>}</p>
                <span className={styles.rowScore}>{score(rank)}</span>
                <p className={styles.rowDetails}>{details(rank).join(" · ")}</p>
              </li>
            ))}
          </ol>
        )}

        {myRank && (
          <button type="button" className={styles.jump} aria-label={`Jump to your rank, number ${myIndex + 1}`} onClick={jumpToMyRank}>
            <Avatar name={myRank.label} id={myRank.key} small />
            You · #{myIndex + 1}
            <ChevronDown size={22} aria-hidden="true" />
          </button>
        )}
      </div>

      {selectedRank && (
        <Sheet title={selectedRank.rank.label} onClose={() => setSelectedRank(null)}>
          <p className="label">Rank {selectedRank.position} · {period}</p>
          <p className="strong">{score(selectedRank.rank)} in sales</p>
          {details(selectedRank.rank).map((detail) => <p key={detail}>{detail}</p>)}
        </Sheet>
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
