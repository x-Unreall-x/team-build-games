// src/game/overrun/sim.ts
/**
 * stepShooter — THE Overrun reducer. Pure: (world, intents, dt) → world.
 * Fixed phase order (each numbered block below); every random draw is a
 * coordinate-hash off the world-carried seed. Players iterate in sorted-id
 * order, enemies in spawn (array) order — byte-reproducible on any peer.
 *
 * Order: picks → upkeep/move → fire(+kills/drops/xp) → enemies(+contact/downed)
 * → revive → wipe-check (revive-before-wipe) → pickups → waves/spawning → caps.
 */

import {
  EVENT_TTL_TICKS, INTERMISSION_S, MAX_ENEMIES, MAX_EVENTS, OVERRUN_FIELD_M,
  PLAYER_RADIUS_M, PLAYER_SPEED_MS, REVIVE_HEALTH, REVIVE_RANGE_M, REVIVE_S,
  MEDKIT_HEAL, SPAWNS_PER_TICK, SWAP_GUARD_S, WAVE1_SPEED_MULT,
  ENEMY_SEPARATION_M, ENEMY_LEAD_TICKS, ENEMY_LEAD_MAX_M, ENEMY_ATTACK_FREEZE_S,
  ENEMY_CONTACT_SLACK_M,
} from "./constants";
import { ENEMIES, nearestAlive, stepEnemy } from "./enemies";
import { fireTick, tickAmmo, tryStartReload } from "./firing";
import { effectiveStats, rollOffer, xpToNext } from "./perks";
import { rollDrop } from "./drops";
import { composeWave, spawnPos } from "./waves";
import { CAMPAIGN_WAVES } from "./stages";
import { freshAmmo, GUNS } from "./weapons";
import type { Enemy, Pickup, PlayerId, ShooterEvent, ShooterIntent, ShooterPhase, ShooterPlayer, ShooterWorld } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function stepShooter(
  world: ShooterWorld,
  intents: Record<PlayerId, ShooterIntent>,
  dt: number,
): ShooterWorld {
  if (world.phase === "ended" || world.phase === "victory") return world; // 1. frozen for the scoreboard

  const tick = world.tick + 1;
  const seed = world.seed;
  const mode = world.mode;
  const ids = Object.keys(world.players).sort();
  const events: ShooterEvent[] = world.events.filter((e) => e.tick > tick - EVENT_TTL_TICKS); // 2.
  const players: Record<PlayerId, ShooterPlayer> = { ...world.players };
  let enemies: Enemy[] = world.enemies;
  let pickups: Pickup[] = [...world.pickups];
  let { score, pity, spawnSeq, wave, partySize, intermission } = world;
  let pending = world.pending;

  // 3. perk picks
  for (const id of ids) {
    const pick = intents[id]?.perkPick ?? null;
    const p = players[id]!;
    if (pick !== null && p.offers.length > 0) {
      const [head, ...rest] = p.offers;
      players[id] = { ...p, perks: [...p.perks, head!.choices[pick]], offers: rest };
    }
  }

  // 4. upkeep + movement
  for (const id of ids) {
    const intent = intents[id];
    let p = players[id]!;
    const eff = effectiveStats(p.perks);
    p = tickAmmo(p, dt, eff);
    p = { ...p, swapGuard: Math.max(0, p.swapGuard - dt) };
    if (p.status === "alive" && intent) {
      if (intent.aim !== undefined && Number.isFinite(intent.aim)) p = { ...p, aim: intent.aim };
      const mx = (intent.move.right ? 1 : 0) - (intent.move.left ? 1 : 0);
      const my = (intent.move.down ? 1 : 0) - (intent.move.up ? 1 : 0);
      if (mx !== 0 || my !== 0) {
        const n = Math.hypot(mx, my);
        const v = PLAYER_SPEED_MS * eff.moveSpeedMult * dt;
        p = {
          ...p,
          pos: {
            x: clamp(p.pos.x + (mx / n) * v, PLAYER_RADIUS_M, OVERRUN_FIELD_M - PLAYER_RADIUS_M),
            y: clamp(p.pos.y + (my / n) * v, PLAYER_RADIUS_M, OVERRUN_FIELD_M - PLAYER_RADIUS_M),
          },
        };
      }
      if (intent.reload) p = tryStartReload(p, eff);
    }
    players[id] = p;
  }

  // 5. firing + kill attribution (sequential per player so the killer is unambiguous)
  for (const id of ids) {
    const intent = intents[id];
    let p = players[id]!;
    const eff = effectiveStats(p.perks);
    const res = fireTick(p, enemies, intent?.fire ?? false, seed, tick, eff);
    p = res.player;
    events.push(...res.events);
    const survivors: Enemy[] = [];
    for (const e of res.enemies) {
      if (e.health > 0) {
        survivors.push(e);
        continue;
      }
      const def = ENEMIES[e.kind];
      // xp + level-ups
      let xp = p.xp + def.xp;
      let level = p.level;
      let offers = p.offers;
      while (xp >= xpToNext(level)) {
        xp -= xpToNext(level);
        level += 1;
        offers = [...offers, rollOffer(seed, tick, p.id, level)];
        events.push({ tick, kind: "levelup", playerId: p.id });
      }
      p = { ...p, xp, level, offers, stats: { ...p.stats, kills: p.stats.kills + 1 } };
      score += def.scoreValue * wave;
      events.push({ tick, kind: "kill", pos: { x: e.pos.x, y: e.pos.y }, enemy: e.kind });
      const drop = rollDrop(seed, tick, e, pickups.length, pity);
      pity = drop.pity;
      if (drop.pickup) pickups.push(drop.pickup);
    }
    enemies = survivors;
    players[id] = p;
  }

  // 6. enemies: chase (with separation + intercept lead) + contact damage
  const aliveSorted = () => ids.map((i) => players[i]!).filter((p) => p.status === "alive");
  // Snapshot who's alive BEFORE contact resolves: a teammate downed by an enemy
  // this same tick still counts as having helped revive (actions within a tick
  // are conceptually simultaneous — see the "revive-before-wipe, same tick" case).
  const preCombatAliveIds = new Set(aliveSorted().map((p) => p.id));
  const speedMult = wave === 1 ? WAVE1_SPEED_MULT : 1;
  // Per-player velocity this tick (players already moved in step 5) — enemies lead it to intercept.
  const playerVel: Record<PlayerId, { x: number; y: number }> = {};
  for (const id of ids) {
    playerVel[id] = { x: players[id]!.pos.x - world.players[id]!.pos.x, y: players[id]!.pos.y - world.players[id]!.pos.y };
  }
  // Separation reads every enemy's position from THIS frame's input (crowd), so the push is
  // order-independent and deterministic regardless of map iteration order.
  const crowd = enemies;
  enemies = enemies.map((e) => {
    const target = nearestAlive(e.pos, aliveSorted());

    // Intercept: aim where the target is heading, not where it is (capped so strafing can't fling it).
    let aimPos: { x: number; y: number } | null = null;
    if (target) {
      const v = playerVel[target.id] ?? { x: 0, y: 0 };
      let leadX = v.x * ENEMY_LEAD_TICKS;
      let leadY = v.y * ENEMY_LEAD_TICKS;
      const leadLen = Math.hypot(leadX, leadY);
      if (leadLen > ENEMY_LEAD_MAX_M) {
        leadX = (leadX / leadLen) * ENEMY_LEAD_MAX_M;
        leadY = (leadY / leadLen) * ENEMY_LEAD_MAX_M;
      }
      aimPos = { x: target.pos.x + leadX, y: target.pos.y + leadY };
    }

    // Separation: sum of inverse-distance pushes away from nearby enemies, capped to a unit vector.
    let sepX = 0;
    let sepY = 0;
    for (const o of crowd) {
      if (o.id === e.id) continue;
      const ox = e.pos.x - o.pos.x;
      const oy = e.pos.y - o.pos.y;
      const d = Math.hypot(ox, oy);
      if (d > 1e-6 && d < ENEMY_SEPARATION_M) {
        const push = (1 - d / ENEMY_SEPARATION_M) / d;
        sepX += ox * push;
        sepY += oy * push;
      }
    }
    const sepLen = Math.hypot(sepX, sepY);
    const separation = sepLen > 1 ? { x: sepX / sepLen, y: sepY / sepLen } : { x: sepX, y: sepY };

    let stepped = stepEnemy(e, aimPos, dt, speedMult, separation);
    if (target) {
      const def = ENEMIES[e.kind];
      // Contact damage keys off the REAL target position (the lead point is only for movement).
      const d = Math.hypot(target.pos.x - stepped.pos.x, target.pos.y - stepped.pos.y);
      if (d <= def.radius + PLAYER_RADIUS_M + ENEMY_CONTACT_SLACK_M && stepped.attackCooldown === 0 && stepped.stunRemaining <= 0) {
        const t = players[target.id]!;
        const health = Math.max(0, t.health - def.damage);
        players[target.id] =
          health === 0
            ? { ...t, health: 0, status: "downed", reviveProgress: 0 }
            : { ...t, health };
        if (health === 0) events.push({ tick, kind: "downed", playerId: t.id });
        else events.push({ tick, kind: "playerHit", playerId: t.id });
        // Freeze briefly after attacking so the player gets a beat to peel away.
        stepped = { ...stepped, attackCooldown: def.attackInterval, stunRemaining: Math.max(stepped.stunRemaining, ENEMY_ATTACK_FREEZE_S) };
      }
    }
    return stepped;
  });

  // 7. revive (proximity)
  for (const id of ids) {
    const p = players[id]!;
    if (p.status !== "downed") continue;
    const helper = ids.some(
      (qid) =>
        qid !== id &&
        preCombatAliveIds.has(qid) &&
        Math.hypot(players[qid]!.pos.x - p.pos.x, players[qid]!.pos.y - p.pos.y) <= REVIVE_RANGE_M,
    );
    if (!helper) {
      if (p.reviveProgress !== 0) players[id] = { ...p, reviveProgress: 0 };
      continue;
    }
    const progress = p.reviveProgress + dt;
    if (progress >= REVIVE_S) {
      const eff = effectiveStats(p.perks);
      players[id] = { ...p, status: "alive", health: Math.min(REVIVE_HEALTH, eff.maxHealth), reviveProgress: 0 };
      events.push({ tick, kind: "revived", playerId: id });
    } else {
      players[id] = { ...p, reviveProgress: progress };
    }
  }

  // 8. wipe check (after revive — revive-before-wipe)
  // Explicit annotation: control-flow narrowing on the early `phase === "ended"`
  // return above would otherwise infer `phase` as the literal "playing" here,
  // rejecting the "ended" assignment two lines down.
  let phase: ShooterPhase = world.phase;
  if (!ids.some((id) => players[id]!.status === "alive")) phase = "ended";

  // 9. pickups: expiry + collection
  pickups = pickups.map((k) => ({ ...k, ttl: k.ttl - dt })).filter((k) => k.ttl > 0);
  for (const id of ids) {
    let p = players[id]!;
    if (p.status !== "alive") continue;
    const eff = effectiveStats(p.perks);
    const remaining: Pickup[] = [];
    for (const k of pickups) {
      const inRange = Math.hypot(k.pos.x - p.pos.x, k.pos.y - p.pos.y) <= eff.pickupRadius;
      if (!inRange) {
        remaining.push(k);
        continue;
      }
      if (k.kind === "medkit") {
        p = { ...p, health: Math.min(eff.maxHealth, p.health + MEDKIT_HEAL) };
      } else if (p.swapGuard > 0) {
        remaining.push(k);
        continue;
      } else if (k.kind === p.gun) {
        p = { ...p, ammo: { ...p.ammo, reserve: GUNS[p.gun].reserveMax ?? 0 } };
      } else {
        p = { ...p, gun: k.kind, ammo: freshAmmo(k.kind), swapGuard: SWAP_GUARD_S };
      }
      events.push({ tick, kind: "pickup", pos: { x: k.pos.x, y: k.pos.y }, item: k.kind });
    }
    pickups = remaining;
    players[id] = p;
  }

  // 10. waves + spawning
  const partyCount = () => ids.filter((id) => players[id]!.status !== "dead").length;
  if (phase === "playing") {
    if (wave === 0) {
      wave = 1;
      partySize = partyCount();
      pending = composeWave(seed, wave, partySize);
    } else if (pending.length === 0 && enemies.length === 0 && intermission === 0) {
      intermission = INTERMISSION_S;
      for (const id of ids) {
        const p = players[id]!;
        if (p.status === "downed") {
          const eff = effectiveStats(p.perks);
          players[id] = { ...p, status: "alive", health: Math.min(REVIVE_HEALTH, eff.maxHealth), reviveProgress: 0 };
          events.push({ tick, kind: "revived", playerId: id });
        }
      }
    } else if (intermission > 0) {
      intermission = Math.max(0, intermission - dt);
      if (intermission === 0) {
        if (mode === "campaign" && wave >= CAMPAIGN_WAVES) {
          // Final stage's last wave cleared — the campaign is won. Survival never hits this.
          phase = "victory";
        } else {
          wave += 1;
          partySize = partyCount();
          pending = composeWave(seed, wave, partySize);
        }
      }
    }
    if (pending.length > 0) {
      const spawned: Enemy[] = [];
      let queue = pending;
      while (spawned.length < SPAWNS_PER_TICK && queue.length > 0 && enemies.length + spawned.length < MAX_ENEMIES) {
        const kind = queue[0]!;
        queue = queue.slice(1);
        spawned.push({ id: `e${spawnSeq}`, kind, pos: spawnPos(seed, spawnSeq), health: ENEMIES[kind].health, attackCooldown: 0, stunRemaining: 0 });
        spawnSeq += 1;
      }
      pending = queue;
      enemies = [...enemies, ...spawned];
    }
  }

  // 11. caps
  const cappedEvents = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;

  return {
    tick, phase, mode, seed, wave, partySize, pending, intermission,
    players, enemies, pickups, events: cappedEvents, score, spawnSeq, pity,
  };
}
