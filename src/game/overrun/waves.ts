/**
 * Wave engine: a points budget (escalating with the wave, proportional to the
 * frozen partySize) is spent on enemy kinds; spawns land on the field perimeter.
 * All draws are coordinate-hashed off (seed, wave|spawnSeq) — reproducible anywhere.
 */

import { OVERRUN_FIELD_M } from "./constants";
import { ENEMIES } from "./enemies";
import { stageForWave } from "./stages";
import { hash01 } from "./rng";
import type { EnemyKind, Vec2 } from "./types";

const BASE_BUDGET = 6;
const BUDGET_PER_WAVE = 4;
const TANK_MIX = 0.25;
/** Each campaign stage is ~15% heavier than the last (its budget uses the STAGE-RELATIVE wave). */
const STAGE_BUDGET_MULT = 0.15;

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

/**
 * Budget + tank-gate for a wave. Survival scales with the absolute wave (tanks from minWave). Campaign
 * scales with the STAGE-RELATIVE wave × a per-stage multiplier (each stage resets progression, so it
 * ramps from easy), and gates tanks so stage 1 stays rushers-only until its wave 3.
 */
function wavePlan(wave: number, partySize: number, campaign: boolean): { budget: number; allowTank: boolean } {
  if (!campaign) {
    return { budget: waveBudget(wave, partySize), allowTank: wave >= ENEMIES.tank.minWave };
  }
  const { stage, waveInStage } = stageForWave(wave);
  const budget = Math.round(
    (BASE_BUDGET + BUDGET_PER_WAVE * waveInStage) * (0.5 + 0.5 * partySize) * (1 + (stage - 1) * STAGE_BUDGET_MULT),
  );
  const allowTank = !(stage === 1 && waveInStage < 3); // stage 1: rushers-only until wave 3
  return { budget, allowTank };
}

/** The wave's spawn queue: kinds drawn per-slot off (seed, "mix", wave, i). Capped at MAX_PENDING. */
export function composeWave(
  seed: number,
  wave: number,
  partySize: number,
  opts: { campaign?: boolean } = {},
): EnemyKind[] {
  const { budget, allowTank } = wavePlan(wave, partySize, !!opts.campaign);
  let points = budget;
  const queue: EnemyKind[] = [];
  for (let i = 0; points > 0 && queue.length < MAX_PENDING; i++) {
    const tankOk = allowTank && points >= ENEMIES.tank.cost;
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
