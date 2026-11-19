"use client";

import { useId, type ReactNode } from "react";

/**
 * Playful drawings of Philippine coins and bills for the cash counter. Loosely based on
 * the New Generation coins and the polymer notes (colors, shapes, the animal on each
 * note), drawn as cartoons rather than copies of the real designs.
 */
export function hasPesoArt(currency: string, value: number, kind: "coin" | "bill") {
  return currency === "PHP" && (kind === "coin" ? value in coins : value in bills);
}

export function PesoArt({ value, kind }: { value: number; kind: "coin" | "bill" }) {
  const id = useId().replace(/:/g, "");
  return kind === "coin" ? <Coin id={id} spec={coins[value]} value={value} /> : <Bill id={id} spec={bills[value]} value={value} />;
}

/** Values are in centavos, the app's minor units. */
const coins: Record<number, { size: number; sides?: number; ring?: boolean; flower: (id: string) => ReactNode }> = {
  100: { size: 0.82, flower: () => <Orchid color="#e879a8" /> },
  500: { size: 0.9, sides: 9, flower: () => <Vine /> },
  1000: { size: 0.96, flower: () => <Bell /> },
  2000: { size: 1, ring: true, flower: () => <Leaves /> },
};

const bills: Record<number, { base: string; deep: string; light: string; animal: ReactNode; window?: boolean }> = {
  5000: { base: "#e4574f", deep: "#9e2a2b", light: "#ffd2c8", animal: <Cat />, window: true },
  10000: { base: "#9a6fd0", deep: "#5b3a91", light: "#eadcff", animal: <Pheasant />, window: true },
  20000: { base: "#58b26b", deep: "#2c6b3a", light: "#d6f2d6", animal: <Tarsier /> },
  50000: { base: "#f2c14e", deep: "#9a6a12", light: "#fff1c4", animal: <Deer />, window: true },
  100000: { base: "#4a8fe0", deep: "#1f4f95", light: "#d6e8ff", animal: <Eagle />, window: true },
};

