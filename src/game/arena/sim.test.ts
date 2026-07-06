import { describe, expect, it } from "vitest";
import { stepWorld } from "./sim";
import { createWorld } from "./match";
import { dashCooldownFraction } from "./dash";
import {
  ATTACK_COOLDOWN_S,
  ATTACK_TTL_S,
  DASH_COOLDOWN_S,
  DASH_DIST_M,
  FIELD_M,
  FIGURE_RADIUS_M,
  KNOCKBACK_M,
  RUN_SPEED_MS,
  START_HEALTH,
} from "../constants";
import type { Intent, InputState } from "./types";

const NONE: InputState = { up: false, down: false, left: false, right: false };
const idle = (facing: Intent["facing"] = "down"): Intent => ({ move: NONE, facing, dash: false, attack: false });
const moveRight: Intent = { move: { ...NONE, right: true }, facing: "right", dash: false, attack: false };

describe("stepWorld — movement", () => {
  it("moves a player at run speed in the input direction", () => {
    const w = createWorld([{ id: "A", pos: { x: 15, y: 15 } }]);
    const next = stepWorld(w, { A: moveRight }, 0.1);
    expect(next.players.A.pos.x).toBeCloseTo(15 + RUN_SPEED_MS * 0.1, 5);
    expect(next.players.A.pos.y).toBeCloseTo(15, 5);
    expect(next.tick).toBe(1);
  });

  it("leaves a player with no intent where they are", () => {
    const w = createWorld([{ id: "A", pos: { x: 5, y: 6 } }]);
    const next = stepWorld(w, {}, 0.1);
    expect(next.players.A.pos).toEqual({ x: 5, y: 6 });
  });

  it("does not simulate unless the phase is 'playing'", () => {
    const w = createWorld([{ id: "A", pos: { x: 5, y: 5 } }], "countdown");
    expect(stepWorld(w, { A: moveRight }, 0.1)).toBe(w);
  });
});

describe("stepWorld — dash", () => {
  it("moves at dash speed and puts dash on cooldown", () => {
    const w = createWorld([{ id: "A", pos: { x: 10, y: 15 } }]);
    const dashRight: Intent = { ...moveRight, dash: true };
    const next = stepWorld(w, { A: dashRight }, 0.1);
    // 4× run speed over 0.1s = 1.6m (< the 2m burst)
    expect(next.players.A.pos.x).toBeCloseTo(10 + RUN_SPEED_MS * 4 * 0.1, 5);
    expect(next.players.A.dash.dashing).toBe(true);
    expect(next.players.A.dash.cooldownRemaining).toBe(DASH_COOLDOWN_S);
  });

  // A second, far-away idle player keeps the match in "playing" (a 1-player world ends instantly).
  const BYSTANDER = { id: "Z", pos: { x: 1, y: 1 } };

  // run a dash to completion and return total distance travelled
  function totalDashTravel(dt: number): number {
    let w = createWorld([{ id: "A", pos: { x: 5, y: 15 } }, BYSTANDER]);
    w = stepWorld(w, { A: { ...moveRight, dash: true } }, dt);
    let guard = 0;
    while (w.players.A.dash.dashing && guard++ < 1000) {
      w = stepWorld(w, { A: moveRight }, dt);
    }
    return w.players.A.pos.x - 5;
  }

  it("travels exactly the 2m burst, independent of dt", () => {
    expect(totalDashTravel(0.1)).toBeCloseTo(DASH_DIST_M, 5);
    expect(totalDashTravel(0.05)).toBeCloseTo(DASH_DIST_M, 5);
    expect(totalDashTravel(1 / 60)).toBeCloseTo(DASH_DIST_M, 5);
  });

  it("ends the dash when blocked by a wall (no permanent dashing / 4x speed)", () => {
    let w = createWorld([
      { id: "A", pos: { x: FIELD_M - FIGURE_RADIUS_M - 0.5, y: 15 } },
      BYSTANDER,
    ]);
    w = stepWorld(w, { A: { ...moveRight, dash: true } }, 0.1);
    let guard = 0;
    while (w.players.A.dash.dashing && guard++ < 100) {
      w = stepWorld(w, { A: moveRight }, 0.1);
    }
    expect(w.players.A.dash.dashing).toBe(false); // terminated, not frozen
    expect(guard).toBeLessThan(100);
    expect(w.players.A.pos.x).toBeCloseTo(FIELD_M - FIGURE_RADIUS_M, 5); // pinned at wall
  });

  it("recharges over the cooldown and allows a second dash", () => {
    let w = createWorld([{ id: "A", pos: { x: 15, y: 15 } }, BYSTANDER]);
    w = stepWorld(w, { A: { ...moveRight, dash: true } }, 0.1);
    // idle long enough to recharge (one big dt past the cooldown)
    w = stepWorld(w, {}, DASH_COOLDOWN_S + 1);
    expect(w.players.A.dash.cooldownRemaining).toBe(0);
    expect(dashCooldownFraction(w.players.A.dash)).toBe(1);
    // a fresh dash edge starts a new burst
    const after = stepWorld(w, { A: { ...moveRight, dash: true } }, 0.1);
    expect(after.players.A.dash.dashing).toBe(true);
    expect(after.players.A.dash.cooldownRemaining).toBe(DASH_COOLDOWN_S);
  });
});

