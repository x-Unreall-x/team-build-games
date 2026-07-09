// src/game/squid/sim.test.ts
import { describe, expect, it } from "vitest";
import { createSquidWorld, timeMsOf } from "./match";
import { stepSquid } from "./sim";
import { HEAD } from "./octopus";
import { FINISH_X_M, HEAD_DROP_FAIL_M, LEG_COUNT } from "./constants";
import type { SquidIntent, SquidWorld } from "./types";

const DT = 1 / 20;
const idle: SquidIntent = { swing: 0, lift: false, cycle: false };

/** Step n ticks with the same intents. */
const run = (w: SquidWorld, intents: Record<string, SquidIntent>, n: number): SquidWorld => {
  for (let i = 0; i < n; i++) w = stepSquid(w, intents, DT);
  return w;
};

describe("stepSquid — determinism & lifecycle", () => {
  it("is deterministic: identical runs produce deep-equal worlds", () => {
    const intents = { A: { ...idle, cycle: true } };
    const a = run(createSquidWorld("stage1", ["A"]), intents, 40);
    const b = run(createSquidWorld("stage1", ["A"]), intents, 40);
    expect(a).toEqual(b);
  });

  it("counts elapsed ticks so timeMsOf is exact", () => {
    const w = run(createSquidWorld("stage1", ["A"]), {}, 20);
    expect(w.elapsedTicks).toBe(20);
    expect(timeMsOf(w)).toBe(1000);
  });

  it("stands stable when idle (planted legs support the head)", () => {
    const w0 = createSquidWorld("stage1", ["A"]);
    const w = run(w0, { A: idle }, 60);
    expect(w.points[HEAD]!.pos.y).toBeGreaterThan(0.4);
    expect(w.result).toBeNull();
  });
});

describe("stepSquid — leg selection", () => {
  it("cycle claims a leg; grab claims a specific unheld leg", () => {
    let w = createSquidWorld("stage1", ["A", "B"]);
    w = stepSquid(w, { A: { ...idle, cycle: true }, B: { ...idle, grabLeg: 5 } }, DT);
    expect(w.control[0]).toBe("A");
    expect(w.control[5]).toBe("B");
  });

  it("resolves a grab conflict deterministically (lower sorted id wins)", () => {
    let w = createSquidWorld("stage1", ["B", "A"]);
    w = stepSquid(w, { A: { ...idle, grabLeg: 2 }, B: { ...idle, grabLeg: 2 } }, DT);
    expect(w.control[2]).toBe("A");
  });
});