function polygon(sides: number, r: number, c = 30) {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return `${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

function Coin({ id, spec, value }: { id: string; spec: (typeof coins)[number]; value: number }) {
  const label = String(value / 100);
  const r = 28 * spec.size;
  const silver = (
    <linearGradient id={id + "s"} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#ffffff" />
      <stop offset="0.45" stopColor="#d9dee5" />
      <stop offset="1" stopColor="#9aa3ae" />
    </linearGradient>
  );
  const gold = (
    <linearGradient id={id + "g"} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#fff2b8" />
      <stop offset="0.5" stopColor="#e5b545" />
      <stop offset="1" stopColor="#a8741a" />
    </linearGradient>
  );
  const outer = spec.ring ? `url(#${id}g)` : `url(#${id}s)`;
  const edge = spec.ring ? "#8a5d12" : "#7d8794";
  return (
    <svg viewBox="0 0 60 60" className="peso coin-art" aria-hidden="true">
      <defs>
        {silver}
        {gold}
      </defs>
      <g transform="translate(0 1.5)">
        {spec.sides ? (
          <polygon points={polygon(spec.sides, r + 1)} fill="#00000022" transform="translate(0 1.5)" />
        ) : (
          <circle cx="30" cy="31.5" r={r} fill="#00000022" />
        )}
      </g>
      {spec.sides ? (
        <polygon points={polygon(spec.sides, r + 1)} fill={outer} stroke={edge} strokeWidth="1.2" strokeLinejoin="round" />
      ) : (
        <circle cx="30" cy="30" r={r} fill={outer} stroke={edge} strokeWidth="1.2" />
      )}
      <circle
        cx="30"
        cy="30"
        r={spec.ring ? r - 7 : r - 3.5}
        fill={spec.ring ? `url(#${id}s)` : "none"}
        stroke={spec.ring ? "#7d8794" : "#ffffffaa"}
        strokeWidth={spec.ring ? 1 : 1.2}
        strokeDasharray={spec.ring ? undefined : "1.5 2"}
      />
      <g transform={`translate(30 ${30 - r * 0.52}) scale(${spec.size})`}>{spec.flower(id)}</g>
      <text
        x="30"
        y={30 + r * 0.42}
        textAnchor="middle"
        fontSize={label.length > 1 ? 17 : 20}
        fontWeight="800"
        fill="#3b4250"
        stroke="#ffffff"
        strokeWidth="2.5"
        paintOrder="stroke"
        fontFamily="inherit"
      >
        {label}
      </text>
      <ellipse cx="22" cy="18" rx="7" ry="3" fill="#ffffff" opacity="0.55" transform="rotate(-35 22 18)" />
    </svg>
  );
}

function Bill({ id, spec, value }: { id: string; spec: (typeof bills)[number]; value: number }) {
  const label = String(value / 100);
  return (
    <svg viewBox="0 0 120 62" className="peso bill-art" aria-hidden="true">
      <defs>
        <linearGradient id={id + "b"} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={spec.light} />
          <stop offset="0.35" stopColor={spec.base} />
          <stop offset="1" stopColor={spec.deep} />
        </linearGradient>
        <clipPath id={id + "c"}>
          <rect x="2" y="2" width="116" height="56" rx="8" />
        </clipPath>
      </defs>
      <rect x="2" y="4" width="116" height="56" rx="8" fill="#00000022" />
      <rect x="2" y="2" width="116" height="56" rx="8" fill={`url(#${id}b)`} />
      <g clipPath={`url(#${id}c)`} fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.4">
        <path d="M-4 46 Q 20 36 40 46 T 84 46 T 128 46" />
        <path d="M-4 52 Q 20 42 40 52 T 84 52 T 128 52" />
        <path d="M-4 12 Q 24 4 48 12 T 96 12 T 140 12" />
      </g>
      <rect x="6" y="6" width="108" height="48" rx="5" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" strokeDasharray="3 2" />
      <circle cx="32" cy="30" r="19" fill={spec.light} stroke="#ffffff" strokeWidth="2" />
      <g transform="translate(32 30)">{spec.animal}</g>
      {spec.window && (
        <g>
          <ellipse cx="100" cy="17" rx="9" ry="7" fill="#ffffff" fillOpacity="0.55" stroke="#ffffff" strokeWidth="1" />
          <g transform="translate(100 17) scale(0.5)">
            <Sampaguita />
          </g>
        </g>
      )}
      <text
        x={spec.window ? 84 : 86}
        y="44"
        textAnchor="middle"
        fontSize={label.length > 3 ? 20 : 22}
        fontWeight="800"
        fill="#ffffff"
        stroke={spec.deep}
        strokeWidth="3"
        paintOrder="stroke"
        fontFamily="inherit"
      >
        {label}
      </text>
      <text x={spec.window ? 76 : 86} y="20" textAnchor="middle" fontSize="7" fontWeight="700" fill="#ffffff" fillOpacity="0.85" letterSpacing="1" fontFamily="inherit">
        PISO
      </text>
    </svg>
  );
}

/* Coin flowers, drawn around (0,0). */
function Orchid({ color }: { color: string }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx="0" cy="-4" rx="2.6" ry="4.2" fill={color} transform={`rotate(${a})`} />
      ))}
      <circle r="1.8" fill="#fff4a8" />
    </g>
  );
}
function Vine() {
  return (
    <g>
      {[-6, 0, 6].map((x, i) => (
        <path key={x} d={`M${x} ${-4 + i} q 2 4 0 7 q -2 -3 0 -7z`} fill="#3fc9b0" stroke="#1f8f7c" strokeWidth="0.6" />
      ))}
      <path d="M-8 -5 Q 0 -8 8 -5" fill="none" stroke="#3c8a3a" strokeWidth="1.2" />
    </g>
  );
}
function Bell() {
  return (
    <g>
      <path d="M-5 -6 Q 0 -9 5 -6" fill="none" stroke="#3c8a3a" strokeWidth="1.2" />
      {[-4, 0, 4].map((x) => (
        <circle key={x} cx={x} cy={x === 0 ? 0 : -2} r="2.6" fill="#f472b6" stroke="#be3f86" strokeWidth="0.5" />
      ))}
    </g>
  );
}
function Leaves() {
  return (
    <g>
      <ellipse cx="-3.5" cy="0" rx="2.4" ry="5" fill="#4caf50" transform="rotate(-30)" />
      <ellipse cx="3.5" cy="0" rx="2.4" ry="5" fill="#66bb6a" transform="rotate(30)" />
      <circle cx="0" cy="-3" r="1.6" fill="#ffffff" />
    </g>
  );
}
function Sampaguita() {
  return (
    <g>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse key={a} cx="0" cy="-5" rx="3" ry="5" fill="#ffffff" stroke="#c9d6c9" strokeWidth="0.6" transform={`rotate(${a})`} />
      ))}
      <circle r="2.4" fill="#ffe27a" />
    </g>
  );
}

/* Bill animals, cartoon faces drawn around (0,0) inside a circle of radius 19. */
const eye = (x: number, y: number, r = 2.4) => (
  <g>
    <circle cx={x} cy={y} r={r} fill="#1f2328" />
    <circle cx={x + r * 0.35} cy={y - r * 0.35} r={r * 0.35} fill="#ffffff" />
  </g>
);