describe("stepWorld — combat & death", () => {
  it("an attack removes exactly 1 health, only on the initiation tick", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.5, y: 15 } },
    ]);
    const attack: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const after1 = stepWorld(w, { A: attack, B: idle() }, 0.05);
    expect(after1.players.B.health).toBe(START_HEALTH - 1);
    // next tick A holds nothing → no further damage
    const after2 = stepWorld(after1, { A: idle("right"), B: idle() }, 0.05);
    expect(after2.players.B.health).toBe(START_HEALTH - 1);
  });

  it("kills a player at 1 health and ends the match with the survivor as winner", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.5, y: 15 } },
    ]);
    w.players.B.health = 1;
    const attack: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const next = stepWorld(w, { A: attack, B: idle() }, 0.05);
    expect(next.players.B.status).toBe("dead");
    expect(next.phase).toBe("ended");
    expect(next.winnerId).toBe("A");
  });

  it("does not end the match while more than one player is alive", () => {
    const w = createWorld([
      { id: "A", pos: { x: 1, y: 1 } },
      { id: "B", pos: { x: 20, y: 20 } },
      { id: "C", pos: { x: 5, y: 25 } },
    ]);
    const next = stepWorld(w, {}, 0.05);
    expect(next.phase).toBe("playing");
    expect(next.winnerId).toBeNull();
  });

  it("one swing can damage two players in a single tick", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.4, y: 15 } },
      { id: "C", pos: { x: 15.5, y: 15.2 } },
    ]);
    const attack: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const next = stepWorld(w, { A: attack, B: idle(), C: idle() }, 0.05);
    expect(next.players.B.health).toBe(START_HEALTH - 1);
    expect(next.players.C.health).toBe(START_HEALTH - 1);
  });

  it("enforces a 1s cooldown between attacks", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "Z", pos: { x: 1, y: 1 } }, // bystander keeps match playing
    ]);
    const atk: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const s1 = stepWorld(w, { A: atk }, 0.05);
    expect(s1.players.A.attackCooldownRemaining).toBeCloseTo(ATTACK_COOLDOWN_S, 5);
    expect(s1.players.A.attack?.ttl).toBeCloseTo(ATTACK_TTL_S, 5);
    // re-pressing attack during cooldown does NOT start a new swing (ttl keeps decaying)
    const s2 = stepWorld(s1, { A: atk }, 0.05);
    expect(s2.players.A.attackCooldownRemaining).toBeCloseTo(ATTACK_COOLDOWN_S - 0.05, 5);
    expect(s2.players.A.attack?.ttl).toBeCloseTo(ATTACK_TTL_S - 0.05, 5);
    // after the cooldown elapses, a new swing fires (ttl reset, cooldown reset)
    const s3 = stepWorld(s2, { A: { ...atk, attack: false } }, ATTACK_COOLDOWN_S);
    expect(s3.players.A.attackCooldownRemaining).toBe(0);
    const s4 = stepWorld(s3, { A: atk }, 0.05);
    expect(s4.players.A.attack?.ttl).toBeCloseTo(ATTACK_TTL_S, 5);
    expect(s4.players.A.attackCooldownRemaining).toBeCloseTo(ATTACK_COOLDOWN_S, 5);
  });

  it("attacks along the free-aim angle, independent of movement facing", () => {
    // A faces 'right' (body) but aims down-right at B, who is NOT on the facing axis.
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.6, y: 15.6 } },
      { id: "Z", pos: { x: 1, y: 1 } }, // bystander keeps match playing
    ]);
    const attack: Intent = { move: NONE, facing: "right", aim: Math.PI / 4, dash: false, attack: true };
    const after = stepWorld(w, { A: attack, B: idle(), Z: idle() }, 0.05);
    expect(after.players.B.health).toBe(START_HEALTH - 1); // hit despite facing 'right'
    expect(after.players.A.facing).toBe("right"); // body still faces movement
    expect(after.players.A.attack?.aim).toBeCloseTo(Math.PI / 4, 5); // swing locked to aim
  });

  it("uses the attacker's weapon reach — spear reaches farther, knife shorter", () => {
    // target 3m to the right: a spear (reach 3.5) connects, but a knife (reach 1) cannot.
    const world = (weapon: "spear" | "knife") =>
      createWorld([
        { id: "A", pos: { x: 10, y: 15 }, facing: "right", weapon },
        { id: "B", pos: { x: 13, y: 15 } },
        { id: "Z", pos: { x: 1, y: 1 } },
      ]);
    const atk: Intent = { move: NONE, facing: "right", aim: 0, dash: false, attack: true };
    expect(stepWorld(world("spear"), { A: atk }, 0.05).players.B.health).toBe(START_HEALTH - 1);
    expect(stepWorld(world("knife"), { A: atk }, 0.05).players.B.health).toBe(START_HEALTH);
  });

  it("knocks the victim KNOCKBACK_M away from the attacker on a hit", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.5, y: 15 } },
    ]);
    const atk: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const s = stepWorld(w, { A: atk, B: idle() }, 0.05);
    expect(s.players.B.health).toBe(START_HEALTH - 1);
    expect(s.players.B.pos.x).toBeCloseTo(15.5 + KNOCKBACK_M, 5); // pushed away (+x)
    expect(s.players.B.pos.y).toBeCloseTo(15, 5);
  });

  it("clamps knockback at the field wall", () => {
    const w = createWorld([
      { id: "A", pos: { x: FIELD_M - 1.4, y: 15 }, facing: "right" },
      { id: "B", pos: { x: FIELD_M - 0.6, y: 15 } }, // 0.8m ahead, near the wall
    ]);
    const atk: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const s = stepWorld(w, { A: atk, B: idle() }, 0.05);
    // +1m knockback would overshoot the wall → clamped to field - radius
    expect(s.players.B.pos.x).toBeCloseTo(FIELD_M - FIGURE_RADIUS_M, 5);
  });

  it("a mutual kill ends the match with no winner (0 alive → null)", () => {
    const w = createWorld([
      { id: "A", pos: { x: 15, y: 15 }, facing: "right" },
      { id: "B", pos: { x: 15.5, y: 15 }, facing: "left" },
    ]);
    w.players.A.health = 1;
    w.players.B.health = 1;
    const aAtk: Intent = { move: NONE, facing: "right", dash: false, attack: true };
    const bAtk: Intent = { move: NONE, facing: "left", dash: false, attack: true };
    const next = stepWorld(w, { A: aAtk, B: bAtk }, 0.05);
    expect(next.players.A.status).toBe("dead");
    expect(next.players.B.status).toBe("dead");
    expect(next.phase).toBe("ended");
    expect(next.winnerId).toBeNull();
  });
});

describe("stepWorld — lifecycle invariants", () => {
  it("is a no-op once the match has ended (returns the same world)", () => {
    const ended = createWorld([{ id: "A", pos: { x: 15, y: 15 } }], "ended");
    expect(stepWorld(ended, { A: moveRight }, 0.1)).toBe(ended);
  });

  it("keeps an idle player's facing, and adopts an explicit intent's facing", () => {
    const w = createWorld([
      { id: "A", pos: { x: 5, y: 6 }, facing: "right" },
      { id: "Z", pos: { x: 1, y: 1 } }, // bystander keeps the match playing
    ]);
    const kept = stepWorld(w, {}, 0.1);
    expect(kept.players.A.facing).toBe("right");
    const turned = stepWorld(w, { A: { move: { ...NONE, left: true }, facing: "left", dash: false, attack: false } }, 0.1);
    expect(turned.players.A.facing).toBe("left");
  });
});
