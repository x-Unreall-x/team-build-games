/**
 * Enemy roster + steering. Rushers swarm fast and nibble; tanks lumber in and
 * hit hard. AI is chase-nearest-alive with lowest-id tie-breaks (deterministic).
 */

import {
  ENEMY_SEPARATION_WEIGHT, OVERRUN_FIELD_M, PLAYER_RADIUS_M,
  RUSH_CHARGE_S, RUSH_COOLDOWN_S, RUSH_RECOVER_S, RUSH_RUN_MAX_S, RUSH_SPEED_MS,
  SPIT_CHARGE_S, SPIT_COOLDOWN_S, SPITTER_KITE_BAND_M, SPITTER_RANGE_M,
  HIVE_BROOD_SIZE, HIVE_SPAWN_INTERVAL_S, STAGE_HEALTH_SCALAR,
} from "./constants";
import type { Enemy, EnemyKind, ShooterPlayer, Vec2 } from "./types";

export interface EnemyDef {
  kind: EnemyKind;
  /** Physical ground radius used for movement, contact damage, and field bounds. */
  radius: number;
  /** Projectile hit radius, matched to the rendered sprite's full visible width. */
  hitRadius: number;
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
  /** Bullet hits stun + knock this kind back. Heavy units (tank) shrug it off — no stagger. */
  stagger: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  rusher: { kind: "rusher", radius: 0.4, hitRadius: 8 / 7, speed: 4.5, health: 20, damage: 5, attackInterval: 0.5, xp: 2, cost: 1, scoreValue: 10, minWave: 1, stagger: true },
  tank: { kind: "tank", radius: 0.7, hitRadius: 9 / 7, speed: 1.8, health: 120, damage: 20, attackInterval: 0.8, xp: 8, cost: 4, scoreValue: 40, minWave: 3, stagger: false },
  // Tiny, fastest, one-shot HP → cheap hordes (fractional cost; the compose loop spends on `points > 0`).
  swarmling: { kind: "swarmling", radius: 0.28, hitRadius: 6 / 7, speed: 6, health: 6, damage: 3, attackInterval: 0.4, xp: 1, cost: 0.5, scoreValue: 5, minWave: 1, stagger: true },
  // Ranged kiter: holds its distance and lobs acid pools (see stepSpitter). Weak contact damage — its
  // threat is the hazard, not the touch. Medium HP so it survives long enough to be a positioning problem.
  spitter: { kind: "spitter", radius: 0.5, hitRadius: 8 / 7, speed: 3, health: 45, damage: 6, attackInterval: 1, xp: 5, cost: 2.5, scoreValue: 25, minWave: 1, stagger: true },
  // Slow, chases like a rusher but detonates a blast on death (see sim death-blast wiring) — punishes
  // point-blank kills / clustering. Its damage IS the death AoE, not the touch (small contact chip).
  exploder: { kind: "exploder", radius: 0.55, hitRadius: 8 / 7, speed: 2.5, health: 60, damage: 8, attackInterval: 0.8, xp: 6, cost: 3, scoreValue: 30, minWave: 1, stagger: true },
  // Beefy, near-stationary spawner: periodically births swarmling broods (see stepHive). Priority-kill
  // target — no stagger so it can't be perma-locked, and its threat is the endless brood, not contact.
  hive: { kind: "hive", radius: 0.8, hitRadius: 10 / 7, speed: 1, health: 160, damage: 5, attackInterval: 1, xp: 12, cost: 5, scoreValue: 60, minWave: 1, stagger: false },
};

/** Stable order — this index IS the wire encoding of a kind. Append only. */
export const ENEMY_KINDS: EnemyKind[] = ["rusher", "tank", "swarmling", "spitter", "exploder", "hive"];

/** Per-enemy stat multipliers when a spawn rolls elite (campaign only). */
export interface EliteMods { healthMult: number; speedMult: number; damageMult: number; }

/**
 * Elite buff by kind. The tank goes ARMORED (a wall of HP + a harder hit, same lumber speed); everything
 * else (the rusher in practice — elites are gated to rusher/tank at spawn) goes FRENZIED (fast + tougher).
 */
export function eliteMods(kind: EnemyKind): EliteMods {
  if (kind === "tank") return { healthMult: 2, speedMult: 1, damageMult: 1.4 };
  return { healthMult: 1.3, speedMult: 1.6, damageMult: 1.25 };
}

/** Campaign per-stage max-HP multiplier — stage 1 is the baseline (1×), climbing STAGE_HEALTH_SCALAR/stage. */
export function stageHealthMult(stage: number): number {
  return 1 + (Math.max(1, stage) - 1) * STAGE_HEALTH_SCALAR;
}

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