/** Visayan leopard cat. */
function Cat() {
  return (
    <g>
      <path d="M-11 -4 L-9 -15 L-2 -9 Z M11 -4 L9 -15 L2 -9 Z" fill="#d99a4e" stroke="#7a4a1a" strokeWidth="1" strokeLinejoin="round" />
      <ellipse cx="0" cy="1" rx="12" ry="10.5" fill="#e8b46a" stroke="#7a4a1a" strokeWidth="1" />
      {[[-7, -5], [6, -6], [-9, 3], [9, 2], [0, -8]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" fill="#7a4a1a" />
      ))}
      {eye(-4.5, 0)}
      {eye(4.5, 0)}
      <path d="M-1.5 4 L1.5 4 L0 5.6 Z" fill="#c4505a" />
      <path d="M0 5.6 Q -2 8 -4 7 M0 5.6 Q 2 8 4 7" fill="none" stroke="#7a4a1a" strokeWidth="0.9" strokeLinecap="round" />
    </g>
  );
}
/** Palawan peacock-pheasant. */
function Pheasant() {
  return (
    <g>
      {[-50, -25, 0, 25, 50].map((a) => (
        <g key={a} transform={`rotate(${a} 3 6)`}>
          <ellipse cx="3" cy="-6" rx="3.6" ry="9" fill="#3d4a5c" />
          <circle cx="3" cy="-11" r="2" fill="#4fd1c5" stroke="#2b6cb0" strokeWidth="0.8" />
        </g>
      ))}
      <ellipse cx="-1" cy="7" rx="7" ry="5.5" fill="#2d3748" />
      <circle cx="-6" cy="0" r="4.6" fill="#2d3748" />
      <path d="M-8 -4 L-6 -9 L-4 -4" fill="#4fd1c5" />
      <circle cx="-7" cy="-0.5" r="1.8" fill="#ffffff" />
      <circle cx="-7.3" cy="-0.5" r="1" fill="#1f2328" />
      <path d="M-10.5 0.5 L-13.5 1.5 L-10.5 2.5 Z" fill="#f6ad55" />
    </g>
  );
}
/** Philippine tarsier. */
function Tarsier() {
  return (
    <g>
      <ellipse cx="-12" cy="-6" rx="5" ry="6" fill="#b88a5a" stroke="#6b4a2a" strokeWidth="1" />
      <ellipse cx="12" cy="-6" rx="5" ry="6" fill="#b88a5a" stroke="#6b4a2a" strokeWidth="1" />
      <circle cx="0" cy="2" r="12" fill="#c99e6e" stroke="#6b4a2a" strokeWidth="1" />
      <circle cx="-5" cy="0" r="5.4" fill="#f6e05e" stroke="#6b4a2a" strokeWidth="0.8" />
      <circle cx="5" cy="0" r="5.4" fill="#f6e05e" stroke="#6b4a2a" strokeWidth="0.8" />
      {eye(-5, 0, 3.4)}
      {eye(5, 0, 3.4)}
      <path d="M-1 7 L1 7 L0 8.4 Z" fill="#6b4a2a" />
      <path d="M-2.5 10 Q 0 11.5 2.5 10" fill="none" stroke="#6b4a2a" strokeWidth="0.9" strokeLinecap="round" />
    </g>
  );
}
/** Visayan spotted deer. */
function Deer() {
  return (
    <g>
      <path d="M-5 -9 L-8 -16 M-7 -13 L-11 -14 M5 -9 L8 -16 M7 -13 L11 -14" stroke="#7a4a1a" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="-11" cy="-5" rx="5" ry="2.6" fill="#b4733a" transform="rotate(-25 -11 -5)" />
      <ellipse cx="11" cy="-5" rx="5" ry="2.6" fill="#b4733a" transform="rotate(25 11 -5)" />
      <path d="M-8 -6 Q 0 -12 8 -6 Q 9 6 0 13 Q -9 6 -8 -6 Z" fill="#c98547" stroke="#7a4a1a" strokeWidth="1" />
      {[[-5, -5], [4, -6], [0, -8]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.1" fill="#fff7e6" />
      ))}
      {eye(-3.8, 0, 2)}
      {eye(3.8, 0, 2)}
      <ellipse cx="0" cy="9.5" rx="2.6" ry="1.9" fill="#3b2a1a" />
    </g>
  );
}
/** Philippine eagle. */
function Eagle() {
  return (
    <g>
      {[-60, -35, -10, 15].map((a) => (
        <path key={a} d="M0 -4 L-3 -16 L3 -6 Z" fill="#a0784a" transform={`rotate(${a})`} />
      ))}
      <circle cx="1" cy="2" r="10" fill="#f3ead8" stroke="#6b5233" strokeWidth="1" />
      <path d="M-8 -3 Q 2 -10 10 -2 L 4 -1 Z" fill="#a0784a" />
      {eye(3, 0, 2.4)}
      <path d="M8 1 Q 16 2 13 9 Q 11 6 7 6 Z" fill="#8fa3b8" stroke="#3d4a5c" strokeWidth="0.9" strokeLinejoin="round" />
    </g>
  );
}
