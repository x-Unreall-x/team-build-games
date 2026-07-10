// src/game/squid/net/adapter.ts
/** Squid's SyncAdapter: plugs the squid sim + wire messages into squid's own SyncEngine. */

import type { SyncAdapter } from "./engine";
import { decodeSquid, encodeSquid } from "./protocol";
import { electHost } from "../../net/election";
import { stepSquid } from "../sim";
import { coerceSquidIntent } from "../intent";
import { releasePlayer } from "../control";
import type { SquidIntent, SquidWorld } from "../types";

export const squidSyncAdapter: SyncAdapter<SquidWorld, SquidIntent> = {
  step: stepSquid,
  coerceIntent: coerceSquidIntent,
  encodeInput: (world, intent) => encodeSquid({ t: "squidInput", tick: world.tick, intent }),
  encodeSnapshot: (world) => encodeSquid({ t: "squidSnapshot", world }),
  decodeMessage: (data) => {
    const m = decodeSquid(data);
    if (!m) return null;
    if (m.t === "squidInput") return { kind: "input", intent: m.intent };
    if (m.t === "squidSnapshot") return { kind: "snapshot", world: m.world };
    return null;
  },
  // Everyone is always "alive" in squid — plain lowest-connected-id election.
  electHost: (_world, connected) => electHost(connected),
  // A departed player's leg becomes grabbable; their intents stop mattering.
  onPeerLeave: (world, id) => ({
    ...world,
    control: releasePlayer(world.control, id),
    playerIds: world.playerIds.filter((p) => p !== id),
  }),
};
