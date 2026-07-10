// src/game/overrun/sim.test.ts
import { describe, expect, it } from "vitest";
import { stepShooter } from "./sim";
import { createShooterWorld } from "./match";
import { ENEMIES } from "./enemies";
import { INTERMISSION_S, REVIVE_HEALTH, REVIVE_S, SHOOTER_DT, WAVE1_SPEED_MULT } from "./constants";
import { waveBudget } from "./waves";
import { xpToNext } from "./perks";
import type { Enemy, ShooterIntent, ShooterWorld } from "./types";

const IDLE: ShooterIntent = { move: { up: false, down: false, left: false, right: false }, fire: false, reload: false, perkPick: null };
const intents = (w: ShooterWorld, over: Record<string, Partial<ShooterIntent>> = {}) =>
  Object.fromEntries(Object.keys(w.players).map((id) => [id, { ...IDLE, ...over[id] }]));
const step = (w: ShooterWorld, over: Record<string, Partial<ShooterIntent>> = {}) =>
  stepShooter(w, intents(w, over), SHOOTER_DT);
const enemyAt = (id: string, x: number, y: number, over: Partial<Enemy> = {}): Enemy =>
  ({ id, kind: "rusher", pos: { x, y }, health: 20, attackCooldown: 0, stunRemaining: 0, ...over });

describe("determinism", () => {
  it("same seed + same intent script → identical worlds over 600 ticks", () => {
    const script = (w: ShooterWorld, t: number) =>
      intents(w, { a: { move: { up: t % 7 < 3, down: false, left: t % 5 < 2, right: false }, fire: t % 3 === 0, aim: (t % 62) / 10 } });
    let w1 = createShooterWorld(["a", "b"], 1234);
    let w2 = createShooterWorld(["a", "b"], 1234);
    for (let t = 0; t < 600; t++) {
      w1 = stepShooter(w1, script(w1, t), SHOOTER_DT);
      w2 = stepShooter(w2, script(w2, t), SHOOTER_DT);
    }
    expect(w2).toEqual(w1);
    expect(w1.wave).toBeGreaterThanOrEqual(1);
  });
});

describe("movement", () => {
  it("moves alive players (diagonal normalized) and clamps to the field", () => {
    const w0 = createShooterWorld(["a"], 1);
    const w1 = step(w0, { a: { move: { up: false, down: true, left: false, right: true } } });
    const d = Math.hypot(w1.players.a!.pos.x - w0.players.a!.pos.x, w1.players.a!.pos.y - w0.players.a!.pos.y);
    expect(d).toBeCloseTo(4 * SHOOTER_DT, 5);
  });

  it("downed players don't move or fire", () => {
    const w0 = createShooterWorld(["a", "b"], 1);
    w0.players.a = { ...w0.players.a!, status: "downed", health: 0 };
    const w1 = step(w0, { a: { move: { up: true, down: false, left: false, right: false }, fire: true } });
    expect(w1.players.a!.pos).toEqual(w0.players.a!.pos);
    expect(w1.players.a!.stats.shots).toBe(0);
  });
});

describe("waves", () => {
  it("wave 1 starts on the first tick with the frozen party budget", () => {
    const w1 = step(createShooterWorld(["a", "b", "c"], 5));
    expect(w1.wave).toBe(1);
    expect(w1.partySize).toBe(3);
    expect(w1.pending.length + w1.enemies.length).toBe(
      // budget spent entirely on rushers at wave 1 (cost 1 each)
      waveBudget(1, 3),
    );
  });

  it("drains pending spawns gradually and increments spawnSeq", () => {
    const w1 = step(createShooterWorld(["a"], 5));
    const w2 = step(w1);
    expect(w2.enemies.length).toBeGreaterThan(w1.enemies.length);
    expect(w2.spawnSeq).toBe(w2.enemies.length);
    expect(w2.enemies.every((e, i) => e.id === `e${i}`)).toBe(true);
  });

  it("wave clear → intermission (+ wave-clear revive) → next wave with a re-frozen party", () => {
    let w = step(createShooterWorld(["a", "b"], 5));
    w = { ...w, pending: [], enemies: [], players: { ...w.players, b: { ...w.players.b!, status: "downed", health: 0 } } };
    const cleared = step(w);
    expect(cleared.intermission).toBeCloseTo(INTERMISSION_S, 5);
    expect(cleared.players.b!.status).toBe("alive"); // wave-clear auto-revive
    expect(cleared.players.b!.health).toBe(REVIVE_HEALTH);
    let next = cleared;
    for (let t = 0; t < Math.ceil(INTERMISSION_S / SHOOTER_DT) + 1; t++) next = step(next);
    expect(next.wave).toBe(2);
    expect(next.partySize).toBe(2);
  });
});

