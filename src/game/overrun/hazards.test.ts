import { describe, expect, it } from "vitest";
import { stepHazard, hazardActive } from "./hazards";
import type { Hazard } from "./types";

const hz = (over: Partial<Hazard> = {}): Hazard => ({
  id: "hz0", kind: "spit", pos: { x: 5, y: 5 }, radius: 2,
  telegraph: 0.8, duration: 2.5, dps: 22, ...over,
});

describe("hazardActive", () => {
  it("is inert while telegraphing, dangerous once the warning elapses", () => {
    expect(hazardActive(hz({ telegraph: 0.8 }))).toBe(false);
    expect(hazardActive(hz({ telegraph: 0 }))).toBe(true);
  });
});

describe("stepHazard", () => {
  it("counts the telegraph down first, without touching the active duration", () => {
    const h = stepHazard(hz({ telegraph: 0.8, duration: 2.5 }), 0.5)!;
    expect(h.telegraph).toBeCloseTo(0.3, 5);
    expect(h.duration).toBeCloseTo(2.5, 5); // duration only burns while active
    expect(hazardActive(h)).toBe(false);
  });

  it("floors the telegraph at 0 (goes active) without over-spending dt into the duration", () => {
    const h = stepHazard(hz({ telegraph: 0.2, duration: 2.5 }), 0.5)!;
    expect(h.telegraph).toBe(0);
    expect(h.duration).toBeCloseTo(2.5, 5); // the 0.3s overshoot is NOT charged to duration
    expect(hazardActive(h)).toBe(true);
  });

  it("burns the active duration down once telegraphing is done", () => {
    const h = stepHazard(hz({ telegraph: 0, duration: 2.5 }), 0.5)!;
    expect(h.telegraph).toBe(0);
    expect(h.duration).toBeCloseTo(2.0, 5);
  });

  it("returns null when the active duration is spent (hazard removed)", () => {
    expect(stepHazard(hz({ telegraph: 0, duration: 0.3 }), 0.5)).toBe(null);
  });
});
