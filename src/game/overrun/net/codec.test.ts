// src/game/overrun/net/codec.test.ts
import { describe, expect, it } from "vitest";
import { applyDelta, diffWorld, qWorld, unqWorld } from "./codec";
import { createShooterWorld } from "../match";
import { stepShooter } from "../sim";
import { SHOOTER_DT, MAX_ENEMIES, MAX_PICKUPS, MAX_EVENTS } from "../constants";
import type { ShooterIntent, ShooterWorld } from "../types";

const IDLE: ShooterIntent = { move: { up: false, down: false, left: false, right: false }, fire: false, reload: false, perkPick: null };
const idle = (w: ShooterWorld) => Object.fromEntries(Object.keys(w.players).map((id) => [id, IDLE]));

/** A worst-case world: 8 players, full enemy/pickup/event load. */
function fatWorld(): ShooterWorld {
  let w = createShooterWorld(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"], 777);
  w = stepShooter(w, idle(w), SHOOTER_DT);
  const enemies = Array.from({ length: MAX_ENEMIES }, (_, i) => ({
    id: `e${i}`, kind: i % 4 === 0 ? ("tank" as const) : ("rusher" as const),
    pos: { x: (i % 30) + 0.123, y: Math.floor(i / 3) + 0.456 }, health: 20 + i, attackCooldown: 0.25,
  }));
  const pickups = Array.from({ length: MAX_PICKUPS }, (_, i) => ({
    id: `pk:e${i}`, kind: (["shotgun", "rifle", "medkit"] as const)[i % 3]!,
    pos: { x: i + 0.5, y: i + 0.25 }, ttl: 7.5,
  }));
  const events = Array.from({ length: MAX_EVENTS }, (_, i) => ({
    tick: w.tick, kind: "shot" as const, gun: "rifle" as const,
    from: { x: 1.11, y: 2.22 }, to: { x: 20.5, y: 15.25 },
  }));
  return { ...w, enemies, pickups, events, wave: 12, score: 34567, pity: 7, spawnSeq: 480 };
}

describe("quantized round-trip", () => {
  it("unq(q(w)) preserves structure within quantization error and is idempotent", () => {
    const w = fatWorld();
    const r = unqWorld(qWorld(w));
    expect(Object.keys(r.players)).toEqual(Object.keys(w.players));
    expect(r.enemies.length).toBe(w.enemies.length);
    expect(r.enemies[3]!.pos.x).toBeCloseTo(w.enemies[3]!.pos.x, 2); // cm precision
    expect(r.players.p1!.aim).toBeCloseTo(w.players.p1!.aim, 2);
    expect(r).toMatchObject({ tick: w.tick, seed: w.seed, wave: 12, score: 34567, pity: 7, spawnSeq: 480, partySize: w.partySize, phase: w.phase });
    expect(r.pending).toEqual(w.pending);
    // idempotent: quantizing an already-quantized world is lossless
    expect(unqWorld(qWorld(r))).toEqual(r);
  });

  it("preserves perks/offers/stats/ammo exactly (migration needs them)", () => {
    const w = fatWorld();
    w.players.p1 = {
      ...w.players.p1!, gun: "rifle", perks: ["power", "magnet"],
      offers: [{ choices: ["trigger", "hands", "sprint"] }],
      stats: { shots: 440, hits: 343, kills: 342 }, xp: 17, level: 9,
      ammo: { mag: 7, reserve: 41, reloadRemaining: 0.8, fireCooldown: 0.1 },
    };
    const r = unqWorld(qWorld(w));
    expect(r.players.p1!).toMatchObject({
      gun: "rifle", perks: ["power", "magnet"],
      offers: [{ choices: ["trigger", "hands", "sprint"] }],
      stats: { shots: 440, hits: 343, kills: 342 }, xp: 17, level: 9,
    });
    expect(r.players.p1!.ammo.mag).toBe(7);
    expect(r.players.p1!.ammo.reloadRemaining).toBeCloseTo(0.8, 2);
  });
});

describe("delta encode/apply", () => {
  it("apply(prev, diff(prev, cur)) reproduces the quantized current world exactly", () => {
    let w = createShooterWorld(["a", "b"], 42);
    for (let t = 0; t < 30; t++) w = stepShooter(w, idle(w), SHOOTER_DT);
    const prev = unqWorld(qWorld(w));
    let cur = w;
    for (let t = 0; t < 3; t++) cur = stepShooter(cur, idle(cur), SHOOTER_DT);
    const rebuilt = applyDelta(prev, diffWorld(qWorld(w), qWorld(cur)));
    expect(rebuilt).toEqual(unqWorld(qWorld(cur)));
  });

  it("handles enemy adds, removals, and pickup changes", () => {
    const prev = unqWorld(qWorld(fatWorld()));
    const cur: ShooterWorld = {
      ...prev, tick: prev.tick + 3,
      enemies: [...prev.enemies.slice(2), { id: "e999", kind: "tank", pos: { x: 1, y: 2 }, health: 120, attackCooldown: 0 }],
      pickups: prev.pickups.slice(1),
    };
    const rebuilt = applyDelta(prev, diffWorld(qWorld(prev), qWorld(cur)));
    expect(rebuilt).toEqual(unqWorld(qWorld(cur)));
  });

  it("a delta against the wrong base is ignored (wait for the next keyframe)", () => {
    const prev = unqWorld(qWorld(fatWorld()));
    const cur = { ...prev, tick: prev.tick + 3, score: prev.score + 100 };
    const d = diffWorld(qWorld(prev), qWorld(cur));
    const stale = { ...prev, tick: prev.tick - 3 };
    expect(applyDelta(stale, d)).toBe(stale);
  });
});

describe("byte budget (the P-A0 guarantee)", () => {
  it("worst-case keyframe ≤ 6144 bytes; worst-case delta ≤ 4096", () => {
    // Worst case = every cap maxed simultaneously. Steady-state real traffic is far
    // smaller; this pins the ceiling so cap changes that blow the wire fail loudly.
    const w = fatWorld();
    const key = JSON.stringify({ v: 1, m: { t: "oSnap", w: qWorld(w) } });
    expect(key.length).toBeLessThanOrEqual(6144);
    let cur = w;
    for (let t = 0; t < 3; t++) cur = stepShooter(cur, idle(cur), SHOOTER_DT);
    const delta = JSON.stringify({ v: 1, m: { t: "oDelta", d: diffWorld(qWorld(w), qWorld(cur)) } });
    expect(delta.length).toBeLessThanOrEqual(4096);
  });
});
