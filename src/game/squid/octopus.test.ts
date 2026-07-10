import { describe, expect, it } from "vitest";
import { buildLegs, buildPoints, HEAD, POINT_COUNT, RIG_CONSTRAINTS } from "./octopus";
import { BODY_HEIGHT_M, HEAD_START_X_M, LEG_COUNT, LEG_SEGMENT_M } from "./constants";

describe("octopus rig", () => {
  it("has a head hub plus 3 points per leg", () => {
    expect(buildPoints()).toHaveLength(POINT_COUNT);
    expect(POINT_COUNT).toBe(1 + LEG_COUNT * 3);
  });

  it("spawns the head at the start position, at rest", () => {
    const head = buildPoints()[HEAD]!;
    expect(head.pos).toEqual({ x: HEAD_START_X_M, y: BODY_HEIGHT_M });
    expect(head.prev).toEqual(head.pos);
  });

  it("gives every leg 3 valid, unique point indices with grounded planted tips", () => {
    const legs = buildLegs();
    const pts = buildPoints();
    expect(legs).toHaveLength(LEG_COUNT);
    const seen = new Set<number>();
    for (const leg of legs) {
      for (const i of leg.pts) {
        expect(i).toBeGreaterThan(HEAD);
        expect(i).toBeLessThan(POINT_COUNT);
        expect(seen.has(i)).toBe(false);
        seen.add(i);
      }
      expect(leg.planted).toBe(true);
      expect(leg.lifted).toBe(false);
      expect(pts[leg.pts[2]]!.pos.y).toBe(0); // tip starts on the ground
    }
  });

  it("chains constraints head→root→mid→tip per leg at segment length", () => {
    expect(RIG_CONSTRAINTS).toHaveLength(LEG_COUNT * 3);
    for (const c of RIG_CONSTRAINTS) expect(c.len).toBe(LEG_SEGMENT_M);
    const headCons = RIG_CONSTRAINTS.filter((c) => c.a === HEAD);
    expect(headCons).toHaveLength(LEG_COUNT);
  });

  it("fans the tips across the head so the stance is stable (some ahead, some behind)", () => {
    const pts = buildPoints();
    const tips = buildLegs().map((l) => pts[l.pts[2]]!.pos.x);
    expect(Math.min(...tips)).toBeLessThan(HEAD_START_X_M);
    expect(Math.max(...tips)).toBeGreaterThan(HEAD_START_X_M);
  });
});
