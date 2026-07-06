import { describe, expect, it } from "vitest";
import { inAttackCone, inAttackLine, resolveAttack } from "./combat";
import { initialDash } from "./dash";
import { directionAngle } from "./logic";
import type { Weapon } from "./weapons";
import { SWORD_REACH_M, ATTACK_CONE_HALF_ANGLE, KNOCKBACK_M } from "../constants";
import type { Direction, PlayerState, Vec2 } from "./types";

function player(
  id: string,
  pos: Vec2,
  facing: Direction = "right",
  status: PlayerState["status"] = "alive",
  weapon: Weapon = "sword",
): PlayerState {
  return { id, pos, facing, aim: directionAngle(facing), weapon, health: 3, status, dash: initialDash(), attack: null, attackCooldownRemaining: 0 };
}

// Combat is now driven by a free aim ANGLE (radians), not a 4-way facing.
const cone = (origin: Vec2, dir: Direction, target: Vec2) =>
  inAttackCone(origin, directionAngle(dir), target, SWORD_REACH_M, ATTACK_CONE_HALF_ANGLE);

describe("inAttackCone", () => {
  it("hits a target directly in front within reach", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: 1, y: 0 })).toBe(true);
  });

  it("reaches the length of the sword image (~1.8 m hits; the old 1 m range would miss)", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: 1.8, y: 0 })).toBe(true);
  });

  it("misses a target just beyond the sword reach", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: SWORD_REACH_M + 0.1, y: 0 })).toBe(false);
  });

  it("misses a target directly behind", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: -1, y: 0 })).toBe(false);
  });

  it("misses a target perpendicular (outside the 90° cone)", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: 0, y: 0.9 })).toBe(false);
  });

  it("hits a target on the cone edge (45°) within reach", () => {
    expect(cone({ x: 0, y: 0 }, "right", { x: 0.6, y: 0.6 })).toBe(true);
  });

  it("hits up/down symmetrically (sim is direction-agnostic in world space)", () => {
    expect(cone({ x: 0, y: 0 }, "up", { x: 0, y: -1.5 })).toBe(true); // target above, facing up
    expect(cone({ x: 0, y: 0 }, "down", { x: 0, y: 1.5 })).toBe(true); // target below, facing down
    expect(cone({ x: 0, y: 0 }, "up", { x: 0, y: 1.5 })).toBe(false); // target below, facing up → miss
  });

  it("aims freely at any angle, not just the 4 cardinals (mouse aim)", () => {
    const half = ATTACK_CONE_HALF_ANGLE;
    // aim down-right (45°): a down-right target is dead-center → hit
    expect(inAttackCone({ x: 0, y: 0 }, Math.PI / 4, { x: 1, y: 1 }, SWORD_REACH_M, half)).toBe(true);
    // same aim, but an up-right target is 90° off the aim → outside the cone → miss
    expect(inAttackCone({ x: 0, y: 0 }, Math.PI / 4, { x: 1, y: -1 }, SWORD_REACH_M, half)).toBe(false);
  });
});

describe("inAttackLine (straight thrust — e.g. spear)", () => {
  const line = (origin: Vec2, target: Vec2, reach = 3, halfWidth = 0.5) =>
    inAttackLine(origin, 0, target, reach, halfWidth); // aim = 0 (straight right)

  it("hits a target straight ahead within reach", () => {
    expect(line({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });

  it("misses a target beyond reach", () => {
    expect(line({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it("misses a target off to the side (unlike a cone, the band does not widen with distance)", () => {
    expect(line({ x: 0, y: 0 }, { x: 2, y: 1 })).toBe(false); // 1 m off the line > halfWidth
    expect(line({ x: 0, y: 0 }, { x: 2, y: 0.4 })).toBe(true); // within the narrow band
  });

  it("misses a target behind", () => {
    expect(line({ x: 0, y: 0 }, { x: -2, y: 0 })).toBe(false);
  });
});

describe("weapon hit shapes", () => {
  it("a spear thrusts in a straight line — misses a 45° target that a sword's cone would hit", () => {
    const at = { x: 0, y: 0 };
    const off = player("T", { x: 1, y: 1 }); // 45° off the aim, ~1.41 m away
    const sword = player("S", at, "right", "alive", "sword");
    const spear = player("P", at, "right", "alive", "spear");
    expect(resolveAttack(sword, [sword, off]).length).toBe(1); // cone catches the 45° target
    expect(resolveAttack(spear, [spear, off]).length).toBe(0); // straight thrust does not
  });

  it("a spear still hits a target directly ahead at its longer reach", () => {
    const spear = player("P", { x: 0, y: 0 }, "right", "alive", "spear");
    const ahead = player("T", { x: 3, y: 0 }); // 3 m ahead — inside the spear's reach
    expect(resolveAttack(spear, [spear, ahead]).length).toBe(1);
  });
});

describe("knockback distance", () => {
  it("is the sword reach + 1 m", () => {
    expect(KNOCKBACK_M).toBe(SWORD_REACH_M + 1);
  });
});

describe("resolveAttack", () => {
  it("emits a damage event for each alive target in the cone, skipping self/dead/out-of-range", () => {
    const attacker = player("A", { x: 0, y: 0 }, "right");
    const targets = [
      player("B", { x: 0.5, y: 0 }), // in front, in range → hit
      player("C", { x: -1, y: 0 }), // behind → miss
      player("D", { x: 0.5, y: 0 }, "right", "dead"), // dead → skip
      player("E", { x: 5, y: 0 }), // far → miss
    ];
    const events = resolveAttack(attacker, [attacker, ...targets]);
    expect(events).toEqual([{ fromId: "A", targetId: "B" }]);
  });

  it("damages every target inside the cone (one swing, multiple hits)", () => {
    const attacker = player("A", { x: 0, y: 0 }, "right");
    const targets = [player("B", { x: 0.5, y: 0 }), player("C", { x: 0.7, y: 0.2 })];
    const events = resolveAttack(attacker, [attacker, ...targets]);
    expect(events.map((e) => e.targetId).sort()).toEqual(["B", "C"]);
  });

  it("hits the whole body, not just the center (reach + figure radius)", () => {
    const attacker = player("A", { x: 0, y: 0 }, "right");
    // center is just past the 2 m blade, but the body extends into reach → hit
    const grazed = player("B", { x: 2.5, y: 0 });
    expect(resolveAttack(attacker, [attacker, grazed]).length).toBe(1);
    // fully past reach + body radius → miss
    const clear = player("C", { x: 3, y: 0 });
    expect(resolveAttack(attacker, [attacker, clear]).length).toBe(0);
  });
});
