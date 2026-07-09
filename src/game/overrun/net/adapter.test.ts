// src/game/overrun/net/adapter.test.ts
import { describe, expect, it } from "vitest";
import { overrunSyncAdapter } from "./adapter";
import { createShooterWorld } from "../match";
import { stepShooter } from "../sim";
import { KEYFRAME_EVERY, SHOOTER_DT, SNAPSHOT_EVERY_TICKS } from "../constants";
import { qWorld, unqWorld } from "./codec";
import type { ShooterIntent, ShooterWorld } from "../types";

const IDLE: ShooterIntent = { move: { up: false, down: false, left: false, right: false }, fire: false, reload: false, perkPick: null };
const idle = (w: ShooterWorld) => Object.fromEntries(Object.keys(w.players).map((id) => [id, IDLE]));
const advance = (w: ShooterWorld, n: number) => {
  for (let t = 0; t < n; t++) w = stepShooter(w, idle(w), SHOOTER_DT);
  return w;
};

describe("overrunSyncAdapter cadence", () => {
  it("broadcasts only every SNAPSHOT_EVERY_TICKS ticks; first send is a keyframe, then deltas, keyframe again on schedule", () => {
    let w = createShooterWorld(["a"], 5);
    let prevSent: ShooterWorld | null = null;
    const kinds: string[] = [];
    for (let t = 0; t < SNAPSHOT_EVERY_TICKS * (KEYFRAME_EVERY + 2); t++) {
      w = stepShooter(w, idle(w), SHOOTER_DT);
      const payload = overrunSyncAdapter.encodeSnapshot(w, prevSent);
      if (w.tick % SNAPSHOT_EVERY_TICKS !== 0) {
        expect(payload).toBeNull();
        continue;
      }
      expect(payload).not.toBeNull();
      kinds.push((JSON.parse(payload!) as { m: { t: string } }).m.t);
      prevSent = w;
    }
    expect(kinds[0]).toBe("oSnap"); // prevSent null → keyframe
    expect(kinds).toContain("oDelta"); // deltas between keyframes
    expect(kinds.filter((k) => k === "oSnap").length).toBeGreaterThanOrEqual(2); // periodic keyframes
  });

  it("a client fed only the adapter's own broadcasts reconstructs the host's quantized world", () => {
    let host = createShooterWorld(["a", "b"], 9);
    let prevSent: ShooterWorld | null = null;
    let client: ShooterWorld = createShooterWorld(["a", "b"], 9);
    for (let t = 0; t < 90; t++) {
      host = stepShooter(host, idle(host), SHOOTER_DT);
      const payload = overrunSyncAdapter.encodeSnapshot(host, prevSent);
      if (!payload) continue;
      prevSent = host;
      const m = overrunSyncAdapter.decodeMessage(payload)!;
      if (m.kind === "snapshot") client = m.world;
      else if (m.kind === "update") client = m.apply(client);
    }
    expect(client).toEqual(unqWorld(qWorld(host)));
  });

  it("a delta arriving on the wrong base leaves the client world untouched until the next keyframe", () => {
    let host = createShooterWorld(["a"], 9);
    host = advance(host, SNAPSHOT_EVERY_TICKS);
    const key = overrunSyncAdapter.encodeSnapshot(host, null)!;
    const clientBase = (overrunSyncAdapter.decodeMessage(key) as { kind: "snapshot"; world: ShooterWorld }).world;
    const prevSent = host;
    host = advance(host, SNAPSHOT_EVERY_TICKS);
    host = advance(host, SNAPSHOT_EVERY_TICKS);
    // delta based on a send the client never got applied to an older world:
    const delta = overrunSyncAdapter.encodeSnapshot(host, advance(prevSent, SNAPSHOT_EVERY_TICKS))!;
    const m = overrunSyncAdapter.decodeMessage(delta)!;
    expect(m.kind).toBe("update");
    if (m.kind === "update") expect(m.apply(clientBase)).toBe(clientBase);
  });

  it("elects the lowest connected id that exists in the world (downed still hosts); input encodes/decodes", () => {
    const w = createShooterWorld(["b", "c"], 1);
    expect(overrunSyncAdapter.electHost(w, ["c", "b", "zz"])).toBe("b");
    w.players.b = { ...w.players.b!, status: "dead" };
    expect(overrunSyncAdapter.electHost(w, ["b", "c"])).toBe("c");
    const input = overrunSyncAdapter.encodeInput(w, { ...IDLE, fire: true });
    const m = overrunSyncAdapter.decodeMessage(input);
    expect(m?.kind).toBe("input");
  });

  it("onPeerLeave marks the departed player dead", () => {
    const w = createShooterWorld(["a", "b"], 1);
    const out = overrunSyncAdapter.onPeerLeave!(w, "b");
    expect(out.players.b!.status).toBe("dead");
    expect(overrunSyncAdapter.onPeerLeave!(out, "ghost")).toBe(out);
  });
});
