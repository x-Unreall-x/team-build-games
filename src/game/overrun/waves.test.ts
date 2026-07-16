import { describe, expect, it } from "vitest";
import { composeWave, MAX_PENDING, spawnPos, waveBudget } from "./waves";
import { ENEMIES } from "./enemies";
import { OVERRUN_FIELD_M } from "./constants";

describe("waveBudget", () => {
  it("escalates with the wave and scales with party size", () => {
    expect(waveBudget(1, 1)).toBe(10);   // (6+4)×1.0
    expect(waveBudget(1, 8)).toBe(45);   // (6+4)×4.5
    expect(waveBudget(5, 1)).toBe(26);   // (6+20)×1.0
    expect(waveBudget(2, 4)).toBeGreaterThan(waveBudget(2, 1));
    expect(waveBudget(3, 2)).toBeGreaterThan(waveBudget(2, 2));
  });
});

describe("composeWave", () => {
  it("spends the whole budget and is deterministic", () => {
    const q = composeWave(42, 4, 3);
    const cost = q.reduce((s, k) => s + ENEMIES[k].cost, 0);
    expect(cost).toBe(waveBudget(4, 3));
    expect(composeWave(42, 4, 3)).toEqual(q);
    expect(composeWave(43, 4, 3)).not.toEqual(q);
  });

  it("never schedules tanks before their minWave", () => {
    for (let w = 1; w < 3; w++) {
      expect(composeWave(7, w, 8).every((k) => k === "rusher")).toBe(true);
    }
  });

  it("mixes tanks in from wave 3 (probabilistically, over several seeds)", () => {
    const kinds = new Set([1, 2, 3, 4, 5].flatMap((seed) => composeWave(seed, 6, 4)));
    expect(kinds.has("tank")).toBe(true);
  });

  it("under the MAX_PENDING cap, behavior is unchanged: spends the whole budget", () => {
    const q = composeWave(42, 4, 3);
    expect(q.length).toBeLessThan(MAX_PENDING);
    const cost = q.reduce((s, k) => s + ENEMIES[k].cost, 0);
    expect(cost).toBe(waveBudget(4, 3));
  });

  it("endless-run guard: a huge budget (wave 50, 8 players) is capped at exactly MAX_PENDING", () => {
    expect(waveBudget(50, 8)).toBeGreaterThan(MAX_PENDING * ENEMIES.tank.cost); // budget dwarfs the cap even in tank-cost terms
    const q = composeWave(42, 50, 8);
    expect(q.length).toBe(MAX_PENDING);
  });
});

describe("spawnPos", () => {
  it("always lands exactly on the field perimeter, deterministically", () => {
    for (let s = 0; s < 200; s++) {
      const p = spawnPos(9, s);
      const onEdge =
        p.x === 0 || p.x === OVERRUN_FIELD_M || p.y === 0 || p.y === OVERRUN_FIELD_M;
      expect(onEdge).toBe(true);
      expect(spawnPos(9, s)).toEqual(p);
    }
  });

  it("spreads spawns around all four edges", () => {
    const edges = new Set<string>();
    for (let s = 0; s < 100; s++) {
      const p = spawnPos(3, s);
      if (p.y === 0) edges.add("top");
      else if (p.y === OVERRUN_FIELD_M) edges.add("bottom");
      else if (p.x === 0) edges.add("left");
      else edges.add("right");
    }
    expect(edges.size).toBe(4);
  });
});

describe("composeWave — campaign stage gating", () => {
  it("stage 1 waves 1-2 are rushers only; wave 3 admits tanks", () => {
    expect(composeWave(7, 1, 8, { campaign: true }).every((k) => k === "rusher")).toBe(true);
    expect(composeWave(7, 2, 8, { campaign: true }).every((k) => k === "rusher")).toBe(true);
    expect(composeWave(7, 3, 8, { campaign: true })).toContain("tank"); // stage 1 wave 3
  });

  it("survival is unchanged by the campaign flag (tanks gated by minWave only)", () => {
    expect(composeWave(7, 1, 8).every((k) => k === "rusher")).toBe(true); // wave 1 < tank.minWave
    expect(composeWave(7, 2, 8).every((k) => k === "rusher")).toBe(true);
  });
});
