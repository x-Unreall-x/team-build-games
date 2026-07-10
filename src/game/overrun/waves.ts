/**
 * Wave engine: a points budget (escalating with the wave, proportional to the
 * frozen partySize) is spent on enemy kinds; spawns land on the field perimeter.
 * All draws are coordinate-hashed off (seed, wave|spawnSeq) — reproducible anywhere.
 */

import { OVERRUN_FIELD_M } from "./constants";
import { ENEMIES } from "./enemies";
import { hash01 } from "./rng";
import type { EnemyKind, Vec2 } from "./types";

const BASE_BUDGET = 6;
const BUDGET_PER_WAVE = 4;
const TANK_MIX = 0.25;

/**
 * Endless-run wire/CPU guard: `pending` re-ships in full on any wave-start delta
 * (see codec.ts diffWorld), and the host must keep spawning it every tick — so an
 * uncapped budget (e.g. 8 players, wave 50 → ~927 pending) can blow both the wire
 * and host CPU. Budget beyond this cap is simply dropped; composeWave stops queueing.
 */
export const MAX_PENDING = 150;

/** Points to spend on this wave. partySize is frozen at wave start (mid-wave churn immune). */
export function waveBudget(wave: number, partySize: number): number {
  return Math.round((BASE_BUDGET + BUDGET_PER_WAVE * wave) * (0.5 + 0.5 * partySize));
}

/** The wave's spawn queue: kinds drawn per-slot off (seed, "mix", wave, i). Capped at MAX_PENDING. */
export function composeWave(seed: number, wave: number, partySize: number): EnemyKind[] {
  let points = waveBudget(wave, partySize);
  const queue: EnemyKind[] = [];
  for (let i = 0; points > 0 && queue.length < MAX_PENDING; i++) {
    const tankOk = wave >= ENEMIES.tank.minWave && points >= ENEMIES.tank.cost;
    const kind: EnemyKind = tankOk && hash01(seed, "mix", wave, i) < TANK_MIX ? "tank" : "rusher";
    queue.push(kind);
    points -= ENEMIES[kind].cost;
  }
  return queue;
}

/** Perimeter position for the Nth spawn: walk the square's edge by a hashed parameter. */
export function spawnPos(seed: number, spawnSeq: number): Vec2 {
  const t = hash01(seed, "spawn", spawnSeq) * 4;
  const f = OVERRUN_FIELD_M;
  const d = (t % 1) * f;
  if (t < 1) return { x: d, y: 0 };
  if (t < 2) return { x: f, y: d };
  if (t < 3) return { x: f - d, y: f };
  return { x: 0, y: f - d };
}
