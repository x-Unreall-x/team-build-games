import { describe, expect, it } from "vitest";
import { LocalHub } from "./transport";
import { SyncEngine, type SyncAdapter } from "./sync";
import { arenaSyncAdapter } from "./arenaAdapter";
import { createWorld } from "../arena/match";
import type { Intent, InputState, World } from "../arena/types";

const NONE: InputState = { up: false, down: false, left: false, right: false };
const IDLE: Intent = { move: NONE, facing: "down", dash: false, attack: false };
const RIGHT: Intent = { move: { ...NONE, right: true }, facing: "right", dash: false, attack: false };

const spawns = () => [
  { id: "a", pos: { x: 5, y: 15 } },
  { id: "b", pos: { x: 10, y: 15 } },
  { id: "c", pos: { x: 20, y: 15 } },
];

describe("SyncEngine — host authority", () => {
  it("the host applies a client's input and broadcasts it to everyone", () => {
    const hub = new LocalHub();
    let aWorld: World | undefined;
    let bWorld: World | undefined;
    const a = new SyncEngine({
      transport: hub.join("a"),
      localId: "a",
      world: createWorld(spawns().slice(0, 2)),
      adapter: arenaSyncAdapter,
      readIntent: () => IDLE,
      onWorld: (w) => (aWorld = w),
    });
    const b = new SyncEngine({
      transport: hub.join("b"),
      localId: "b",
      world: createWorld(spawns().slice(0, 2)),
      adapter: arenaSyncAdapter,
      readIntent: () => RIGHT, // b holds "right"
      onWorld: (w) => (bWorld = w),
    });

    expect(a.isHost).toBe(true); // lowest id
    expect(b.isHost).toBe(false);

    // client ticks first (sends input), then host steps using it
    for (let i = 0; i < 5; i++) {
      b.tick(0.1);
      a.tick(0.1);
    }
    b.tick(0); // flush: let b render the host's latest snapshot

    // b moved right in the canonical (host) world, and b's own client view agrees exactly
    expect(aWorld!.players.b.pos.x).toBeGreaterThan(10);
    expect(bWorld!.players.b.pos.x).toBeCloseTo(aWorld!.players.b.pos.x, 5);
    // 'a' (idle) did not move
    expect(aWorld!.players.a.pos.x).toBeCloseTo(5, 5);
  });
});

describe("SyncEngine — host-controlled bots & peer drop", () => {
  it("the host applies extra intents for non-peer entities (bots)", () => {
    const hub = new LocalHub();
    let aWorld: World | undefined;
    const a = new SyncEngine({
      transport: hub.join("a"),
      localId: "a",
      world: createWorld(spawns()),
      adapter: arenaSyncAdapter,
      readIntent: () => IDLE,
      onWorld: (w) => (aWorld = w),
      hostExtraIntents: () => ({ c: RIGHT }), // host drives "c" like a bot
    });
    const b = new SyncEngine({ transport: hub.join("b"), localId: "b", world: createWorld(spawns()), adapter: arenaSyncAdapter, readIntent: () => IDLE, onWorld: () => {} });
    for (let i = 0; i < 3; i++) {
      b.tick(0.1);
      a.tick(0.1);
    }
    expect(aWorld!.players.c.pos.x).toBeGreaterThan(20); // c (host-driven) moved right
  });

  it("marks a departed peer's player dead so the match resolves", () => {
    const hub = new LocalHub();
    let aWorld: World | undefined;
    const ta = hub.join("a");
    const tb = hub.join("b");
    const a = new SyncEngine({
      transport: ta,
      localId: "a",
      world: createWorld(spawns().slice(0, 2)),
      adapter: arenaSyncAdapter,
      readIntent: () => IDLE,
      onWorld: (w) => (aWorld = w),
    });
    const b = new SyncEngine({ transport: tb, localId: "b", world: createWorld(spawns().slice(0, 2)), adapter: arenaSyncAdapter, readIntent: () => IDLE, onWorld: () => {} });

    a.tick(0.05);
    tb.close(); // b drops → host a marks b dead
    a.tick(0.05);

    expect(aWorld!.players.b.status).toBe("dead");
    expect(aWorld!.phase).toBe("ended");
    expect(aWorld!.winnerId).toBe("a");
    void b;
  });
});