describe("combat + kills", () => {
  it("firing kills award xp/score/kill-stat to the shooter and roll drops", () => {
    let w = step(createShooterWorld(["a"], 7));
    w = { ...w, pending: [], enemies: [enemyAt("e0", w.players.a!.pos.x + 2, w.players.a!.pos.y, { health: 1 })] };
    const after = step(w, { a: { fire: true, aim: 0 } });
    expect(after.enemies).toEqual([]);
    expect(after.players.a!.stats.kills).toBe(1);
    expect(after.players.a!.xp).toBe(ENEMIES.rusher.xp);
    expect(after.score).toBe(ENEMIES.rusher.scoreValue * after.wave);
    expect(after.events.some((e) => e.kind === "kill")).toBe(true);
  });

  it("enemy contact damages on its attack interval and downs at 0 HP", () => {
    let w = step(createShooterWorld(["a"], 7));
    const p = w.players.a!;
    w = { ...w, pending: [], enemies: [enemyAt("e0", p.pos.x + 1.0, p.pos.y, { health: 1000 })] };
    const hit = step(w);
    expect(hit.players.a!.health).toBe(p.health - ENEMIES.rusher.damage);
    expect(hit.enemies[0]!.attackCooldown).toBeCloseTo(ENEMIES.rusher.attackInterval, 5);
    // surviving contact damage emits playerHit (not downed)
    expect(hit.events.some((e) => e.kind === "playerHit" && e.playerId === "a")).toBe(true);
    expect(hit.events.some((e) => e.kind === "downed")).toBe(false);
    // burn the player down → downed, not dead
    let burn = { ...w, players: { ...w.players, a: { ...p, health: ENEMIES.rusher.damage } } };
    const downed = step(burn);
    expect(downed.players.a!.status).toBe("downed");
    expect(downed.events.some((e) => e.kind === "downed")).toBe(true);
    // the downed case does NOT also emit playerHit (it has its own event)
    expect(downed.events.some((e) => e.kind === "playerHit")).toBe(false);
  });

  it("a stunned enemy in contact range cannot attack", () => {
    let w = step(createShooterWorld(["a"], 7));
    const p = w.players.a!;
    w = { ...w, pending: [], enemies: [enemyAt("e0", p.pos.x + 1.0, p.pos.y, { health: 1000, stunRemaining: 0.3 })] };
    const out = step(w);
    expect(out.players.a!.health).toBe(p.health); // no contact damage while stunned
    expect(out.events.some((e) => e.kind === "playerHit")).toBe(false);
    expect(out.events.some((e) => e.kind === "downed")).toBe(false);
  });
});

describe("wave-1 slowdown", () => {
  it("a wave-1 enemy covers 0.85x the distance of the same enemy at a later wave, per tick", () => {
    const base = createShooterWorld(["a"], 9);
    const p = base.players.a!;
    const enemy = enemyAt("e0", p.pos.x + 10, p.pos.y, { health: 1000 });
    const wave1 = stepShooter({ ...base, wave: 1, enemies: [enemy] }, intents(base), SHOOTER_DT);
    const wave2 = stepShooter({ ...base, wave: 2, enemies: [enemy] }, intents(base), SHOOTER_DT);
    const d1 = Math.abs(wave1.enemies[0]!.pos.x - enemy.pos.x);
    const d2 = Math.abs(wave2.enemies[0]!.pos.x - enemy.pos.x);
    expect(d1).toBeGreaterThan(0);
    expect(d1).toBeCloseTo(d2 * WAVE1_SPEED_MULT, 5);
  });
});

describe("downed / revive / wipe", () => {
  const setup = (): ShooterWorld => {
    let w = step(createShooterWorld(["a", "b"], 3));
    w = { ...w, pending: [], enemies: [enemyAt("far", 29, 29, { health: 1000 })] }; // keep the wave alive
    const a = w.players.a!;
    const b = w.players.b!;
    return { ...w, players: { ...w.players, a: { ...a, status: "downed" as const, health: 0, pos: { x: 10, y: 10 } }, b: { ...b, pos: { x: 11, y: 10 } } } };
  };

  it("teammate proximity accumulates revive progress to completion", () => {
    let w = setup();
    // +1: repeated `progress += SHOOTER_DT` accumulates to just under REVIVE_S
    // (2.999999999999999) by tick 90 due to floating-point summation error —
    // same fp-tolerance buffer the wave-clear test above already uses.
    const ticks = Math.ceil(REVIVE_S / SHOOTER_DT) + 1;
    for (let t = 0; t < ticks; t++) w = step(w);
    expect(w.players.a!.status).toBe("alive");
    expect(w.players.a!.health).toBe(REVIVE_HEALTH);
  });

  it("progress resets when the teammate walks away", () => {
    let w = setup();
    w = step(w);
    expect(w.players.a!.reviveProgress).toBeGreaterThan(0);
    w = { ...w, players: { ...w.players, b: { ...w.players.b!, pos: { x: 25, y: 25 } } } };
    w = step(w);
    expect(w.players.a!.reviveProgress).toBe(0);
  });

  it("all players downed → ended; a revive completing the same tick prevents the wipe", () => {
    // both downed → wipe
    let w = setup();
    w = { ...w, players: { ...w.players, b: { ...w.players.b!, status: "downed", health: 0 } } };
    expect(step(w).phase).toBe("ended");
    // b alive and reviving a: when b is downed on the SAME tick a's revive completes, no wipe
    let w2 = setup();
    w2 = { ...w2, players: { ...w2.players, a: { ...w2.players.a!, reviveProgress: REVIVE_S - SHOOTER_DT / 2 } } };
    const enemyOnB = enemyAt("kb", w2.players.b!.pos.x + 1, w2.players.b!.pos.y, { health: 1000 });
    w2 = { ...w2, enemies: [...w2.enemies, enemyOnB], players: { ...w2.players, b: { ...w2.players.b!, health: ENEMIES.rusher.damage } } };
    const out = step(w2);
    expect(out.players.a!.status).toBe("alive"); // revive landed
    expect(out.players.b!.status).toBe("downed");
    expect(out.phase).toBe("playing"); // revive-before-wipe
  });

  it("a frozen ended world stays frozen", () => {
    let w = setup();
    w = { ...w, players: { ...w.players, b: { ...w.players.b!, status: "downed", health: 0 } } };
    const ended = step(w);
    expect(step(ended)).toEqual(ended);
  });
});

