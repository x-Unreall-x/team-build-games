/**
 * The pure simulation heart: a deterministic per-tick reducer.
 *
 *   stepWorld(world, intentsById, dt) -> world
 *
 * No engine/DOM/clock/RNG — `dt` is injected so the same inputs always produce the
 * same output (host runs it authoritatively; tests run it under a LocalTransport).
 * Composes movement + dash + combat + death + win.
 */

import type { Intent, PlayerState, PlayerStats, Projectile, Vec2, World } from "./types";
import { aimVector, clampToField, directionAngle, directionFromInput, directionVector } from "./logic";
import {
  consumeDashDistance,
  dashSpeedMultiplier,
  tickDashCooldown,
  tryStartDash,
} from "./dash";
import { resolveAttack } from "./combat";
import { advanceProjectile, projectileTarget, spawnArrow } from "./projectile";
import { soleSurvivor } from "./match";
import { WEAPONS } from "./weapons";
import {
  ATTACK_TTL_S,
  FIELD_M,
  FIGURE_RADIUS_M,
  RUN_SPEED_MS,
} from "../constants";

const NO_INPUT = { up: false, down: false, left: false, right: false } as const;

/** Advance the world by one tick. Only simulates while phase === "playing". */
export function stepWorld(
  world: World,
  intentsById: Record<string, Intent>,
  dt: number,
): World {
  if (world.phase !== "playing") return world;

  // 1) Per-player movement, dash, facing, and attack-state update.
  const players: Record<string, PlayerState> = {};
  const attackedThisTick: string[] = [];
  const newProjectiles: Projectile[] = [];
  // Cosmetic per-player tallies, seeded from the running totals and applied at the end of the tick.
  const stats: Record<string, PlayerStats> = {};
  for (const p of Object.values(world.players)) stats[p.id] = { ...p.stats };

  for (const p of Object.values(world.players)) {
    if (p.status !== "alive") {
      players[p.id] = p;
      continue;
    }
    const intent: Intent = intentsById[p.id] ?? {
      move: { ...NO_INPUT },
      facing: p.facing,
      dash: false,
      attack: false,
    };

    const facing = intent.facing;
    // Free-aim angle drives the weapon + attack cone; without a mouse it falls back to facing.
    const aim = intent.aim ?? directionAngle(facing);

    // Dash: recharge first, then maybe start a new burst this tick.
    let dash = tickDashCooldown(p.dash, dt);
    if (intent.dash) dash = tryStartDash(dash);

    // Movement (dash multiplies speed; a keyless dash carries you forward).
    let moveDir = directionFromInput(intent.move);
    if (dash.dashing && moveDir.x === 0 && moveDir.y === 0) moveDir = directionVector(facing);
    const speed = RUN_SPEED_MS * dashSpeedMultiplier(dash);
    // While dashing, cap the step to the remaining 2 m budget (exact, dt-independent burst)
    // and charge the budget the INTENDED distance — so a wall can't freeze the dash.
    const stepLen = speed * dt;
    const moveLen = dash.dashing ? Math.min(stepLen, dash.distRemaining) : stepLen;
    const rawPos: Vec2 = {
      x: p.pos.x + moveDir.x * moveLen,
      y: p.pos.y + moveDir.y * moveLen,
    };
    const pos = clampToField(rawPos, FIELD_M, FIGURE_RADIUS_M);
    stats[p.id]!.distance += Math.hypot(pos.x - p.pos.x, pos.y - p.pos.y); // actual metres moved (post-clamp)
    dash = consumeDashDistance(dash, moveLen);

    // Attack: a new swing requires the 1s cooldown to be ready; otherwise decay any
    // active swing visual. The cooldown clock always ticks down.
    let attackCooldownRemaining = Math.max(0, p.attackCooldownRemaining - dt);
    let attack = p.attack;
    if (intent.attack && attackCooldownRemaining <= 0) {
      const weap = WEAPONS[p.weapon];
      attack = { aim, ttl: ATTACK_TTL_S };
      attackCooldownRemaining = weap.cooldown;
      if (weap.ranged) {
        // Ranged weapon (bow): loose an arrow along the aim instead of a melee hit.
        newProjectiles.push(
          spawnArrow({
            ownerId: p.id,
            pos,
            aim,
            tick: world.tick,
            speed: weap.ranged.speed,
            range: weap.ranged.range,
            damage: 1,
            knockback: weap.knockback,
          }),
        );
      } else {
        attackedThisTick.push(p.id);
      }
    } else if (attack) {
      const ttl = attack.ttl - dt;
      attack = ttl > 0 ? { ...attack, ttl } : null;
    }

    players[p.id] = { ...p, pos, facing, aim, dash, attack, attackCooldownRemaining };
  }

  // 2) Resolve combat against post-movement positions; accumulate damage + knockback
  //    (each hit pushes the victim KNOCKBACK_M away, along the attacker's aim).
  const candidates = Object.values(players);
  const damageByTarget: Record<string, number> = {};
  const knockByTarget: Record<string, Vec2> = {};
  for (const attackerId of attackedThisTick) {
    const attacker = players[attackerId]!;
    const weap = WEAPONS[attacker.weapon];
    const push = aimVector(attacker.aim);
    const events = resolveAttack(attacker, candidates);
    if (events.length > 0) stats[attackerId]!.hits += 1;
    else stats[attackerId]!.misses += 1; // melee swing that connected with nobody
    for (const ev of events) {
      damageByTarget[ev.targetId] = (damageByTarget[ev.targetId] ?? 0) + 1;
      const k = knockByTarget[ev.targetId] ?? { x: 0, y: 0 };
      knockByTarget[ev.targetId] = { x: k.x + push.x * weap.knockback, y: k.y + push.y * weap.knockback };
    }
  }

  // 2.5) Advance projectiles: move, resolve the first body hit (→ damage + knockback along its
  //      heading), else expire on spent range or a field wall. Deterministic (no clock/RNG).
  const projectiles: Projectile[] = [];
  for (const proj of [...world.projectiles, ...newProjectiles]) {
    const moved = advanceProjectile(proj, dt);
    const hitId = projectileTarget(moved, candidates);
    if (hitId) {
      if (stats[moved.ownerId]) stats[moved.ownerId]!.hits += 1; // arrow connected → shooter's hit
      damageByTarget[hitId] = (damageByTarget[hitId] ?? 0) + moved.damage;
      const spd = Math.hypot(moved.vel.x, moved.vel.y) || 1;
      const k = knockByTarget[hitId] ?? { x: 0, y: 0 };
      knockByTarget[hitId] = {
        x: k.x + (moved.vel.x / spd) * moved.knockback,
        y: k.y + (moved.vel.y / spd) * moved.knockback,
      };
      continue; // consumed on hit
    }
    if (moved.distRemaining <= 0) {
      if (stats[moved.ownerId]) stats[moved.ownerId]!.misses += 1; // arrow spent its range → miss
      continue;
    }
    if (moved.pos.x < 0 || moved.pos.x > FIELD_M || moved.pos.y < 0 || moved.pos.y > FIELD_M) {
      if (stats[moved.ownerId]) stats[moved.ownerId]!.misses += 1; // arrow hit a wall → miss
      continue;
    }
    projectiles.push(moved);
  }

  // 3) Apply damage, knockback, and deaths.
  for (const [id, dmg] of Object.entries(damageByTarget)) {
    const p = players[id]!;
    const health = Math.max(0, p.health - dmg);
    const k = knockByTarget[id]!;
    const pos = clampToField({ x: p.pos.x + k.x, y: p.pos.y + k.y }, FIELD_M, FIGURE_RADIUS_M);
    players[id] =
      health <= 0
        ? { ...p, pos, health: 0, status: "dead", attack: null }
        : { ...p, pos, health };
  }

  // 3.5) Fold this tick's stat tallies back onto every player.
  for (const id of Object.keys(players)) players[id] = { ...players[id]!, stats: stats[id] ?? players[id]!.stats };

  // 4) Win condition: one (or zero) left → match ends.
  const next: World = { ...world, players, projectiles, tick: world.tick + 1 };
  const aliveIds = Object.values(players).filter((p) => p.status === "alive");
  if (aliveIds.length <= 1) {
    next.phase = "ended";
    next.winnerId = soleSurvivor(next);
  }
  return next;
}
