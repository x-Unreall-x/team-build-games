/**
 * Enemy roster + steering. Rushers swarm fast and nibble; tanks lumber in and
 * hit hard. AI is chase-nearest-alive with lowest-id tie-breaks (deterministic).
 */

import type { Vec2 } from "../arena/types";
import { OVERRUN_FIELD_M, PLAYER_RADIUS_M } from "./constants";
import type { Enemy, EnemyKind, ShooterPlayer } from "./types";

export interface EnemyDef {
  kind: EnemyKind;
  radius: number;
  speed: number;
  health: number;
  /** Contact damage per attack. */
  damage: number;
  /** Seconds between contact attacks. */
  attackInterval: number;
  xp: number;
  /** Wave-budget points this kind costs. */
  cost: number;
  /** Score awarded per kill (× current wave). */
  scoreValue: number;
  /** First wave this kind may appear on. */
  minWave: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  rusher: { kind: "rusher", radius: 0.4, speed: 4.5, health: 20, damage: 5, attackInterval: 0.5, xp: 2, cost: 1, scoreValue: 10, minWave: 1 },
  tank: { kind: "tank", radius: 0.9, speed: 1.8, health: 120, damage: 20, attackInterval: 0.8, xp: 8, cost: 4, scoreValue: 40, minWave: 3 },
};

/** Stable order — this index IS the wire encoding of a kind. Append only. */
export const ENEMY_KINDS: EnemyKind[] = ["rusher", "tank"];

/** Closest living player (input must be sorted by id; ties keep the first = lowest id). */
export function nearestAlive(pos: Vec2, players: ShooterPlayer[]): ShooterPlayer | null {
  let best: ShooterPlayer | null = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Chase the target, stopping at contact range; always tick the attack cooldown. */
export function stepEnemy(e: Enemy, target: Vec2 | null, dt: number): Enemy {
  const def = ENEMIES[e.kind];
  const cooled = Math.max(0, e.attackCooldown - dt);
  if (!target) return { ...e, attackCooldown: cooled };
  const dx = target.x - e.pos.x;
  const dy = target.y - e.pos.y;
  const dist = Math.hypot(dx, dy);
  const contact = def.radius + PLAYER_RADIUS_M;

  if (dist < 1e-9) return { ...e, attackCooldown: cooled };

  // Adjust distance to reach contact range (positive = too close, negative = too far)
  const desiredMove = contact - dist;
  const maxMove = def.speed * dt;
  const clampedMove = Math.max(-maxMove, Math.min(maxMove, desiredMove));

  const dirX = dx / dist;
  const dirY = dy / dist;

  const pos = {
    x: clamp(e.pos.x - dirX * clampedMove, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(e.pos.y - dirY * clampedMove, def.radius, OVERRUN_FIELD_M - def.radius),
  };
  return { ...e, pos, attackCooldown: cooled };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
