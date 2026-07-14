/**
 * Overrun campaign intro comic — 5 hand-drawn vector (SVG) panels, each shown for
 * SLIDE_MS then auto-advancing. Calls `onDone` after the last panel (or on Skip).
 * Everything is inline SVG (no external art) so it ships self-contained and themable.
 *
 * Story: 1) the squad preps gear  2) a white-haired general briefs them on a screen
 * 3) they pack up and banter  4) they ride out in a truck  5) they hit the parking lot
 * outside a battle-scarred tech tower.
 */

import { useEffect, useState, type ReactNode } from "react";

export const COMIC_SLIDE_MS = 2000;
const SLIDES = 5;

const C = {
  ink: "#060610",
  bg: "#0b0b1a",
  bg2: "#131328",
  steel: "#273349",
  steelDark: "#131c2e",
  cyan: "#22d3ee",
  amber: "#fcd34d",
  fuchsia: "#e879f9",
  emerald: "#34d399",
  glass: "#1e293b",
  white: "#f8fafc",
  skin: "#e8b48c",
  hair: "#e8edf2",
};

const ACCENTS = [C.cyan, C.amber, C.fuchsia, C.emerald];

export default function OverrunComic({ onDone }: { onDone?: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      if (i >= SLIDES - 1) onDone?.();
      else setI((n) => n + 1);
    }, COMIC_SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, onDone]);

  return (
    <div className="relative mx-auto w-full max-w-4xl select-none">
      <style>{`
        @keyframes overrunComicIn {
          from { opacity: 0; transform: scale(1.04); }
          to   { opacity: 1; transform: scale(1); }
        }
        .overrun-comic-slide { animation: overrunComicIn 320ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .overrun-comic-slide { animation: none; } }
      `}</style>

      <div
        className="relative overflow-hidden rounded-xl border-2 border-cyan-400/40 bg-night-950 shadow-[0_0_50px_rgb(34_211_238/0.15)]"
        style={{ aspectRatio: "960 / 600" }}
      >
        <div key={i} className="overrun-comic-slide absolute inset-0">
          <svg viewBox="0 0 960 600" className="h-full w-full" role="img" aria-label={CAPTIONS[i]}>
            <PanelBg />
            {SCENES[i]}
          </svg>
        </div>

        {/* caption bar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-4 py-3">
          <span className="font-display text-[9px] tracking-widest text-cyan-300 [text-shadow:0_0_10px_currentColor]">
            {CAPTIONS[i]}
          </span>
          <span className="font-display text-[9px] text-neutral-500">{i + 1} / {SLIDES}</span>
        </div>
      </div>

      {/* progress + skip */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-1.5">
          {Array.from({ length: SLIDES }, (_, n) => (
            <span
              key={n}
              className={`h-1.5 w-6 rounded-full ${n <= i ? "bg-cyan-400" : "bg-white/15"}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onDone?.()}
          className="font-display text-[9px] text-neutral-500 transition hover:text-cyan-300"
        >
          SKIP ▸
        </button>
      </div>
    </div>
  );
}

const CAPTIONS = [
  "READY ROOM — 0600",
  "THE BRIEFING",
  "GEAR UP",
  "EN ROUTE",
  "OBJECTIVE: THE TOWER",
];

// ---------------------------------------------------------------------------
// shared chrome
// ---------------------------------------------------------------------------

function PanelBg() {
  return (
    <>
      <rect x="0" y="0" width="960" height="600" fill={C.bg} />
      {/* faint blueprint grid */}
      <g stroke="rgb(255 255 255 / 0.04)" strokeWidth="1">
        {Array.from({ length: 15 }, (_, i) => (
          <line key={`v${i}`} x1={64 * i} y1="0" x2={64 * i} y2="600" />
        ))}
        {Array.from({ length: 10 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={64 * i} x2="960" y2={64 * i} />
        ))}
      </g>
      {/* corner vignette */}
      <rect x="0" y="0" width="960" height="600" fill="url(#comicVignette)" />
      <defs>
        <radialGradient id="comicVignette" cx="50%" cy="45%" r="75%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
    </>
  );
}

// ---------------------------------------------------------------------------
// figures
// ---------------------------------------------------------------------------

/** Front-facing stylized operator, feet at (cx, groundY). */
function Soldier({
  cx,
  groundY,
  s = 1,
  accent = C.cyan,
  rot = 0,
}: {
  cx: number;
  groundY: number;
  s?: number;
  accent?: string;
  rot?: number;
}) {
  return (
    <g transform={`translate(${cx} ${groundY - 134 * s}) scale(${s}) rotate(${rot} 0 134)`}>
      {/* legs + boots */}
      <rect x={-16} y={70} width={13} height={54} rx={3} fill={C.steelDark} stroke={C.ink} strokeWidth={2} />
      <rect x={3} y={70} width={13} height={54} rx={3} fill={C.steelDark} stroke={C.ink} strokeWidth={2} />
      <rect x={-20} y={122} width={20} height={12} rx={2} fill={C.ink} />
      <rect x={0} y={122} width={20} height={12} rx={2} fill={C.ink} />
      {/* arms */}
      <rect x={-30} y={26} width={13} height={36} rx={6} fill={C.steel} stroke={C.ink} strokeWidth={2} />
      <rect x={17} y={26} width={13} height={36} rx={6} fill={C.steel} stroke={C.ink} strokeWidth={2} />
      {/* torso vest */}
      <rect x={-22} y={20} width={44} height={58} rx={9} fill={C.steel} stroke={C.ink} strokeWidth={2} />
      <path d={`M-13 22 L7 76`} stroke={accent} strokeWidth={3} />
      <path d={`M13 22 L-7 76`} stroke={accent} strokeWidth={3} />
      <rect x={-9} y={46} width={18} height={15} rx={2} fill={C.steelDark} stroke={C.ink} strokeWidth={1.5} />
      {/* rifle held across */}
      <rect x={-34} y={54} width={64} height={7} rx={2} fill={C.ink} />
      <rect x={-8} y={60} width={9} height={14} rx={2} fill={C.ink} />
      <rect x={22} y={50} width={6} height={5} fill={C.ink} />
      {/* neck + head */}
      <rect x={-6} y={12} width={12} height={11} fill={C.skin} />
      <ellipse cx={0} cy={2} rx={20} ry={16} fill={C.steel} stroke={C.ink} strokeWidth={2} />
      <path d="M-20 2 A20 15 0 0 1 20 2 L20 -3 A20 18 0 0 0 -20 -3 Z" fill={C.steelDark} />
      <rect x={-15} y={-1} width={30} height={9} rx={3} fill={accent} stroke={C.ink} strokeWidth={1.5} />
      <rect x={-11} y={1} width={9} height={4} rx={1} fill="#fff" opacity={0.55} />
    </g>
  );
}

/** Operator seen from behind — dark silhouette with a backpack + accent rim. */
function SoldierBack({ cx, groundY, s = 1, accent = C.cyan }: { cx: number; groundY: number; s?: number; accent?: string }) {
  return (
    <g transform={`translate(${cx} ${groundY - 130 * s}) scale(${s})`}>
      <rect x={-15} y={70} width={12} height={52} rx={3} fill="#0c1220" />
      <rect x={3} y={70} width={12} height={52} rx={3} fill="#0c1220" />
      <rect x={-19} y={120} width={18} height={11} rx={2} fill={C.ink} />
      <rect x={1} y={120} width={18} height={11} rx={2} fill={C.ink} />
      {/* backpack */}
      <rect x={-20} y={22} width={40} height={54} rx={8} fill="#0c1220" stroke={C.ink} strokeWidth={2} />
      <rect x={-13} y={30} width={26} height={30} rx={4} fill="#111a2b" stroke={accent} strokeWidth={2} opacity={0.85} />
      {/* shoulders + helmet */}
      <rect x={-24} y={20} width={10} height={26} rx={5} fill="#0c1220" />
      <rect x={14} y={20} width={10} height={26} rx={5} fill="#0c1220" />
      <ellipse cx={0} cy={4} rx={18} ry={15} fill="#0c1220" stroke={C.ink} strokeWidth={2} />
      <path d="M-16 0 A16 12 0 0 1 16 0" fill="none" stroke={accent} strokeWidth={2} opacity={0.7} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// speech bubbles + sfx
// ---------------------------------------------------------------------------

function Bubble({
  x,
  y,
  lines,
  to,
  fontSize = 18,
}: {
  x: number;
  y: number;
  lines: string[];
  to?: [number, number];
  fontSize?: number;
}) {
  const pad = 14;
  const lineH = fontSize + 7;
  const w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.6 + pad * 2;
  const h = lines.length * lineH + pad * 2;
  const tail = to
    ? `M${x + w * 0.3} ${y + h - 2} L${x + w * 0.5} ${y + h - 2} L${to[0]} ${to[1]} Z`
    : null;
  return (
    <g>
      {tail && <path d={tail} fill={C.white} stroke={C.ink} strokeWidth={3} />}
      <rect x={x} y={y} width={w} height={h} rx={13} fill={C.white} stroke={C.ink} strokeWidth={3} />
      {tail && <path d={tail} fill={C.white} />}
      {lines.map((l, idx) => (
        <text
          key={idx}
          x={x + w / 2}
          y={y + pad + fontSize + idx * lineH - 3}
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight={800}
          fontSize={fontSize}
          fill={C.ink}
        >
          {l}
        </text>
      ))}
    </g>
  );
}

function burstPoints(cx: number, cy: number, spikes: number, rO: number, rI: number): string {
  const n = spikes * 2;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = i % 2 ? rI : rO;
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

function Sfx({ x, y, text, color = C.amber, rot = -10, size = 26 }: { x: number; y: number; text: string; color?: string; rot?: number; size?: number }) {
  const rO = text.length * size * 0.42 + 14;
  return (
    <g transform={`rotate(${rot} ${x} ${y})`}>
      <polygon points={burstPoints(x, y, 12, rO, rO * 0.7)} fill={color} stroke={C.ink} strokeWidth={2.5} />
      <text x={x} y={y + size * 0.34} textAnchor="middle" fontFamily="var(--font-display, monospace)" fontSize={size} fill={C.ink}>
        {text}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// scenes
// ---------------------------------------------------------------------------

function ReadyRoom() {
  // lockers along the back wall
  return (
    <g>
      <rect x="0" y="360" width="960" height="240" fill={C.bg2} />
      <g stroke={C.ink} strokeWidth="2">
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect x={40 + i * 116} y="150" width="96" height="210" fill={C.steelDark} />
            <circle cx={120 + i * 116} cy="255" r="4" fill={C.cyan} opacity={0.5} />
          </g>
        ))}
      </g>
      <rect x="0" y="470" width="960" height="4" fill="rgb(255 255 255 / 0.08)" />
    </g>
  );
}

const SCENES: ReactNode[] = [
  // 1 — prep gear + SFX
  <g key="s1">
    <ReadyRoom />
    <Soldier cx={200} groundY={470} accent={ACCENTS[0]} />
    <Soldier cx={400} groundY={470} accent={ACCENTS[1]} />
    <Soldier cx={600} groundY={470} accent={ACCENTS[2]} />
    <Soldier cx={790} groundY={470} accent={ACCENTS[3]} />
    <Sfx x={300} y={330} text="CLICK!" color={C.cyan} rot={-12} />
    <Sfx x={520} y={300} text="CLUNG!" color={C.amber} rot={8} size={28} />
    <Sfx x={720} y={340} text="CA-CHING!" color={C.fuchsia} rot={-6} size={22} />
  </g>,

  // 2 — the briefing screen
  <g key="s2">
    <rect x="0" y="0" width="960" height="600" fill={C.bg} />
    {/* big wall screen */}
    <rect x="250" y="46" width="460" height="270" rx="10" fill={C.ink} />
    <rect x="262" y="58" width="436" height="246" rx="6" fill="#0a1420" stroke={C.cyan} strokeWidth="3" />
    <rect x="262" y="58" width="436" height="246" rx="6" fill="url(#scrGlow)" />
    <defs>
      <radialGradient id="scrGlow" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stopColor={C.cyan} stopOpacity="0.14" />
        <stop offset="100%" stopColor={C.cyan} stopOpacity="0" />
      </radialGradient>
    </defs>
    {/* general bust */}
    <g>
      <path d="M330 300 Q360 232 480 232 Q600 232 630 300 Z" fill={C.steelDark} stroke={C.ink} strokeWidth="2" />
      <rect x="360" y="262" width="240" height="16" fill={C.steel} />
      <circle cx="392" cy="270" r="6" fill={C.amber} />
      <circle cx="568" cy="270" r="6" fill={C.amber} />
      <rect x="470" y="240" width="20" height="60" fill={C.amber} opacity="0.8" />
      <ellipse cx="480" cy="176" rx="46" ry="52" fill={C.skin} stroke={C.ink} strokeWidth="2" />
      {/* white hair */}
      <path d="M432 168 Q430 118 480 112 Q530 118 528 168 Q516 150 480 148 Q444 150 432 168 Z" fill={C.hair} stroke={C.ink} strokeWidth="2" />
      <rect x="452" y="150" width="56" height="12" rx="4" fill={C.hair} />
      {/* stern face */}
      <rect x="454" y="176" width="18" height="5" rx="2" fill={C.ink} transform="rotate(6 463 178)" />
      <rect x="488" y="176" width="18" height="5" rx="2" fill={C.ink} transform="rotate(-6 497 178)" />
      <circle cx="463" cy="188" r="3.5" fill={C.ink} />
      <circle cx="497" cy="188" r="3.5" fill={C.ink} />
      <path d="M462 210 Q480 204 498 210" fill="none" stroke={C.ink} strokeWidth="3" />
      {/* white moustache */}
      <path d="M460 202 Q480 214 500 202" fill="none" stroke={C.hair} strokeWidth="6" strokeLinecap="round" />
    </g>
    <Bubble x={556} y={250} lines={["TEAM, YOU HAVE AN", "IMPORTANT MISSION."]} to={[600, 300]} fontSize={16} />
    {/* squad from behind, watching */}
    <SoldierBack cx={330} groundY={560} s={0.95} accent={ACCENTS[0]} />
    <SoldierBack cx={470} groundY={575} s={1.05} accent={ACCENTS[1]} />
    <SoldierBack cx={610} groundY={560} s={0.95} accent={ACCENTS[2]} />
    <SoldierBack cx={720} groundY={545} s={0.85} accent={ACCENTS[3]} />
  </g>,

  // 3 — pack up + banter
  <g key="s3">
    <ReadyRoom />
    {/* duffel bags */}
    <g stroke={C.ink} strokeWidth="2">
      <rect x="150" y="452" width="70" height="30" rx="14" fill={C.emerald} opacity="0.85" />
      <rect x="690" y="454" width="76" height="28" rx="13" fill={C.amber} opacity="0.85" />
    </g>
    <Soldier cx={210} groundY={472} accent={ACCENTS[0]} rot={-6} />
    <Soldier cx={430} groundY={472} accent={ACCENTS[1]} rot={3} />
    <Soldier cx={640} groundY={472} accent={ACCENTS[3]} rot={-3} />
    <Soldier cx={820} groundY={472} accent={ACCENTS[2]} rot={5} />
    <Bubble x={150} y={120} lines={["HELL YEAH!"]} to={[235, 300]} />
    <Bubble x={360} y={96} lines={["MY BONES ARE", "GETTIN' RUSTY…"]} to={[452, 300]} fontSize={16} />
    <Bubble x={648} y={110} lines={["TEAM, FOCUS!"]} to={[700, 300]} />
  </g>,

  // 4 — riding in the truck
  <g key="s4">
    <rect x="0" y="0" width="960" height="380" fill="#0a1020" />
    <circle cx="800" cy="90" r="42" fill="#f8fafc" opacity="0.9" />
    <circle cx="784" cy="82" r="42" fill="#0a1020" />
    {[...Array(26)].map((_, i) => (
      <circle key={i} cx={((i * 137) % 940) + 10} cy={((i * 73) % 300) + 20} r={i % 4 ? 1.4 : 2.2} fill="#fff" opacity={0.6} />
    ))}
    {/* road */}
    <rect x="0" y="470" width="960" height="130" fill={C.steelDark} />
    <rect x="0" y="470" width="960" height="6" fill="rgb(255 255 255 / 0.1)" />
    {[...Array(7)].map((_, i) => (
      <rect key={i} x={40 + i * 150} y="532" width="70" height="8" fill={C.amber} opacity="0.7" />
    ))}
    {/* motion lines */}
    <g stroke={C.cyan} strokeWidth="3" opacity="0.5">
      <line x1="60" y1="330" x2="200" y2="330" />
      <line x1="30" y1="380" x2="190" y2="380" />
      <line x1="70" y1="430" x2="210" y2="430" />
    </g>
    {/* truck (side) */}
    <g transform="translate(300 300)">
      <rect x="0" y="60" width="250" height="110" rx="8" fill={C.steel} stroke={C.ink} strokeWidth="3" />
      <path d="M250 80 L330 80 L360 120 L360 170 L250 170 Z" fill={C.steelDark} stroke={C.ink} strokeWidth="3" />
      <rect x="300" y="96" width="48" height="34" rx="4" fill={C.cyan} opacity="0.7" stroke={C.ink} strokeWidth="2" />
      <rect x="352" y="150" width="14" height="16" fill={C.amber} />
      {/* canopy ribs over the bed */}
      <path d="M0 60 Q125 4 250 60" fill="#0f1626" stroke={C.ink} strokeWidth="3" />
      {[40, 90, 140, 190].map((x, i) => (
        <SoldierBackHelmet key={i} x={x} y={44} accent={ACCENTS[i]} />
      ))}
      {/* wheels */}
      <circle cx="70" cy="176" r="34" fill={C.ink} />
      <circle cx="70" cy="176" r="15" fill={C.steel} />
      <circle cx="300" cy="176" r="34" fill={C.ink} />
      <circle cx="300" cy="176" r="15" fill={C.steel} />
    </g>
    <Sfx x={200} y={250} text="VROOM" color={C.amber} rot={-8} size={24} />
  </g>,

  // 5 — arrival: parking lot + battle-scarred tower
  <g key="s5">
    {/* ominous sky */}
    <rect x="0" y="0" width="960" height="600" fill="#140a12" />
    <rect x="0" y="0" width="960" height="360" fill="url(#skyGlow)" />
    <defs>
      <radialGradient id="skyGlow" cx="62%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#140a12" stopOpacity="0" />
      </radialGradient>
    </defs>
    {/* the tower */}
    <g transform="translate(560 40)">
      <rect x="0" y="0" width="300" height="430" fill={C.glass} stroke={C.ink} strokeWidth="3" />
      <rect x="0" y="0" width="300" height="24" fill={C.steelDark} />
      {/* window grid, some lit, some broken */}
      {Array.from({ length: 9 }, (_, r) =>
        Array.from({ length: 6 }, (_, c) => {
          const broken = (r * 6 + c) % 5 === 0 || (r === 2 && c > 2) || (r === 5 && c < 3);
          const lit = !broken && (r * 3 + c) % 4 === 0;
          const x = 16 + c * 46;
          const y = 40 + r * 42;
          return (
            <g key={`${r}-${c}`}>
              <rect x={x} y={y} width="34" height="30" fill={broken ? "#0a0e16" : lit ? C.cyan : "#233048"} opacity={lit ? 0.8 : 1} stroke={C.ink} strokeWidth="1.5" />
              {broken && (
                <path d={`M${x} ${y} L${x + 34} ${y + 30} M${x + 34} ${y} L${x + 12} ${y + 30}`} stroke="#516079" strokeWidth="1.5" />
              )}
            </g>
          );
        }),
      )}
    </g>
    {/* smoke puffs */}
    <g fill="#334155" opacity="0.65">
      <circle cx="640" cy="120" r="26" />
      <circle cx="672" cy="104" r="20" />
      <circle cx="700" cy="126" r="30" />
    </g>
    {/* parking lot foreground */}
    <path d="M0 430 L960 430 L960 600 L0 600 Z" fill="#161821" />
    <g stroke={C.white} strokeWidth="4" opacity="0.5">
      <line x1="120" y1="470" x2="70" y2="600" />
      <line x1="320" y1="470" x2="330" y2="600" />
      <line x1="520" y1="470" x2="590" y2="600" />
      <line x1="720" y1="470" x2="850" y2="600" />
    </g>
    {/* ground cracks + rubble */}
    <path d="M300 560 L360 520 L410 556 L470 516" fill="none" stroke="#000" strokeWidth="3" opacity="0.6" />
    <rect x="250" y="548" width="26" height="14" fill={C.steelDark} transform="rotate(-14 263 555)" />
    {/* truck at left edge (back) */}
    <g transform="translate(-10 372)">
      <rect x="0" y="40" width="150" height="96" rx="8" fill={C.steel} stroke={C.ink} strokeWidth="3" />
      <path d="M0 40 Q75 -8 150 40" fill="#0f1626" stroke={C.ink} strokeWidth="3" />
      <circle cx="46" cy="140" r="26" fill={C.ink} />
      <circle cx="120" cy="140" r="26" fill={C.ink} />
    </g>
    {/* operators mid-jump / landing */}
    <Soldier cx={250} groundY={470} s={0.82} accent={ACCENTS[0]} rot={-18} />
    <Soldier cx={400} groundY={500} s={0.9} accent={ACCENTS[1]} rot={8} />
    <Soldier cx={520} groundY={472} s={0.8} accent={ACCENTS[3]} rot={-10} />
    <Sfx x={330} y={430} text="TMP!" color={C.cyan} rot={-6} size={20} />
  </g>,
];

/** A single helmet peeking over the truck bed (used in slide 4). */
function SoldierBackHelmet({ x, y, accent }: { x: number; y: number; accent: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="0" rx="18" ry="14" fill="#0c1220" stroke={C.ink} strokeWidth="2" />
      <path d="M-15 -2 A15 11 0 0 1 15 -2" fill="none" stroke={accent} strokeWidth="2.5" opacity="0.8" />
    </g>
  );
}