describe("SyncEngine — host migration", () => {
  it("promotes the next-lowest peer when the host leaves, and the sim continues", () => {
    const hub = new LocalHub();
    const worlds: Record<string, World> = {};
    const ta = hub.join("a");
    const tb = hub.join("b");
    const tc = hub.join("c");
    const a = new SyncEngine({ transport: ta, localId: "a", world: createWorld(spawns()), adapter: arenaSyncAdapter, readIntent: () => IDLE, onWorld: (w) => (worlds.a = w) });
    const b = new SyncEngine({ transport: tb, localId: "b", world: createWorld(spawns()), adapter: arenaSyncAdapter, readIntent: () => IDLE, onWorld: (w) => (worlds.b = w) });
    const c = new SyncEngine({ transport: tc, localId: "c", world: createWorld(spawns()), adapter: arenaSyncAdapter, readIntent: () => IDLE, onWorld: (w) => (worlds.c = w) });

    expect(a.isHost).toBe(true);
    for (let i = 0; i < 4; i++) {
      b.tick(0.05);
      c.tick(0.05);
      a.tick(0.05);
    }
    const tickBeforeLeave = b.getWorld().tick;
    expect(tickBeforeLeave).toBeGreaterThan(0);

    // host leaves
    ta.close();

    for (let i = 0; i < 4; i++) {
      c.tick(0.05);
      b.tick(0.05);
    }
    c.tick(0); // flush: let c render b's latest snapshot

    expect(b.isHost).toBe(true); // migrated to next-lowest connected
    expect(c.isHost).toBe(false);
    expect(b.getWorld().tick).toBeGreaterThan(tickBeforeLeave); // sim kept advancing
    expect(worlds.c!.tick).toBe(b.getWorld().tick); // c is now following b's snapshots
  });
});

describe("snapshot cadence + deltas (generic engine)", () => {
  it("skips broadcast when encodeSnapshot returns null, and passes the last SENT world as prevSent", () => {
    // Minimal fake adapter over a counter world {n: number}: snapshot every 2nd tick.
    const sent: Array<{ n: number; prev: number | null }> = [];
    type CW = { n: number };
    const adapter: SyncAdapter<CW, Record<string, never>> = {
      step: (w) => ({ n: w.n + 1 }),
      coerceIntent: () => ({}),
      encodeInput: () => JSON.stringify({ t: "i" }),
      encodeSnapshot: (w, prev) => {
        if (w.n % 2 !== 0) return null;
        sent.push({ n: w.n, prev: prev?.n ?? null });
        return JSON.stringify({ t: "s", n: w.n });
      },
      decodeMessage: (data) => {
        const m = JSON.parse(data);
        if (m.t === "i") return { kind: "input", intent: {} };
        if (m.t === "s") return { kind: "snapshot", world: { n: m.n } };
        return null;
      },
      electHost: (_w, connected) => [...connected].sort()[0] ?? null,
    };
    const hub = new LocalHub();
    const host = new SyncEngine({ transport: hub.join("a"), localId: "a", world: { n: 0 }, adapter, readIntent: () => ({}), onWorld: () => {} });
    const client = new SyncEngine({ transport: hub.join("b"), localId: "b", world: { n: 0 }, adapter, readIntent: () => ({}), onWorld: () => {} });
    for (let t = 0; t < 4; t++) { host.tick(0.05); client.tick(0.05); }
    expect(sent).toEqual([{ n: 2, prev: null }, { n: 4, prev: 2 }]);
    expect(client.getWorld().n).toBe(4);
  });

  it("applies 'update' messages against the client's held world", () => {
    type CW = { n: number };
    const adapter: SyncAdapter<CW, Record<string, never>> = {
      step: (w) => ({ n: w.n + 1 }),
      coerceIntent: () => ({}),
      encodeInput: () => JSON.stringify({ t: "i" }),
      encodeSnapshot: (w, prev) =>
        prev === null ? JSON.stringify({ t: "s", n: w.n }) : JSON.stringify({ t: "d", add: w.n - prev.n }),
      decodeMessage: (data) => {
        const m = JSON.parse(data);
        if (m.t === "i") return { kind: "input", intent: {} };
        if (m.t === "s") return { kind: "snapshot", world: { n: m.n } };
        if (m.t === "d") return { kind: "update", apply: (prev: CW) => ({ n: prev.n + m.add }) };
        return null;
      },
      electHost: (_w, connected) => [...connected].sort()[0] ?? null,
    };
    const hub = new LocalHub();
    const host = new SyncEngine({ transport: hub.join("a"), localId: "a", world: { n: 0 }, adapter, readIntent: () => ({}), onWorld: () => {} });
    const client = new SyncEngine({ transport: hub.join("b"), localId: "b", world: { n: 0 }, adapter, readIntent: () => ({}), onWorld: () => {} });
    for (let t = 0; t < 3; t++) { host.tick(0.05); client.tick(0.05); }
    expect(client.getWorld().n).toBe(3); // keyframe n=1, then deltas +1 +1
  });
});
