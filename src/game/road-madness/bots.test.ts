import { describe, expect, it } from "vitest";
import { botIntent } from "./bots";
import { createRoadWorld } from "./match";

describe("Road Madness bot difficulty", () => {
  it("changes pursuit aggression without bypassing the shared input boundary", () => {
    const makeWorld = (difficulty: "rookie" | "mad" | "maniac") => {
      const world = createRoadWorld(
        [
          { id: "bot", vehicle: "derby", isBot: true },
          { id: "target", vehicle: "derby" },
        ],
        "last-madman",
        { botDifficulty: difficulty },
      );
      world.cars.bot = {
        ...world.cars.bot!,
        pos: { x: 5, y: 10 },
        vel: { x: 3, y: 0 },
        heading: 0,
      };
      world.cars.target = {
        ...world.cars.target!,
        pos: { x: 13, y: 10 },
        vel: { x: 0, y: 0 },
      };
      return world;
    };

    const rookie = makeWorld("rookie");
    const maniac = makeWorld("maniac");
    expect(botIntent(rookie, rookie.cars.bot!).boost).toBe(false);
    expect(botIntent(maniac, maniac.cars.bot!).boost).toBe(true);
    expect(botIntent(maniac, maniac.cars.bot!)).toMatchObject({ throttle: 1, handbrake: false });
  });
});
