import { describe, expect, it } from "vitest";
import { coerceIntent, decode, encode, worldFromSnapshot, type NetMessage } from "./protocol";
import { createWorld } from "../arena/match";

describe("encode / decode", () => {
  it("round-trips an input message", () => {
    const m: NetMessage = {
      t: "input",
      tick: 7,
      intent: { move: { up: false, down: false, left: true, right: false }, facing: "left", dash: true, attack: false },
    };
    expect(decode(encode(m))).toEqual(m);
  });

  it("round-trips a snapshot and rebuilds a usable World", () => {
    const w = createWorld([{ id: "A", pos: { x: 1, y: 2 } }, { id: "B", pos: { x: 3, y: 4 } }]);
    const m: NetMessage = { t: "snapshot", tick: w.tick, phase: w.phase, winnerId: w.winnerId, players: w.players, projectiles: w.projectiles };
    const back = decode(encode(m)) as Extract<NetMessage, { t: "snapshot" }>;
    const world = worldFromSnapshot(back);
    expect(world.players.A.pos).toEqual({ x: 1, y: 2 });
    expect(world.phase).toBe("playing");
  });

  it("returns null for garbage or wrong version", () => {
    expect(decode("not json")).toBeNull();
    expect(decode(JSON.stringify({ v: 999, m: { t: "input" } }))).toBeNull();
    expect(decode(JSON.stringify({ v: 1, m: {} }))).toBeNull();
  });
});

describe("coerceIntent", () => {
  it("coerces arbitrary input into a safe intent", () => {
    expect(
      coerceIntent({ move: { right: "yes", up: 1 }, facing: "left", dash: 1, attack: 0, extra: "ignored" }),
    ).toEqual({
      move: { up: true, down: false, left: false, right: true },
      facing: "left",
      dash: true,
      attack: false,
    });
  });

  it("defaults a bad facing to 'down' and missing fields to false", () => {
    expect(coerceIntent({ facing: "diagonal" })).toEqual({
      move: { up: false, down: false, left: false, right: false },
      facing: "down",
      dash: false,
      attack: false,
    });
    expect(coerceIntent(null).facing).toBe("down");
  });

  it("preserves a finite aim angle and drops a non-finite one", () => {
    expect(coerceIntent({ facing: "left", aim: 1.5 }).aim).toBeCloseTo(1.5, 5);
    expect(coerceIntent({ facing: "left", aim: "nope" }).aim).toBeUndefined();
    expect(coerceIntent({ facing: "left", aim: Infinity }).aim).toBeUndefined();
  });
});