describe("perks flow", () => {
  it("level-up enqueues a 3-choice offer; perkPick consumes the head", () => {
    let w = step(createShooterWorld(["a"], 11));
    const need = xpToNext(0);
    const kills = Math.ceil(need / ENEMIES.rusher.xp);
    const p = w.players.a!;
    // Spawn distance 15 (not 1.5): all `kills` enemies share one coordinate, so
    // they converge to the exact same contact distance on the exact same tick
    // and volley-fire in lockstep — at 1.5m that alpha strike (up to 45 dmg/tick)
    // downs the solo 100-HP player well before all 10 kills land. 15m keeps the
    // whole stack out of contact range (and within pistol range 20m) for the
    // ~64 ticks this test needs, isolating the perk-offer/pick flow under test.
    w = { ...w, pending: [], enemies: Array.from({ length: kills }, (_, i) => enemyAt(`k${i}`, p.pos.x + 15, p.pos.y, { health: 1 })) };
    // rifle-less: pistol kills them over several ticks
    for (let t = 0; t < 200 && w.players.a!.level === 0; t++) w = step(w, { a: { fire: true, aim: 0 } });
    expect(w.players.a!.level).toBe(1);
    expect(w.players.a!.offers.length).toBe(1);
    const choice = w.players.a!.offers[0]!.choices[2];
    const picked = step(w, { a: { perkPick: 2 } });
    expect(picked.players.a!.perks).toEqual([choice]);
    expect(picked.players.a!.offers).toEqual([]);
    // pick with no pending offer is a no-op
    expect(step(picked, { a: { perkPick: 0 } }).players.a!.perks).toEqual([choice]);
  });
});

describe("pickups", () => {
  it("medkits heal capped at max; weapon pickups swap with a fresh mag + swap guard; same-gun tops up reserve", () => {
    let w = step(createShooterWorld(["a"], 13));
    const p = w.players.a!;
    w = {
      ...w, pending: [], enemies: [enemyAt("far", 29, 29, { health: 1000 })],
      pickups: [{ id: "pk:1", kind: "medkit", pos: { x: p.pos.x, y: p.pos.y }, ttl: 5 }],
      players: { ...w.players, a: { ...p, health: 90 } },
    };
    let out = step(w);
    expect(out.players.a!.health).toBe(100); // capped
    expect(out.pickups).toEqual([]);
    // weapon swap
    out = { ...out, pickups: [{ id: "pk:2", kind: "rifle", pos: { x: p.pos.x, y: p.pos.y }, ttl: 5 }] };
    out = step(out);
    expect(out.players.a!.gun).toBe("rifle");
    expect(out.players.a!.ammo.mag).toBe(10);
    expect(out.players.a!.swapGuard).toBeGreaterThan(0);
    // guard blocks an immediate re-swap
    out = { ...out, pickups: [{ id: "pk:3", kind: "shotgun", pos: { x: p.pos.x, y: p.pos.y }, ttl: 5 }] };
    out = step(out);
    expect(out.players.a!.gun).toBe("rifle");
    expect(out.pickups.length).toBe(1);
    // same gun tops up reserve once the guard expires
    out = { ...out, pickups: [{ id: "pk:4", kind: "rifle", pos: { x: p.pos.x, y: p.pos.y }, ttl: 9 }], players: { ...out.players, a: { ...out.players.a!, swapGuard: 0, ammo: { ...out.players.a!.ammo, reserve: 3 } } } };
    out = step(out);
    expect(out.players.a!.ammo.reserve).toBe(60);
  });

  it("pickups expire by ttl", () => {
    let w = step(createShooterWorld(["a"], 13));
    w = { ...w, pending: [], enemies: [enemyAt("far", 29, 29, { health: 1000 })], pickups: [{ id: "pk:1", kind: "medkit", pos: { x: 1, y: 1 }, ttl: SHOOTER_DT / 2 }] };
    expect(step(w).pickups).toEqual([]);
  });
});