/**
 * Chase the target, stopping at contact range; always tick the attack cooldown (and the
 * bullet-hit micro-stun). `speedMult` scales the kind's base speed (wave-1 slowdown). While
 * stunned (stunRemaining > 0 at the START of this tick) the enemy does not move at all — but
 * cooldowns still tick, so a stun-locked enemy isn't also attack-locked past its own timer.
 */
export function stepEnemy(
  e: Enemy,
  target: Vec2 | null,
  dt: number,
  speedMult = 1,
  separation: Vec2 = { x: 0, y: 0 },
): Enemy {
  const def = ENEMIES[e.kind];
  const cooled = Math.max(0, e.attackCooldown - dt);
  const stunRemaining = Math.max(0, e.stunRemaining - dt);
  // stunRemaining also carries the post-attack freeze — a frozen enemy holds position.
  if (e.stunRemaining > 0) return { ...e, attackCooldown: cooled, stunRemaining };

  const maxMove = def.speed * speedMult * dt;
  let moveX = 0;
  let moveY = 0;

  // Chase: ease to contact range with the target (positive desiredMove = too close → back off).
  if (target) {
    const dx = target.x - e.pos.x;
    const dy = target.y - e.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= 1e-9) {
      const contact = def.radius + PLAYER_RADIUS_M;
      const desiredMove = contact - dist;
      const clampedMove = Math.max(-maxMove, Math.min(maxMove, desiredMove));
      moveX = -(dx / dist) * clampedMove;
      moveY = -(dy / dist) * clampedMove;
    }
  }

  // Separation: push out of the crowd so the horde spreads around the player instead of stacking.
  moveX += separation.x * maxMove * ENEMY_SEPARATION_WEIGHT;
  moveY += separation.y * maxMove * ENEMY_SEPARATION_WEIGHT;

  const pos = {
    x: clamp(e.pos.x + moveX, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(e.pos.y + moveY, def.radius, OVERRUN_FIELD_M - def.radius),
  };
  return { ...e, pos, attackCooldown: cooled, stunRemaining };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Tank Rush state machine + movement (deterministic; no RNG/clock). A tank chases (`none`) while its
 * Rush cooldown ticks down; when it elapses it TELEGRAPHS (`rushCharge`, 0.5 s frozen) and locks the
 * target's current ground position, then CHARGES straight to that fixed point (`rushRun`) at
 * RUSH_SPEED_MS (2× rusher), and on arrival (or the safety cap) enters `rushRecover` (0.5 s frozen),
 * returning `landed: true` on that tick so the caller applies the 50%-HP area hit. `aimPos` is the
 * lead-intercept point used for the normal chase; `lockPos` is the target's REAL position to lock.
 */
export function stepTank(
  e: Enemy,
  aimPos: Vec2 | null,
  lockPos: Vec2 | null,
  dt: number,
  speedMult: number,
  separation: Vec2,
): { enemy: Enemy; landed: boolean } {
  const def = ENEMIES.tank;
  const cooled = Math.max(0, e.attackCooldown - dt);
  const stun = Math.max(0, e.stunRemaining - dt);
  const special = e.special ?? "none";
  const remaining = (e.specialRemaining ?? RUSH_COOLDOWN_S) - dt;
  const bound = (p: Vec2): Vec2 => ({
    x: clamp(p.x, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(p.y, def.radius, OVERRUN_FIELD_M - def.radius),
  });

  // Telegraph + recovery: frozen in place; cooldowns still tick.
  if (special === "rushCharge") {
    if (remaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
    return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushRun", specialRemaining: RUSH_RUN_MAX_S }, landed: false };
  }
  if (special === "rushRecover") {
    if (remaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
    return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "none", specialRemaining: RUSH_COOLDOWN_S, rushTo: null }, landed: false };
  }

  // Charge: run straight to the locked point at RUSH_SPEED_MS, ignoring steering/separation.
  if (special === "rushRun") {
    const to = e.rushTo ?? null;
    if (!to) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushRecover", specialRemaining: RUSH_RECOVER_S }, landed: true };
    const dx = to.x - e.pos.x;
    const dy = to.y - e.pos.y;
    const dist = Math.hypot(dx, dy);
    const step = RUSH_SPEED_MS * dt;
    const arrived = dist <= step || remaining <= 0;
    const pos = arrived ? bound(to) : bound({ x: e.pos.x + (dx / dist) * step, y: e.pos.y + (dy / dist) * step });
    if (arrived) return { enemy: { ...e, pos, attackCooldown: cooled, stunRemaining: stun, special: "rushRecover", specialRemaining: RUSH_RECOVER_S }, landed: true };
    return { enemy: { ...e, pos, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, landed: false };
  }

  // "none": trigger a Rush when the cooldown elapses (freeze + lock); otherwise chase normally.
  if (e.stunRemaining <= 0 && remaining <= 0 && lockPos) {
    return {
      enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "rushCharge", specialRemaining: RUSH_CHARGE_S, rushTo: { ...lockPos } },
      landed: false,
    };
  }
  const stepped = stepEnemy(e, aimPos, dt, speedMult, separation);
  return { enemy: { ...stepped, special: "none", specialRemaining: Math.max(0, remaining) }, landed: false };
}

/**
 * Spitter state machine + movement (deterministic; no RNG/clock). While `none` the spitter KITES —
 * easing toward SPITTER_RANGE_M from its target (backs off if too close, closes if too far, holds inside
 * the hysteresis band) — as its spit cooldown ticks. When the cooldown elapses (and it has a target) it
 * TELEGRAPHS (`spitCharge`, SPIT_CHARGE_S frozen) and locks the target's current ground position; when
 * the telegraph ends it EMITS the spit at that fixed point (returned as `spit`) and resets to `none` with
 * a fresh cooldown. A stun freezes movement but its timers still tick (mirrors the tank).
 */
export function stepSpitter(
  e: Enemy,
  target: Vec2 | null,
  dt: number,
  speedMult: number,
  separation: Vec2,
): { enemy: Enemy; spit: Vec2 | null } {
  const def = ENEMIES.spitter;
  const cooled = Math.max(0, e.attackCooldown - dt);
  const stun = Math.max(0, e.stunRemaining - dt);
  const special = e.special ?? "none";
  const remaining = (e.specialRemaining ?? SPIT_COOLDOWN_S) - dt;

  // Telegraph: frozen while locking; on completion emit the spit at the locked point and reset.
  if (special === "spitCharge") {
    if (remaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: remaining }, spit: null };
    const spit = e.rushTo ?? null;
    return {
      enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "none", specialRemaining: SPIT_COOLDOWN_S, rushTo: null },
      spit,
    };
  }

  // "none": start a spit when the cooldown elapses (freeze + lock); otherwise kite.
  if (e.stunRemaining <= 0 && remaining <= 0 && target) {
    return {
      enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, special: "spitCharge", specialRemaining: SPIT_CHARGE_S, rushTo: { ...target } },
      spit: null,
    };
  }
  if (e.stunRemaining > 0) return { enemy: { ...e, attackCooldown: cooled, stunRemaining: stun, specialRemaining: Math.max(0, remaining) }, spit: null };

  // Kite: signed step toward holding SPITTER_RANGE_M — retreat inside the band's near edge, advance past
  // the far edge, hold within. Separation still applies so spitters don't stack.
  const maxMove = def.speed * speedMult * dt;
  let moveX = 0;
  let moveY = 0;
  if (target) {
    const dx = target.x - e.pos.x;
    const dy = target.y - e.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= 1e-9) {
      const half = SPITTER_KITE_BAND_M / 2;
      let desired = 0; // + = advance toward target, - = retreat
      if (dist > SPITTER_RANGE_M + half) desired = Math.min(maxMove, dist - (SPITTER_RANGE_M + half));
      else if (dist < SPITTER_RANGE_M - half) desired = -Math.min(maxMove, (SPITTER_RANGE_M - half) - dist);
      moveX = (dx / dist) * desired;
      moveY = (dy / dist) * desired;
    }
  }
  moveX += separation.x * maxMove * ENEMY_SEPARATION_WEIGHT;
  moveY += separation.y * maxMove * ENEMY_SEPARATION_WEIGHT;
  const pos = {
    x: clamp(e.pos.x + moveX, def.radius, OVERRUN_FIELD_M - def.radius),
    y: clamp(e.pos.y + moveY, def.radius, OVERRUN_FIELD_M - def.radius),
  };
  return { enemy: { ...e, pos, attackCooldown: cooled, stunRemaining: stun, special: "none", specialRemaining: Math.max(0, remaining) }, spit: null };
}

/**
 * Hive movement + brood timer (deterministic). The hive crawls toward its target via the normal chase
 * (it's just very slow), while `specialRemaining` counts down its brood interval. When the interval
 * elapses (and it isn't stunned) it returns `spawn: HIVE_BROOD_SIZE` for the sim to birth a swarmling
 * brood, and resets the timer. The timer keeps ticking under stun but a stunned hive holds its brood.
 */
export function stepHive(
  e: Enemy,
  target: Vec2 | null,
  dt: number,
  speedMult: number,
  separation: Vec2,
): { enemy: Enemy; spawn: number } {
  const moved = stepEnemy(e, target, dt, speedMult, separation);
  const remaining = (e.specialRemaining ?? HIVE_SPAWN_INTERVAL_S) - dt;
  if (e.stunRemaining <= 0 && remaining <= 0) {
    return { enemy: { ...moved, special: "none", specialRemaining: HIVE_SPAWN_INTERVAL_S }, spawn: HIVE_BROOD_SIZE };
  }
  return { enemy: { ...moved, special: "none", specialRemaining: Math.max(0, remaining) }, spawn: 0 };
}
