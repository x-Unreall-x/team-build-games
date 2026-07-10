import { useEffect, useRef, useState } from "react";
import type { LobbyPlayer } from "../../../game/net/lobby";
import type { PlayerId } from "../../../game/arena/types";
import { SHAPES, type Shape } from "../../../game/arena/cosmetic";
import { WEAPON_LIST, type Weapon } from "../../../game/arena/weapons";
import { MAX_PLAYERS } from "../../../game/constants";
import AvatarUploader from "../../members/AvatarUploader";

const FIGHTER: Record<Shape, { label: string; src: string }> = {
  circle: { label: "Swordsman", src: "/assets/arena/warriors/swordsman.png" },
  square: { label: "Spearman", src: "/assets/arena/warriors/spearman.png" },
  triangle: { label: "Knife fighter", src: "/assets/arena/warriors/knife-fighter.png" },
  diamond: { label: "Archer", src: "/assets/arena/warriors/archer.png" },
};

const PICKABLE_WEAPONS: Weapon[] = WEAPON_LIST; // sword/spear/knife (melee) + bow (ranged)
const WEAPON_LABEL: Record<Weapon, string> = { sword: "Sword", spear: "Spear", knife: "Knife", bow: "Bow" };

interface Props {
  roster: LobbyPlayer[];
  localId: PlayerId;
  hostId: PlayerId | null;
  isHost: boolean;
  name: string;
  shape: Shape;
  weapon: Weapon;
  joinUrl: string;
  onName: (n: string) => void;
  onShape: (s: Shape) => void;
  onWeapon: (w: Weapon) => void;
  onStart: (botCount: number, rounds: number) => void;
  onKick: (id: PlayerId) => void;
  onMakeHost: (id: PlayerId) => void;
  /** Signed-in members can set a per-game face photo; anonymous players see a locked hint. */
  isMember: boolean;
  avatarUrl: string | null;
}

const ROUND_OPTIONS = [1, 3, 5, 7];

export default function WarmupRoom(props: Props) {
  const [bots, setBots] = useState(2);
  const [rounds, setRounds] = useState(1);
  const [copied, setCopied] = useState(false);

  // A match needs at least 2 participants — humans in the roster plus host-driven bots.
  const canStart = props.roster.length + bots >= 2;

  // Fill an empty room with 2 bots, then clear them the moment another player joins.
  const wasAlone = useRef(props.roster.length <= 1);
  useEffect(() => {
    const alone = props.roster.length <= 1;
    if (wasAlone.current && !alone) setBots(0);
    wasAlone.current = alone;
  }, [props.roster.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the input is selectable as a fallback */
    }
  };

  return (
    <div className="grid w-full gap-6 sm:grid-cols-[1fr_260px]">
      {/* left: setup */}
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-3xl font-bold">Warm-up room</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Share the link, then the host starts the match. Last musa standing wins.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Your name</span>
          <input
            value={props.name}
            onChange={(e) => props.onName(e.target.value.slice(0, 16))}
            className="w-56 rounded-md border border-neutral-300 bg-white px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Player"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Your fighter</span>
          <div className="flex flex-wrap gap-2">
            {SHAPES.map((s) => (
              <button
                key={s}
                aria-label={FIGHTER[s].label}
                title={FIGHTER[s].label}
                onClick={() => props.onShape(s)}
                className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border p-1 transition ${
                  s === props.shape
                    ? "border-black bg-neutral-200 ring-2 ring-black dark:border-white dark:bg-neutral-800 dark:ring-white"
                    : "border-neutral-300 bg-neutral-100 hover:bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                }`}
              >
                <img src={FIGHTER[s].src} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Your face photo</span>
          {props.isMember ? (
            <AvatarUploader gameId="arena" currentUrl={props.avatarUrl} />
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700">
              <span aria-hidden>🔒</span>
              <span>Sign in to place your photo on your fighter.</span>
              <a
                href={`/api/auth/login?returnToUrl=${encodeURIComponent(
                  typeof window !== "undefined" ? window.location.pathname + window.location.search : "/games/arena",
                )}`}
                data-astro-reload
                data-astro-prefetch="false"
                className="ml-auto shrink-0 rounded bg-sky-500 px-2 py-1 font-semibold text-white hover:bg-sky-400"
              >
                Sign in
              </a>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">Your weapon</span>
          <div className="flex flex-wrap gap-2">
            {PICKABLE_WEAPONS.map((w) => (
              <button
                key={w}
                onClick={() => props.onWeapon(w)}
                className={`rounded-md border px-3 py-1.5 font-medium transition ${
                  w === props.weapon
                    ? "border-black bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {WEAPON_LABEL[w]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">Invite link</span>
          <div className="flex gap-2">
            <input
              readOnly
              value={props.joinUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full max-w-sm rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button onClick={copy} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {props.isHost ? (
            <>
              <label className="flex items-center gap-2 text-sm text-neutral-500">
                Bots
                <select
                  value={bots}
                  onChange={(e) => setBots(Number(e.target.value))}
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {Array.from({ length: MAX_PLAYERS }, (_, i) => i).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-neutral-500">
                Rounds
                <select
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  className="rounded-md border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {ROUND_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1 (single)" : `Best of ${n}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="group relative inline-block">
                <button
                  onClick={() => canStart && props.onStart(bots, rounds)}
                  aria-disabled={!canStart}
                  className={`rounded-lg px-5 py-2 font-semibold text-white ${
                    canStart ? "bg-sky-500 hover:bg-sky-400" : "cursor-not-allowed bg-sky-500/50"
                  }`}
                >
                  Start match
                </button>
                {!canStart && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-56 -translate-x-1/2 rounded-md bg-neutral-900 px-3 py-2 text-center text-xs text-white shadow-lg group-hover:block dark:bg-neutral-700 dark:text-neutral-100">
                    Game can start with a minimum of 2 players. Share the invite link with a friend and start the battle for pixel superiority!
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-neutral-500">Waiting for the host to start…</span>
          )}
        </div>
      </div>

      {/* right: party list */}
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Party · {props.roster.length}/{MAX_PLAYERS}
        </h3>
        <ul className="flex flex-col gap-2">
          {props.roster.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <img src={FIGHTER[p.shape].src} alt="" className="h-6 w-6 shrink-0 object-contain" />
              <span className="flex-1 truncate text-sm">
                {p.name}
                {p.id === props.localId && " (you)"}
                {p.id === props.hostId && <span className="ml-1 text-xs text-amber-500">host</span>}
              </span>
              {props.isHost && p.id !== props.localId && (
                <>
                  <button
                    onClick={() => props.onMakeHost(p.id)}
                    className="rounded px-2 py-0.5 text-xs text-amber-500 hover:bg-amber-500/10"
                    title="Give host to this player"
                  >
                    make host
                  </button>
                  <button
                    onClick={() => props.onKick(p.id)}
                    className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/10"
                  >
                    kick
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
