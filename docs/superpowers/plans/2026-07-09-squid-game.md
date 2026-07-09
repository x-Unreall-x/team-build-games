# Squid Game (co-op octopus walker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "Squid" — a second playable game where 1–8 players cooperatively walk an octopus 5 m to an arched finish line by each controlling one leg at a time, with two stages (flat / 0.5 m hole at 3 m), timed rounds, and a persistent per-stage team-highscore dashboard in the waiting room.

**Architecture:** Pure deterministic verlet-physics sim core in `src/game/squid/` (no clock/RNG/engine imports; `dt` injected; fixed solver iterations), synced by the existing host-authoritative P2P stack (`SyncEngine` gets a light generic parameterization by world type; the arena path stays behaviorally unchanged). A forked `SquidSession` reuses the lobby/roster/hello machinery. Phaser side-view renderer + React island mirror `Arena.tsx`. Scores persist via trusted Astro API routes writing a single top-10 document per stage in a `GameScores` Wix Data collection (deterministic row id, elevated get/save — the same pattern as `playerAvatars.ts`, deliberately avoiding query builders which don't compose with `auth.elevate`).

**Tech Stack:** TypeScript (strict), Astro 5.8 + `@wix/astro` (vite pinned 6.4.3), React islands, Phaser 4, Trystero WebRTC, `@wix/data` + `@wix/essentials` elevated writes, vitest.

**Spec:** `docs/superpowers/specs/2026-07-09-squid-game-design.md` (approved 2026-07-09).

## Global Constraints

- **No clocks, `Math.random()`, DOM, Phaser, or network imports inside `src/game/squid/` core files** (render/ subdir is the only impure adapter). `dt` is injected. Fixed `SOLVER_ITERATIONS`/`SUBSTEPS` so stepping is byte-deterministic.
- World units are **meters**; course length **5 m**; finish at **x ≥ 5**; stage 2 hole spans **3.0–3.5 m**; head drop ⇒ round failed (stage 2 only, emergent — ground just has no support there).
- Tick rate **20 Hz** (`TICK_HZ` from `src/game/constants.ts`); `timeMs = elapsedTicks / TICK_HZ * 1000`.
- **8 legs** always; one player holds at most one leg; enforced host-side, never trusted from the wire.
- All existing tests must stay green after every task (`npx vitest run` — 151 tests at plan time). New deps: **none**.
- Score sanity bounds (server-side): `3000 ≤ timeMs ≤ 1_800_000`, stage allowlisted, 1–8 names, each ≤ 24 chars.
- Commit after every task with a conventional message. Run `npx tsc --noEmit` before each commit.
- Working directory: `/Users/kyryloi/wix/wix-headless-masterclass/team-build-games`.

## File Structure (all new unless marked Modify)

```
src/game/squid/constants.ts        tuning constants (course, physics, motor speeds, fail depth)
src/game/squid/types.ts            SquidWorld, Leg, VPoint, DistCon, SquidIntent, RawSquidInput, StageId
src/game/squid/stage.ts            STAGES data + groundYAt + coerceStageId
src/game/squid/verlet.ts           integrate + solve (constraints, pins, ground)
src/game/squid/octopus.ts          rig builder (points, legs, constraints)
src/game/squid/control.ts          leg-claim reducer (grab/cycle/release)
src/game/squid/intent.ts           RawSquidInput→SquidIntent (edge memory) + coerceSquidIntent
src/game/squid/sim.ts              stepSquid (motors → verlet → plant → fail/finish)
src/game/squid/match.ts            createSquidWorld + timeMsOf
src/game/squid/net/adapter.ts      SyncAdapter<SquidWorld, SquidIntent>
src/game/squid/net/session.ts      SquidSession (roster/hello/start/kick + generic SyncEngine)
src/game/squid/render/contract.ts  SquidDriver, SquidHudState, SquidEvent
src/game/squid/render/scene.ts     Phaser side-view scene (impure adapter)
src/game/net/protocol.ts           Modify: + squidStart/squidInput/squidSnapshot messages
src/game/net/sync.ts               Modify: SyncEngine<W, I> generic via SyncAdapter
src/game/net/session.ts            Modify: arena Session passes the arena adapter
src/lib/squid/scores.ts            pure top-10 merge + result validation
src/pages/api/squid-result.ts      trusted POST (host reports a finished round)
src/pages/api/squid-scores.ts      GET top-10 per stage
src/lib/members/games.ts           Modify: + squid registry entry
src/components/game/Squid.tsx      React island phase shell
src/components/game/lobby/SquidWarmupRoom.tsx  lobby: stage select + highscore dashboard
src/pages/games/squid.astro        page (mirror arena.astro)
src/pages/index.astro              Modify: + Squid cabinet card
docs/ROADMAP.md                    Modify: progress log entry (final task)
```

Colocated tests: `constants` has none; every other core file gets `<name>.test.ts` next to it.

---

### Task 1: Squid constants + stage definitions

**Files:**
- Create: `src/game/squid/constants.ts`
- Create: `src/game/squid/stage.ts`
- Test: `src/game/squid/stage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every constant below (later tasks import them by these exact names); `type StageId = "stage1" | "stage2"` (exported from stage.ts for now — Task 4's types.ts re-exports it); `STAGES: StageDef[]`, `stageById(id: StageId): StageDef`, `groundYAt(x: number, stage: StageDef): number | null`, `coerceStageId(raw: unknown): StageId`.

- [ ] **Step 1: Write the failing test**

```ts
// src/game/squid/stage.test.ts
import { describe, expect, it } from "vitest";
import { coerceStageId, groundYAt, STAGES, stageById } from "./stage";

describe("stage", () => {
  it("defines exactly two stages with the spec'd geometry", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["stage1", "stage2"]);
    expect(stageById("stage1").hole).toBeNull();
    expect(stageById("stage2").hole).toEqual({ x: 3, width: 0.5 });
  });

  it("stage1 ground is solid everywhere on the course", () => {
    const s = stageById("stage1");
    for (const x of [0, 2.9, 3.2, 3.5, 5]) expect(groundYAt(x, s)).toBe(0);
  });

  it("stage2 ground has no support only inside the 3.0–3.5 m hole", () => {
    const s = stageById("stage2");
    expect(groundYAt(2.99, s)).toBe(0);
    expect(groundYAt(3.0, s)).toBeNull();
    expect(groundYAt(3.25, s)).toBeNull();
    expect(groundYAt(3.5, s)).toBeNull();
    expect(groundYAt(3.51, s)).toBe(0);
  });

  it("coerceStageId falls back to stage1 on garbage", () => {
    expect(coerceStageId("stage2")).toBe("stage2");
    expect(coerceStageId("nope")).toBe("stage1");
    expect(coerceStageId(42)).toBe("stage1");
    expect(coerceStageId(undefined)).toBe("stage1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/squid/stage.test.ts`
Expected: FAIL — `Cannot find module './stage'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```ts
// src/game/squid/constants.ts
/**
 * Squid tuning constants. The world is modelled in METERS with y UP (ground = 0);
 * the renderer flips/scales to pixels. All physics numbers are here so playtest
 * tuning never touches sim code.
 */

/** Course length; the arched finish line stands at this x. */
export const COURSE_M = 5;
export const FINISH_X_M = COURSE_M;

export const LEG_COUNT = 8;
/** Each leg is 3 verlet segments of this length (total reach ~1.35 m). */
export const LEG_SEGMENT_M = 0.45;
/** Head hub spawn position. */
export const HEAD_START_X_M = 0.6;
export const BODY_HEIGHT_M = 1.1;
/** Head visual/collision radius (small enough to fit the 0.5 m hole). */
export const HEAD_R_M = 0.35;

// --- physics ---
export const GRAVITY_MPS2 = 9;
/** Constraint relaxation iterations per substep — FIXED for determinism. */
export const SOLVER_ITERATIONS = 8;
/** Physics substeps per sim tick — FIXED for determinism. */
export const SUBSTEPS = 2;
/** Verlet velocity damping per integration step (1 = none). */
export const DAMPING = 0.99;
/** Fraction of horizontal velocity removed while a point touches ground. */
export const GROUND_FRICTION = 0.7;
/** Tip within this height of ground counts as touching (plants). */
export const PLANT_EPS_M = 0.03;

// --- leg motors (per-second speeds, scaled by dt) ---
/** Horizontal push on a planted leg's upper points — this is what propels the body. */
export const SWING_PLANTED_MPS = 2.2;
/** Horizontal tip speed for a lifted (in-air) leg repositioning itself. */
export const SWING_LIFTED_MPS = 3.5;
/** Upward tip speed while the lift key is held. */
export const LIFT_MPS = 2.5;
/** A lifted tip may not rise above this height. */
export const LIFT_MAX_Y_M = 0.9;

/** Head center below -this ⇒ round failed (only reachable over the hole). */
export const HEAD_DROP_FAIL_M = 0.5;
/** Points may not leave the course strip horizontally. */
export const X_MIN_M = -1;
export const X_MAX_M = COURSE_M + 2;

// --- rendering ---
export const SQUID_PX_PER_M = 110;

// --- score sanity bounds (shared by client + server validation) ---
export const MIN_SCORE_MS = 3000;
export const MAX_SCORE_MS = 30 * 60 * 1000;
```

```ts
// src/game/squid/stage.ts
/** Data-only stage definitions. Ground is y=0 everywhere except inside a hole (no support). */

export type StageId = "stage1" | "stage2";

export interface StageDef {
  id: StageId;
  name: string;
  /** Horizontal span with no ground support, or null for a solid course. */
  hole: { x: number; width: number } | null;
}

export const STAGES: StageDef[] = [
  { id: "stage1", name: "Boardwalk", hole: null },
  { id: "stage2", name: "The Gap", hole: { x: 3, width: 0.5 } },
];

export function stageById(id: StageId): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0]!;
}

/** Ground height at x, or null where there is no support (inside the hole). */
export function groundYAt(x: number, stage: StageDef): number | null {
  const h = stage.hole;
  if (h && x >= h.x && x <= h.x + h.width) return null;
  return 0;
}

/** Wire/UI trust boundary: narrow an untrusted value to a known stage id. */
export function coerceStageId(raw: unknown): StageId {
  return STAGES.some((s) => s.id === raw) ? (raw as StageId) : "stage1";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/squid/stage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/game/squid/constants.ts src/game/squid/stage.ts src/game/squid/stage.test.ts
git commit -m "feat(squid): constants + stage definitions (flat 5m / 0.5m hole at 3m)"
```

---

### Task 2: Verlet physics core

**Files:**
- Create: `src/game/squid/types.ts`
- Create: `src/game/squid/verlet.ts`
- Test: `src/game/squid/verlet.test.ts`

**Interfaces:**
- Consumes: constants from Task 1; `Vec2` and `PlayerId` from `src/game/arena/types.ts` (already exported there).
- Produces: all types below verbatim, plus `integrate(points: VPoint[], dt: number): VPoint[]` and `solve(points: VPoint[], constraints: DistCon[], pinned: boolean[], groundAt: (x: number) => number | null): VPoint[]` — both pure (return new arrays, never mutate inputs).

- [ ] **Step 1: Write types.ts** (no test of its own — it's consumed by every later test)

```ts
// src/game/squid/types.ts
/** Pure squid sim types. No engine/net/DOM imports — mirrors the arena core's discipline. */

import type { PlayerId, Vec2 } from "../arena/types";
import type { StageId } from "./stage";

export type { PlayerId, Vec2 };
export type { StageId };

/** A verlet point: position + previous position (velocity is pos - prev). */
export interface VPoint {
  pos: Vec2;
  prev: Vec2;
}

/** Distance constraint between point indices a and b. */
export interface DistCon {
  a: number;
  b: number;
  len: number;
}

/** One octopus leg: indices into world.points, [root, mid, tip] (root nearest the head). */
export interface Leg {
  pts: [number, number, number];
  /** Tip pinned to the ground (provides support + propulsion leverage). */
  planted: boolean;
  /** Lift key held — tip raised and unpinned. */
  lifted: boolean;
}

export type SquidPhase = "playing" | "ended";
export type RoundResult = "finished" | "failed" | null;

export interface SquidWorld {
  phase: SquidPhase;
  tick: number;
  stage: StageId;
  /** [0] = head hub; then legs' points in leg order (root, mid, tip per leg). */
  points: VPoint[];
  legs: Leg[];
  /** Controlling player per leg index (null = unheld). */
  control: (PlayerId | null)[];
  /** Sorted participant ids (deterministic intent iteration + meta lookups). */
  playerIds: PlayerId[];
  /** Ticks spent in "playing" before a result was set. */
  elapsedTicks: number;
  result: RoundResult;
}

/** What a player may express per tick (sanitized by coerceSquidIntent on the host). */
export interface SquidIntent {
  swing: -1 | 0 | 1;
  lift: boolean;
  /** Edge-triggered: release current leg, claim the next unheld one. */
  cycle: boolean;
  /** Edge-triggered: claim this leg index (from clicking a leg). */
  grabLeg?: number;
}

/** Raw per-frame input from the renderer (keyboard + pointer). */
export interface RawSquidInput {
  left: boolean;
  right: boolean;
  lift: boolean;
  cycle: boolean;
  grabLeg: number | null;
}
```

- [ ] **Step 2: Write the failing verlet test**

```ts
// src/game/squid/verlet.test.ts
import { describe, expect, it } from "vitest";
import { integrate, solve } from "./verlet";
import type { DistCon, VPoint } from "./types";

const p = (x: number, y: number, vx = 0, vy = 0): VPoint => ({
  pos: { x, y },
  prev: { x: x - vx, y: y - vy },
});

describe("integrate", () => {
  it("applies gravity: a resting point accelerates downward", () => {
    const [a] = integrate([p(0, 5)], 0.05);
    expect(a!.pos.y).toBeLessThan(5);
    expect(a!.pos.x).toBe(0);
  });

  it("preserves inertia (verlet): a moving point keeps moving", () => {
    const [a] = integrate([p(0, 5, 0.1, 0)], 0.05);
    expect(a!.pos.x).toBeGreaterThan(0.09); // ~0.1 minus damping
  });

  it("is pure: input points are not mutated", () => {
    const input = [p(0, 5)];
    integrate(input, 0.05);
    expect(input[0]!.pos).toEqual({ x: 0, y: 5 });
  });
});

describe("solve", () => {
  const flat = () => 0 as number | null;

  it("enforces a distance constraint between two free points", () => {
    const pts = [p(0, 1), p(2, 1)]; // 2 m apart, constrained to 1 m
    const con: DistCon[] = [{ a: 0, b: 1, len: 1 }];
    const out = solve(pts, con, [false, false], flat);
    const d = Math.hypot(out[0]!.pos.x - out[1]!.pos.x, out[0]!.pos.y - out[1]!.pos.y);
    expect(d).toBeCloseTo(1, 2);
  });

  it("a pinned point does not move; its partner takes the full correction", () => {
    const pts = [p(0, 1), p(2, 1)];
    const con: DistCon[] = [{ a: 0, b: 1, len: 1 }];
    const out = solve(pts, con, [true, false], flat);
    expect(out[0]!.pos).toEqual({ x: 0, y: 1 });
    expect(Math.hypot(out[1]!.pos.x, out[1]!.pos.y - 1)).toBeCloseTo(1, 2);
  });

  it("clamps points to the ground where support exists", () => {
    const out = solve([p(1, -0.4)], [], [false], flat);
    expect(out[0]!.pos.y).toBe(0);
  });

  it("lets points fall where groundAt returns null (the hole)", () => {
    const out = solve([p(1, -0.4)], [], [false], () => null);
    expect(out[0]!.pos.y).toBe(-0.4);
  });

  it("is deterministic: same inputs stepped twice give deep-equal results", () => {
    const pts = [p(0, 2, 0.05, 0), p(0.45, 2), p(0.9, 1.5)];
    const con: DistCon[] = [
      { a: 0, b: 1, len: 0.45 },
      { a: 1, b: 2, len: 0.45 },
    ];
    const run = () => solve(integrate(pts, 0.05), con, [false, false, true], flat);
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/game/squid/verlet.test.ts`
Expected: FAIL — cannot find module './verlet'.

- [ ] **Step 4: Write the implementation**

```ts
// src/game/squid/verlet.ts
/**
 * Minimal fixed-iteration verlet solver — the squid's whole physics engine.
 * Pure: both entry points clone their inputs and return new arrays. Determinism
 * comes from fixed iteration counts and fixed array order (no RNG, no clock).
 */

import { DAMPING, GRAVITY_MPS2, GROUND_FRICTION, SOLVER_ITERATIONS, X_MAX_M, X_MIN_M } from "./constants";
import type { DistCon, VPoint } from "./types";

const clone = (points: VPoint[]): VPoint[] =>
  points.map((p) => ({ pos: { ...p.pos }, prev: { ...p.prev } }));

/** Verlet integration: inertia + gravity + damping. Pure. */
export function integrate(points: VPoint[], dt: number): VPoint[] {
  return points.map((p) => {
    const vx = (p.pos.x - p.prev.x) * DAMPING;
    const vy = (p.pos.y - p.prev.y) * DAMPING;
    return {
      prev: { ...p.pos },
      pos: { x: p.pos.x + vx, y: p.pos.y + vy - GRAVITY_MPS2 * dt * dt },
    };
  });
}

/**
 * Relax distance constraints (SOLVER_ITERATIONS passes) with pinned points immovable,
 * colliding against the ground profile after each pass. Pure.
 */
export function solve(
  points: VPoint[],
  constraints: DistCon[],
  pinned: boolean[],
  groundAt: (x: number) => number | null,
): VPoint[] {
  const pts = clone(points);

  for (let it = 0; it < SOLVER_ITERATIONS; it++) {
    for (const c of constraints) {
      const a = pts[c.a]!;
      const b = pts[c.b]!;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      const diff = (d - c.len) / d;
      const aPin = pinned[c.a] === true;
      const bPin = pinned[c.b] === true;
      if (aPin && bPin) continue;
      const wa = aPin ? 0 : bPin ? 1 : 0.5;
      const wb = aPin ? 1 : bPin ? 0 : 0.5;
      a.pos.x += dx * diff * wa;
      a.pos.y += dy * diff * wa;
      b.pos.x -= dx * diff * wb;
      b.pos.y -= dy * diff * wb;
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      p.pos.x = Math.min(X_MAX_M, Math.max(X_MIN_M, p.pos.x));
      const g = groundAt(p.pos.x);
      if (g !== null && p.pos.y < g) {
        p.pos.y = g;
        // ground friction: bleed horizontal velocity while touching
        p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * (1 - GROUND_FRICTION);
      }
    }
  }
  return pts;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/game/squid/verlet.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/game/squid/types.ts src/game/squid/verlet.ts src/game/squid/verlet.test.ts
git commit -m "feat(squid): pure verlet core (integrate + pinned constraint solve + ground)"
```

---

### Task 3: Octopus rig builder

**Files:**
- Create: `src/game/squid/octopus.ts`
- Test: `src/game/squid/octopus.test.ts`

**Interfaces:**
- Consumes: `VPoint`, `Leg`, `DistCon` from Task 2; constants from Task 1.
- Produces: `HEAD = 0` (head point index), `POINT_COUNT = 1 + LEG_COUNT * 3`, `buildPoints(): VPoint[]`, `buildLegs(): Leg[]`, `RIG_CONSTRAINTS: DistCon[]` (module const — constraints are static rig topology and deliberately NOT part of `SquidWorld`/snapshots).

- [ ] **Step 1: Write the failing test**

```ts
// src/game/squid/octopus.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/squid/octopus.test.ts`
Expected: FAIL — cannot find module './octopus'.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/squid/octopus.ts
/**
 * Octopus rig: one head hub point + LEG_COUNT legs of 3 chained points each.
 * Constraint topology is static and deterministic, so it is a module const and
 * never rides the wire — snapshots only carry point positions + leg state.
 */

import { BODY_HEIGHT_M, HEAD_START_X_M, LEG_COUNT, LEG_SEGMENT_M } from "./constants";
import type { DistCon, Leg, VPoint } from "./types";

export const HEAD = 0;
export const POINT_COUNT = 1 + LEG_COUNT * 3;

const at = (x: number, y: number): VPoint => ({ pos: { x, y }, prev: { x, y } });

/** Leg k's point indices: root/mid/tip. */
const legPts = (k: number): [number, number, number] => [1 + k * 3, 2 + k * 3, 3 + k * 3];

/** Tip x-offset from the head for leg k: fanned from -0.9 m (behind) to +0.9 m (ahead). */
const tipOffset = (k: number): number => ((k - (LEG_COUNT - 1) / 2) / ((LEG_COUNT - 1) / 2)) * 0.9;

export function buildPoints(): VPoint[] {
  const pts: VPoint[] = [at(HEAD_START_X_M, BODY_HEIGHT_M)];
  for (let k = 0; k < LEG_COUNT; k++) {
    const tipX = HEAD_START_X_M + tipOffset(k);
    // root/mid/tip interpolated from head to tip; the solver settles exact lengths in a few ticks
    for (const f of [1 / 3, 2 / 3, 1]) {
      pts.push(at(HEAD_START_X_M + (tipX - HEAD_START_X_M) * f, BODY_HEIGHT_M * (1 - f)));
    }
  }
  return pts;
}

export function buildLegs(): Leg[] {
  return Array.from({ length: LEG_COUNT }, (_, k) => ({
    pts: legPts(k),
    planted: true,
    lifted: false,
  }));
}

export const RIG_CONSTRAINTS: DistCon[] = Array.from({ length: LEG_COUNT }, (_, k) => {
  const [root, mid, tip] = legPts(k);
  return [
    { a: HEAD, b: root, len: LEG_SEGMENT_M },
    { a: root, b: mid, len: LEG_SEGMENT_M },
    { a: mid, b: tip, len: LEG_SEGMENT_M },
  ];
}).flat();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/squid/octopus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/game/squid/octopus.ts src/game/squid/octopus.test.ts
git commit -m "feat(squid): octopus rig builder (head hub + 8 three-segment legs)"
```

---

### Task 4: Leg-control reducer

**Files:**
- Create: `src/game/squid/control.ts`
- Test: `src/game/squid/control.test.ts`

**Interfaces:**
- Consumes: `PlayerId` from Task 2's types; `LEG_COUNT` from constants.
- Produces: `claimLeg(control: (PlayerId | null)[], playerId: PlayerId, leg: number): (PlayerId | null)[]`, `cycleLeg(control, playerId): (PlayerId | null)[]`, `releasePlayer(control, playerId): (PlayerId | null)[]`, `legOf(control, playerId): number | null`, `emptyControl(): (PlayerId | null)[]`. All pure (return new arrays or the same array when nothing changed).

- [ ] **Step 1: Write the failing test**

```ts
// src/game/squid/control.test.ts
import { describe, expect, it } from "vitest";
import { claimLeg, cycleLeg, emptyControl, legOf, releasePlayer } from "./control";
import { LEG_COUNT } from "./constants";

describe("leg control", () => {
  it("starts with every leg unheld", () => {
    expect(emptyControl()).toEqual(Array(LEG_COUNT).fill(null));
  });

  it("claims an unheld leg and releases the player's previous leg", () => {
    let c = claimLeg(emptyControl(), "A", 2);
    expect(legOf(c, "A")).toBe(2);
    c = claimLeg(c, "A", 5);
    expect(legOf(c, "A")).toBe(5);
    expect(c[2]).toBeNull();
  });

  it("cannot claim a leg someone else holds", () => {
    let c = claimLeg(emptyControl(), "A", 2);
    c = claimLeg(c, "B", 2);
    expect(legOf(c, "B")).toBeNull();
    expect(legOf(c, "A")).toBe(2);
  });

  it("ignores out-of-range leg indices", () => {
    const c = emptyControl();
    expect(claimLeg(c, "A", -1)).toBe(c);
    expect(claimLeg(c, "A", LEG_COUNT)).toBe(c);
    expect(claimLeg(c, "A", 1.5)).toBe(c);
  });

  it("cycle with no current leg claims the first unheld leg", () => {
    const c = cycleLeg(claimLeg(emptyControl(), "B", 0), "A");
    expect(legOf(c, "A")).toBe(1);
  });

  it("cycle moves to the next unheld leg, skipping held ones and wrapping", () => {
    let c = emptyControl();
    c = claimLeg(c, "A", 6);
    c = claimLeg(c, "B", 7);
    c = cycleLeg(c, "A"); // 7 held by B → wraps to 0
    expect(legOf(c, "A")).toBe(0);
    expect(c[6]).toBeNull();
  });

  it("cycle when every other leg is held keeps the current leg", () => {
    let c = emptyControl();
    for (let i = 0; i < LEG_COUNT; i++) c = claimLeg(c, `P${i}`, i);
    const after = cycleLeg(c, "P3");
    expect(legOf(after, "P3")).toBe(3);
  });

  it("releasePlayer frees the player's leg", () => {
    const c = releasePlayer(claimLeg(emptyControl(), "A", 4), "A");
    expect(c[4]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/squid/control.test.ts`
Expected: FAIL — cannot find module './control'.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/squid/control.ts
/**
 * Leg-ownership reducer: index = leg, value = controlling player (null = unheld).
 * One player holds at most one leg — every mutation goes through these reducers
 * on the HOST, so the invariant can't be violated from the wire.
 */

import { LEG_COUNT } from "./constants";
import type { PlayerId } from "./types";

export type LegControl = (PlayerId | null)[];

export const emptyControl = (): LegControl => Array(LEG_COUNT).fill(null);

export function legOf(control: LegControl, playerId: PlayerId): number | null {
  const i = control.indexOf(playerId);
  return i === -1 ? null : i;
}

export function releasePlayer(control: LegControl, playerId: PlayerId): LegControl {
  const i = control.indexOf(playerId);
  if (i === -1) return control;
  const next = [...control];
  next[i] = null;
  return next;
}

/** Claim `leg` if unheld (releasing the player's previous leg). No-op on bad index / held leg. */
export function claimLeg(control: LegControl, playerId: PlayerId, leg: number): LegControl {
  if (!Number.isInteger(leg) || leg < 0 || leg >= LEG_COUNT) return control;
  if (control[leg] !== null && control[leg] !== playerId) return control;
  const next = [...releasePlayer(control, playerId)];
  next[leg] = playerId;
  return next;
}

/** Release the current leg and claim the next unheld one (wrapping); first unheld if none. */
export function cycleLeg(control: LegControl, playerId: PlayerId): LegControl {
  const cur = legOf(control, playerId);
  const start = cur === null ? 0 : cur + 1;
  for (let step = 0; step < LEG_COUNT; step++) {
    const i = (start + step) % LEG_COUNT;
    if (control[i] === null) return claimLeg(control, playerId, i);
  }
  return control; // every other leg is held — keep the current one
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/squid/control.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/game/squid/control.ts src/game/squid/control.test.ts
git commit -m "feat(squid): leg-ownership reducer (claim/cycle/release, one leg per player)"
```

---

### Task 5: Intent adapter + trust boundary

**Files:**
- Create: `src/game/squid/intent.ts`
- Test: `src/game/squid/intent.test.ts`

**Interfaces:**
- Consumes: `RawSquidInput`, `SquidIntent` from types.
- Produces: `SquidInputMemory { prevCycle: boolean }`, `initialSquidMemory(): SquidInputMemory`, `squidInputToIntent(raw: RawSquidInput, mem: SquidInputMemory): { intent: SquidIntent; memory: SquidInputMemory }`, `coerceSquidIntent(raw: unknown): SquidIntent` (the host anti-cheat boundary — mirrors `coerceIntent` in `src/game/net/protocol.ts:87`).

- [ ] **Step 1: Write the failing test**

```ts
// src/game/squid/intent.test.ts
import { describe, expect, it } from "vitest";
import { coerceSquidIntent, initialSquidMemory, squidInputToIntent } from "./intent";
import type { RawSquidInput } from "./types";

const raw = (o: Partial<RawSquidInput> = {}): RawSquidInput => ({
  left: false, right: false, lift: false, cycle: false, grabLeg: null, ...o,
});

describe("squidInputToIntent", () => {
  it("maps left/right to swing, cancelling when both held", () => {
    const m = initialSquidMemory();
    expect(squidInputToIntent(raw({ left: true }), m).intent.swing).toBe(-1);
    expect(squidInputToIntent(raw({ right: true }), m).intent.swing).toBe(1);
    expect(squidInputToIntent(raw({ left: true, right: true }), m).intent.swing).toBe(0);
  });

  it("cycle is edge-triggered: fires once per press, not per held frame", () => {
    let mem = initialSquidMemory();
    const first = squidInputToIntent(raw({ cycle: true }), mem);
    expect(first.intent.cycle).toBe(true);
    const second = squidInputToIntent(raw({ cycle: true }), first.memory);
    expect(second.intent.cycle).toBe(false);
    const released = squidInputToIntent(raw(), second.memory);
    const again = squidInputToIntent(raw({ cycle: true }), released.memory);
    expect(again.intent.cycle).toBe(true);
  });

  it("passes grabLeg through (null → undefined)", () => {
    const m = initialSquidMemory();
    expect(squidInputToIntent(raw({ grabLeg: 3 }), m).intent.grabLeg).toBe(3);
    expect(squidInputToIntent(raw(), m).intent.grabLeg).toBeUndefined();
  });
});

describe("coerceSquidIntent", () => {
  it("normalizes garbage into a safe intent", () => {
    expect(coerceSquidIntent(null)).toEqual({ swing: 0, lift: false, cycle: false, grabLeg: undefined });
    expect(coerceSquidIntent({ swing: 99, lift: 1, cycle: "yes", grabLeg: 3.7 })).toEqual({
      swing: 1, lift: true, cycle: true, grabLeg: undefined,
    });
    expect(coerceSquidIntent({ swing: -42 })).toMatchObject({ swing: -1 });
    expect(coerceSquidIntent({ grabLeg: 5 })).toMatchObject({ grabLeg: 5 });
    expect(coerceSquidIntent({ grabLeg: -1 })).toMatchObject({ grabLeg: undefined });
    expect(coerceSquidIntent({ grabLeg: 8 })).toMatchObject({ grabLeg: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/squid/intent.test.ts`
Expected: FAIL — cannot find module './intent'.

- [ ] **Step 3: Write the implementation**

```ts
// src/game/squid/intent.ts
/**
 * RawSquidInput (held keys, per render frame) → SquidIntent (per sim tick), with
 * edge detection for cycle. `coerceSquidIntent` is the host's anti-cheat boundary:
 * peers can only ever express well-formed intent bits, never leg ownership or positions.
 */

import { LEG_COUNT } from "./constants";
import type { RawSquidInput, SquidIntent } from "./types";

export interface SquidInputMemory {
  prevCycle: boolean;
}

export const initialSquidMemory = (): SquidInputMemory => ({ prevCycle: false });

export function squidInputToIntent(
  raw: RawSquidInput,
  mem: SquidInputMemory,
): { intent: SquidIntent; memory: SquidInputMemory } {
  const swing: SquidIntent["swing"] = raw.left === raw.right ? 0 : raw.left ? -1 : 1;
  return {
    intent: {
      swing,
      lift: raw.lift,
      cycle: raw.cycle && !mem.prevCycle,
      grabLeg: raw.grabLeg ?? undefined,
    },
    memory: { prevCycle: raw.cycle },
  };
}

/** Sanitize an untrusted wire intent (host trust boundary). */
export function coerceSquidIntent(raw: unknown): SquidIntent {
  const i = (raw ?? {}) as Partial<SquidIntent>;
  const swingNum = Number(i.swing);
  const swing: SquidIntent["swing"] = swingNum > 0 ? 1 : swingNum < 0 ? -1 : 0;
  const grabOk = Number.isInteger(i.grabLeg) && (i.grabLeg as number) >= 0 && (i.grabLeg as number) < LEG_COUNT;
  return {
    swing,
    lift: !!i.lift,
    cycle: !!i.cycle,
    grabLeg: grabOk ? (i.grabLeg as number) : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/game/squid/intent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/game/squid/intent.ts src/game/squid/intent.test.ts
git commit -m "feat(squid): intent adapter (edge-triggered cycle) + coerceSquidIntent trust boundary"
```

---

### Task 6: Sim step + match lifecycle

**Files:**
- Create: `src/game/squid/match.ts`
- Create: `src/game/squid/sim.ts`
- Test: `src/game/squid/sim.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `TICK_HZ` from `src/game/constants.ts`.
- Produces: `createSquidWorld(stage: StageId, playerIds: PlayerId[]): SquidWorld` and `timeMsOf(world: SquidWorld): number` (match.ts); `stepSquid(world: SquidWorld, intentsById: Record<PlayerId, SquidIntent>, dt: number): SquidWorld` (sim.ts). These three are the whole core API the net/render layers use.

**Behavior contract (from the spec):**
1. Intents are applied in **sorted player-id order** (grab before cycle) — deterministic under any Record iteration order.
2. Holding lift unpins + raises the controlled leg's tip; swing moves a **lifted** tip horizontally, but pushes a **planted** leg's root+mid points horizontally — the pinned tip converts that into body displacement ("legs as base").
3. Physics: `SUBSTEPS` × (integrate → solve) with pins = planted tips.
4. Plant rule after physics: a non-lifted tip touching supported ground (≤ `PLANT_EPS_M`) plants; a lifted tip or a tip over the hole unplants.
5. Head below `-HEAD_DROP_FAIL_M` ⇒ `result: "failed"`, `phase: "ended"`. Head x ≥ `FINISH_X_M` ⇒ `result: "finished"`, `phase: "ended"`. `elapsedTicks` increments once per playing tick before the checks, so `timeMsOf` is exact.
6. After `phase === "ended"` the world is frozen (stepping returns it unchanged).

- [ ] **Step 1: Write match.ts** (trivial enough to write directly; covered by the sim tests)

```ts
// src/game/squid/match.ts
/** Round lifecycle helpers: world creation + finish-time computation. */

import { TICK_HZ } from "../constants";
import { emptyControl } from "./control";
import { buildLegs, buildPoints } from "./octopus";
import type { PlayerId, SquidWorld, StageId } from "./types";

export function createSquidWorld(stage: StageId, playerIds: PlayerId[]): SquidWorld {
  return {
    phase: "playing",
    tick: 0,
    stage,
    points: buildPoints(),
    legs: buildLegs(),
    control: emptyControl(),
    playerIds: [...playerIds].sort(),
    elapsedTicks: 0,
    result: null,
  };
}

/** The round time in ms (exact — derived from the deterministic tick count). */
export function timeMsOf(world: SquidWorld): number {
  return Math.round((world.elapsedTicks / TICK_HZ) * 1000);
}
```

- [ ] **Step 2: Write the failing sim tests**

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/game/squid/sim.test.ts`
Expected: FAIL — cannot find module './sim'.

- [ ] **Step 4: Write the implementation**

```ts
// src/game/squid/sim.ts
/**
 * stepSquid — the deterministic heart of the squid game. Pure: no clock, no RNG,
 * no engine imports; dt injected; fixed substeps/iterations. Mirrors the arena's
 * stepWorld contract so the (generic) SyncEngine can drive either game.
 */

import {
  FINISH_X_M,
  HEAD_DROP_FAIL_M,
  LIFT_MAX_Y_M,
  LIFT_MPS,
  PLANT_EPS_M,
  SUBSTEPS,
  SWING_LIFTED_MPS,
  SWING_PLANTED_MPS,
} from "./constants";
import { claimLeg, cycleLeg, legOf } from "./control";
import { HEAD, RIG_CONSTRAINTS } from "./octopus";
import { groundYAt, stageById } from "./stage";
import { integrate, solve } from "./verlet";
import type { PlayerId, SquidIntent, SquidWorld, VPoint } from "./types";

const clonePoints = (points: VPoint[]): VPoint[] =>
  points.map((p) => ({ pos: { ...p.pos }, prev: { ...p.prev } }));

export function stepSquid(
  world: SquidWorld,
  intentsById: Record<PlayerId, SquidIntent>,
  dt: number,
): SquidWorld {
  if (world.phase !== "playing" || world.result !== null) return world;

  const stage = stageById(world.stage);
  const groundAt = (x: number) => groundYAt(x, stage);

  // 1) leg selection — sorted-id iteration for determinism; grabs before cycles
  let control = world.control;
  for (const id of world.playerIds) {
    const g = intentsById[id]?.grabLeg;
    if (g !== undefined) control = claimLeg(control, id, g);
  }
  for (const id of world.playerIds) {
    if (intentsById[id]?.cycle) control = cycleLeg(control, id);
  }

  // 2) leg motors + lift state
  const points = clonePoints(world.points);
  const legs = world.legs.map((leg) => ({ ...leg }));
  for (const id of world.playerIds) {
    const intent = intentsById[id];
    const legIdx = legOf(control, id);
    if (!intent || legIdx === null) continue;
    const leg = legs[legIdx]!;
    const [root, mid, tip] = leg.pts;

    leg.lifted = intent.lift;
    if (leg.lifted) leg.planted = false;

    if (leg.lifted) {
      // raise the tip toward the body (position nudge — verlet turns it into velocity)
      const t = points[tip]!;
      t.pos.y = Math.min(LIFT_MAX_Y_M, t.pos.y + LIFT_MPS * dt);
      if (intent.swing !== 0) t.pos.x += intent.swing * SWING_LIFTED_MPS * dt;
    } else if (leg.planted && intent.swing !== 0) {
      // push the leg's upper points; the pinned tip converts this into body motion
      for (const i of [root, mid]) points[i]!.pos.x += intent.swing * SWING_PLANTED_MPS * dt;
    }
  }

  // 3) physics: substepped integrate + solve, pins = planted tips
  const pinned: boolean[] = Array(points.length).fill(false);
  for (const leg of legs) if (leg.planted) pinned[leg.pts[2]] = true;
  let pts = points;
  for (let s = 0; s < SUBSTEPS; s++) {
    pts = solve(integrate(pts, dt / SUBSTEPS), RIG_CONSTRAINTS, pinned, groundAt);
  }
  // pinned tips must not drift (integrate moves everything): restore them
  for (const leg of legs) {
    if (leg.planted) {
      const i = leg.pts[2];
      pts[i] = { pos: { ...world.points[i]!.pos }, prev: { ...world.points[i]!.pos } };
    }
  }

  // 4) plant rule
  for (const leg of legs) {
    const tip = pts[leg.pts[2]]!;
    const g = groundAt(tip.pos.x);
    if (leg.lifted || g === null) leg.planted = false;
    else if (tip.pos.y <= g + PLANT_EPS_M) leg.planted = true;
  }

  // 5) clock + fail/finish
  const elapsedTicks = world.elapsedTicks + 1;
  const head = pts[HEAD]!;
  let result = world.result;
  if (head.pos.y < -HEAD_DROP_FAIL_M) result = "failed";
  else if (head.pos.x >= FINISH_X_M) result = "finished";

  return {
    ...world,
    tick: world.tick + 1,
    points: pts,
    legs,
    control,
    elapsedTicks,
    result,
    phase: result !== null ? "ended" : "playing",
  };
}
```

**Note for the implementer:** the locomotion tests encode the *feel contract*, not exact numbers. If `swinging planted legs propels the body forward` fails on thresholds, tune `SWING_PLANTED_MPS` / `GROUND_FRICTION` / `DAMPING` in `constants.ts` — do NOT weaken the assertion directions (forward must be forward; a lifted swing must move the tip more than the head; lifting all legs must sag). If the pinned-tip restore causes visible jitter later, an acceptable alternative is marking tips pinned during `integrate` too (skip inertia+gravity for pinned indices) — keep the tests green either way.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/game/squid/sim.test.ts`
Expected: PASS (11 tests). Budget tuning time here — this is the heart of the game.

- [ ] **Step 6: Run the whole suite + typecheck + commit**

```bash
npx vitest run
npx tsc --noEmit
git add src/game/squid/sim.ts src/game/squid/match.ts src/game/squid/sim.test.ts
git commit -m "feat(squid): deterministic sim step (motors, verlet, plant, fail/finish) + match lifecycle"
```

---

### Task 7: Protocol — squid wire messages

**Files:**
- Modify: `src/game/net/protocol.ts` (add message variants; nothing existing changes)
- Test: `src/game/net/protocol.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `SquidIntent`, `SquidWorld`, `StageId` from `../squid/types`.
- Produces: three new `NetMessage` variants and `SquidStartPlayer`, used verbatim by Tasks 8–9:

```ts
export interface SquidStartPlayer {
  id: PlayerId;
  name: string;
  iconColor: number;
  avatarUrl?: string | null;
}
// added to the NetMessage union:
| { t: "squidStart"; countdownMs: number; stage: StageId; players: SquidStartPlayer[] }
| { t: "squidInput"; tick: number; intent: SquidIntent }
| { t: "squidSnapshot"; world: SquidWorld }
```

- [ ] **Step 1: Write the failing test** — append to `src/game/net/protocol.test.ts`:

```ts
import { createSquidWorld } from "../squid/match";

describe("squid protocol messages", () => {
  it("round-trips squidStart", () => {
    const m = {
      t: "squidStart" as const,
      countdownMs: 3000,
      stage: "stage2" as const,
      players: [{ id: "A", name: "Ann", iconColor: 2, avatarUrl: null }],
    };
    expect(decode(encode(m))).toEqual(m);
  });

  it("round-trips squidInput and squidSnapshot with a real world", () => {
    const input = { t: "squidInput" as const, tick: 7, intent: { swing: 1 as const, lift: true, cycle: false } };
    expect(decode(encode(input))).toEqual(input);
    const snap = { t: "squidSnapshot" as const, world: createSquidWorld("stage1", ["A", "B"]) };
    expect(decode(encode(snap))).toEqual(snap);
  });
});
```

(Reuse the file's existing `encode`/`decode` imports; add the `createSquidWorld` import at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/game/net/protocol.test.ts`
Expected: FAIL — TypeScript rejects the unknown `t: "squidStart"` variant (compile error in the test).

- [ ] **Step 3: Implement** — in `src/game/net/protocol.ts`: add imports and the three variants:

```ts
// add to the imports at the top
import type { SquidIntent, SquidWorld, StageId } from "../squid/types";

// add after the StartPlayer interface
/** A participant in a starting squid round (no weapons/shapes — cosmetics are color+name). */
export interface SquidStartPlayer {
  id: PlayerId;
  name: string;
  iconColor: number;
  avatarUrl?: string | null;
}
```

and extend the `NetMessage` union (before `| { t: "event"; ... }`):

```ts
  | { t: "squidStart"; countdownMs: number; stage: StageId; players: SquidStartPlayer[] }
  | { t: "squidInput"; tick: number; intent: SquidIntent }
  | { t: "squidSnapshot"; world: SquidWorld }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/game/net/protocol.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Full suite + typecheck + commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/game/net/protocol.ts src/game/net/protocol.test.ts
git commit -m "feat(net): squid wire messages (squidStart/squidInput/squidSnapshot)"
```

<!-- CONTINUE -->


