import { describe, expect, it } from "vitest";
import { LocalHub } from "./transport";
import { Session } from "./session";
import type { RawInput } from "../arena/types";

const IDLE: RawInput = { up: false, down: false, left: false, right: false, dash: false, attack: false };
const RIGHT: RawInput = { ...IDLE, right: true };

describe("Session — lobby → start → play", () => {
  it("converges the roster, elects a host, starts a match, and syncs a client's movement", () => {
    const hub = new LocalHub();
    const a = new Session({ transport: hub.join("a"), name: "Ay", iconColor: 0, shape: "circle", weapon: "sword", onChange: () => {} });
    const b = new Session({ transport: hub.join("b"), name: "Bee", iconColor: 1, shape: "circle", weapon: "sword", onChange: () => {} });

    // presence converges on both peers despite join ordering
    expect(a.getState().roster.map((p) => p.id)).toEqual(["a", "b"]);
    expect(b.getState().roster.map((p) => p.id)).toEqual(["a", "b"]);
    expect(a.getState().isHost).toBe(true);
    expect(b.getState().isHost).toBe(false);

    // host starts a human-only match
    a.start(0);
    expect(a.phase).toBe("countdown");
    expect(b.phase).toBe("countdown"); // received the start broadcast

    // b spawns at the left (x≈2); hold "right" through countdown + a second of play
    const bSpawnX = b.frame(0, RIGHT).world.players.b.pos.x;
    for (let i = 0; i < 85; i++) {
      b.frame(0.05, RIGHT);
      a.frame(0.05, IDLE);
    }
    const aw = a.frame(0, IDLE).world;
    const bw = b.frame(0, RIGHT).world;

    expect(aw.phase).toBe("playing"); // countdown elapsed
    expect(aw.players.b.pos.x).toBeGreaterThan(bSpawnX + 1); // host applied b's input
    expect(bw.players.b.pos.x).toBeCloseTo(aw.players.b.pos.x, 1); // client follows host
  });

  it("a host-driven bot is simulated and visible to clients", () => {
    const hub = new LocalHub();
    const a = new Session({ transport: hub.join("a"), name: "A", iconColor: 0, shape: "circle", weapon: "sword", onChange: () => {} });
    const b = new Session({ transport: hub.join("b"), name: "B", iconColor: 1, shape: "circle", weapon: "sword", onChange: () => {} });

    a.start(1); // 2 humans + 1 bot
    expect(a.getMeta("bot:1").name).toBe("Bot 1");

    for (let i = 0; i < 70; i++) {
      b.frame(0.05, IDLE);
      a.frame(0.05, IDLE);
    }
    const aw = a.frame(0, IDLE).world;
    expect(aw.players["bot:1"]).toBeDefined();
    expect(aw.players["bot:1"]!.status).toBe("alive");
  });
});
