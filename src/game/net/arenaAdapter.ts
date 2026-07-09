/**
 * The arena's `SyncAdapter` — byte-identical wire behavior to the pre-generic engine:
 * broadcasts a full snapshot every tick (ignores `prevSent`, never returns null).
 */

import type { Intent, PlayerId, World } from "../arena/types";
import { stepWorld } from "../arena/sim";
import { coerceIntent, decode, encode, worldFromSnapshot } from "./protocol";
import { electHostForWorld } from "./election";
import type { SyncAdapter } from "./sync";

export const arenaSyncAdapter: SyncAdapter<World, Intent> = {
  step: stepWorld,
  coerceIntent,
  encodeInput: (world, intent) => encode({ t: "input", tick: world.tick, intent }),
  encodeSnapshot: (w, _prevSent) =>
    encode({ t: "snapshot", tick: w.tick, phase: w.phase, winnerId: w.winnerId, players: w.players, projectiles: w.projectiles }),
  decodeMessage: (data) => {
    const m = decode(data);
    if (!m) return null;
    if (m.t === "input") return { kind: "input", intent: m.intent };
    if (m.t === "snapshot") return { kind: "snapshot", world: worldFromSnapshot(m) };
    return null;
  },
  electHost: electHostForWorld,
  onPeerLeave: (w, id: PlayerId) =>
    w.players[id]?.status === "alive"
      ? { ...w, players: { ...w.players, [id]: { ...w.players[id]!, status: "dead", attack: null, health: 0 } } }
      : w,
};
