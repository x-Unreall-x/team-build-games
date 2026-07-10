import { describe, expect, it } from "vitest";
import { ENEMIES, ENEMY_KINDS, nearestAlive, stepEnemy } from "./enemies";
import { createShooterWorld, alivePlayers } from "./match";
import type { Enemy } from "./types";

const enemy = (over: Partial<Enemy> = {}): Enemy => ({ id: "e0", kind: "rusher", pos: { x: 5, y: 5 }, health: 20, attackCooldown: 0, stunRemaining: 0, ...over });

describe("enemy defs", () => {
  it("defines rusher (fast/fragile) and tank (slow/beefy) with wave gating", () => {
    expect(ENEMY_KINDS).toEqual(["rusher", "tank"]);
    expect(ENEMIES.rusher).toMatchObject({ radius: 0.4, speed: 4.5, health: 20, damage: 5, attackInterval: 0.5, xp: 2, cost: 1, scoreValue: 10, minWave: 1 });
    expect(ENEMIES.tank).toMatchObject({ radius: 0.9, speed: 1.8, health: 120, damage: 20, attackInterval: 0.8, xp: 8, cost: 4, scoreValue: 40, minWave: 3 });
  });
});

describe("nearestAlive", () => {
  it("chases the closest living player; equal distances break to the lowest id", () => {
    const w = createShooterWorld(["a", "b"], 1);
    w.players.a = { ...w.players.a!, pos: { x: 10, y: 15 } };
    w.players.b = { ...w.players.b!, pos: { x: 20, y: 15 } };
    const sorted = alivePlayers(w).sort((p, q) => (p.id < q.id ? -1 : 1));
    expect(nearestAlive({ x: 12, y: 15 }, sorted)?.id).toBe("a");
    expect(nearestAlive({ x: 15, y: 15 }, sorted)?.id).toBe("a"); // tie → lowest id
    expect(nearestAlive({ x: 5, y: 5 }, [])).toBe(null);
  });
});

describe("stepEnemy", () => {
  it("moves toward the target at kind speed", () => {
    const e = stepEnemy(enemy(), { x: 15, y: 5 }, 0.1);
    expect(e.pos.x).toBeCloseTo(5.45, 5); // 4.5 m/s × 0.1 s
    expect(e.pos.y).toBeCloseTo(5, 5);
  });

  it("stops at contact range instead of overlapping the player", () => {
    const e = stepEnemy(enemy({ pos: { x: 14, y: 5 } }), { x: 15, y: 5 }, 1);
    // rusher radius 0.4 + player 0.75 = 1.15 contact distance
    expect(15 - e.pos.x).toBeCloseTo(1.15, 5);
  });

  it("ticks down the attack cooldown and idles with no target", () => {
    const e = stepEnemy(enemy({ attackCooldown: 0.5 }), null, 0.1);
    expect(e.attackCooldown).toBeCloseTo(0.4, 5);
    expect(e.pos).toEqual({ x: 5, y: 5 });
  });

  it("scales speed by the optional speedMult (wave-1 slowdown)", () => {
    const full = stepEnemy(enemy(), { x: 15, y: 5 }, 0.1);
    const slowed = stepEnemy(enemy(), { x: 15, y: 5 }, 0.1, 0.85);
    expect(slowed.pos.x - 5).toBeCloseTo((full.pos.x - 5) * 0.85, 5);
  });

  it("a stunned enemy does not move but still ticks stunRemaining and attackCooldown down", () => {
    const e = stepEnemy(enemy({ attackCooldown: 0.5, stunRemaining: 0.3 }), { x: 15, y: 5 }, 0.1);
    expect(e.pos).toEqual({ x: 5, y: 5 }); // no movement while stunned
    expect(e.stunRemaining).toBeCloseTo(0.2, 5);
    expect(e.attackCooldown).toBeCloseTo(0.4, 5); // cooldown still ticks while stunned
  });

  it("stunRemaining floors at 0 and never goes negative", () => {
    const e = stepEnemy(enemy({ stunRemaining: 0.05 }), { x: 15, y: 5 }, 0.1);
    expect(e.stunRemaining).toBe(0);
  });
});
