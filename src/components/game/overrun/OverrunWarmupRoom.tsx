import { useState } from "react";
import type { PlayerId } from "../../../game/overrun/types";

/**
 * Overrun's warm-up room. Leaner than Arena's: no shape/weapon/avatar/bots/rounds —
 * this game has no cosmetic picker (colorIndex is derived at match start from oStart
 * order, never chosen here). Party rows use a neutral index-in-roster color preview.
 */

/** Same 8-color squad palette the scene tints soldiers with — index-in-roster preview only. */
const RING_COLORS = ["#f8fafc", "#fbbf24", "#38bdf8", "#f472b6", "#a3e635", "#c084fc", "#fb923c", "#2dd4bf"];

interface RosterEntry {
  id: PlayerId;
  name: string;
}

interface Props {
  roster: RosterEntry[];
  localId: PlayerId;
  hostId: PlayerId | null;
  isHost: boolean;
  name: string;
  joinUrl: string;
  onName: (n: string) => void;
  onStart: () => void;
  onKick: (id: PlayerId) => void;
  onMakeHost: (id: PlayerId) => void;
}

export default function OverrunWarmupRoom(props: Props) {
  const [copied, setCopied] = useState(false);
  const canStart = props.roster.length >= 1;

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
          <h2 className="text-3xl font-bold">Overrun — warm-up room</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Share the link, then the host starts the run. Fight off the waves together —
            downed teammates can be revived.
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

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          WASD move · mouse aim · hold LMB fire · R reload · 1/2/3 perks
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          {props.isHost ? (
            <button
              onClick={() => canStart && props.onStart()}
              aria-disabled={!canStart}
              className={`rounded-lg px-5 py-2 font-semibold text-white ${
                canStart ? "bg-red-600 hover:bg-red-500" : "cursor-not-allowed bg-red-600/50"
              }`}
            >
              Start — co-op up to 8
            </button>
          ) : (
            <span className="text-sm text-neutral-500">Waiting for the host…</span>
          )}
        </div>
      </div>

      {/* right: party list */}
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Squad · {props.roster.length}
        </h3>
        <ul className="flex flex-col gap-2">
          {props.roster.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: RING_COLORS[i % RING_COLORS.length] }}
              />
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
                    ★
                  </button>
                  <button
                    onClick={() => props.onKick(p.id)}
                    className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/10"
                    title="Kick this player"
                  >
                    ✕
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