describe("stepSquid — locomotion (the core mechanic)", () => {
  /** All 8 legs held by 8 players, swinging forward while planted. */
  const swarm = (swing: 1 | -1): { ids: string[]; intents: Record<string, SquidIntent> } => {
    const ids = Array.from({ length: LEG_COUNT }, (_, i) => `P${i}`);
    const intents: Record<string, SquidIntent> = {};
    for (let i = 0; i < LEG_COUNT; i++) intents[`P${i}`] = { ...idle, grabLeg: i, swing };
    return { ids, intents };
  };

  it("swinging planted legs propels the body forward", () => {
    const { ids, intents } = swarm(1);
    const w0 = createSquidWorld("stage1", ids);
    const x0 = w0.points[HEAD]!.pos.x;
    const w = run(w0, intents, 40); // 2 s of forward swing
    expect(w.points[HEAD]!.pos.x).toBeGreaterThan(x0 + 0.3);
  });

  it("swinging a LIFTED leg moves its tip but barely moves the body", () => {
    let w = createSquidWorld("stage1", ["A"]);
    const intents = { A: { ...idle, grabLeg: 0, lift: true, swing: 1 as const } };
    const x0 = w.points[HEAD]!.pos.x;
    const tip0 = w.points[w.legs[0]!.pts[2]]!.pos.x;
    w = run(w, intents, 20);
    expect(w.points[w.legs[0]!.pts[2]]!.pos.x).toBeGreaterThan(tip0 + 0.2);
    expect(Math.abs(w.points[HEAD]!.pos.x - x0)).toBeLessThan(0.15);
  });

  it("lifting all legs makes the body sag toward the ground", () => {
    const ids = Array.from({ length: LEG_COUNT }, (_, i) => `P${i}`);
    const intents: Record<string, SquidIntent> = {};
    for (let i = 0; i < LEG_COUNT; i++) intents[`P${i}`] = { ...idle, grabLeg: i, lift: true };
    const w0 = createSquidWorld("stage1", ids);
    const y0 = w0.points[HEAD]!.pos.y;
    const w = run(w0, intents, 30);
    expect(w.points[HEAD]!.pos.y).toBeLessThan(y0 - 0.2);
  });

  it("a lifted leg stays attached to the body (no spaghetti drift)", () => {
    let w = createSquidWorld("stage1", ["A", "B"]);
    const intents = {
      A: { swing: 1 as const, lift: true, cycle: false, grabLeg: 0 },
      B: { swing: 0 as const, lift: false, cycle: false, grabLeg: 4 },
    };
    for (let i = 0; i < 60; i++) w = stepSquid(w, intents, 1 / 20); // 3 s of lifted swing
    const head = w.points[HEAD]!.pos;
    for (const pi of w.legs[0]!.pts) {
      const p = w.points[pi]!.pos;
      // full chain is 3 × LEG_SEGMENT_M ≈ 1.35 m; allow modest solver slack
      expect(Math.hypot(p.x - head.x, p.y - head.y)).toBeLessThan(2);
    }
  });
});

describe("stepSquid — fail & finish", () => {
  /** Teleport the rig so the head sits over the given x (test helper — sim never does this). */
  const rigAt = (w: SquidWorld, x: number): SquidWorld => {
    const dx = x - w.points[HEAD]!.pos.x;
    return {
      ...w,
      points: w.points.map((p) => ({
        pos: { x: p.pos.x + dx, y: p.pos.y },
        prev: { x: p.prev.x + dx, y: p.prev.y },
      })),
    };
  };

  it("stage2: head over the hole with no planted support falls in ⇒ failed", () => {
    let w = rigAt(createSquidWorld("stage2", ["A"]), 3.25);
    // unplant everything so nothing holds the body up over the gap
    w = { ...w, legs: w.legs.map((l) => ({ ...l, planted: false, lifted: true })) };
    w = run(w, {}, 60); // gravity does the rest
    expect(w.result).toBe("failed");
    expect(w.phase).toBe("ended");
    expect(w.points[HEAD]!.pos.y).toBeLessThan(-HEAD_DROP_FAIL_M);
  });

  it("stage1 has no fail state: the same sag just rests on the ground", () => {
    let w = rigAt(createSquidWorld("stage1", ["A"]), 3.25);
    w = { ...w, legs: w.legs.map((l) => ({ ...l, planted: false, lifted: true })) };
    w = run(w, {}, 60);
    expect(w.result).toBeNull();
  });

  it("head crossing the finish arch ends the round with the exact time", () => {
    let w = rigAt(createSquidWorld("stage1", ["A"]), FINISH_X_M - 0.05);
    w = { ...w, elapsedTicks: 100 };
    // nudge the head over the line
    const pts = w.points.map((p, i) =>
      i === HEAD ? { pos: { x: FINISH_X_M + 0.01, y: p.pos.y }, prev: p.prev } : p,
    );
    w = stepSquid({ ...w, points: pts }, {}, DT);
    expect(w.result).toBe("finished");
    expect(w.phase).toBe("ended");
    expect(timeMsOf(w)).toBe(Math.round(((100 + 1) / 20) * 1000));
  });

  it("an ended world is frozen", () => {
    let w = createSquidWorld("stage1", ["A"]);
    w = { ...w, phase: "ended", result: "finished" };
    expect(stepSquid(w, { A: { ...idle, swing: 1 } }, DT)).toBe(w);
  });
});
