/**
 * Trystero-backed Transport (browser-only). Zero self-hosted backend: peers find each other
 * over public Nostr relays (BitTorrent is available as an alternate strategy via the import
 * path). Game data flows directly peer-to-peer over WebRTC DataChannels.
 *
 * Import ONLY from client-side code (it touches RTCPeerConnection) — never during SSR.
 * The sync engine talks to this purely through the Transport interface, so everything that
 * runs against LocalHub in tests runs unchanged here.
 */

import { joinRoom, selfId } from "trystero/nostr";
import type { MessageHandler, PeerHandler, PeerId, Transport } from "./transport";

const APP_ID = "team-build-arena";

export interface RtcOptions {
  roomId: string;
  /** STUN + TURN servers. TURN is required for the ~10–20% behind strict NAT. */
  iceServers?: RTCIceServer[];
  /** How many relays to use for resilient matchmaking (default 4). */
  relayRedundancy?: number;
}

export function createRtcTransport(opts: RtcOptions): Transport {
  const room = joinRoom(
    {
      appId: APP_ID,
      relayConfig: { redundancy: opts.relayRedundancy ?? 4 },
      ...(opts.iceServers ? { rtcConfig: { iceServers: opts.iceServers } } : {}),
    },
    opts.roomId,
  );

  const action = room.makeAction<string>("msg");
  const msgCbs: MessageHandler[] = [];
  const joinCbs: PeerHandler[] = [];
  const leaveCbs: PeerHandler[] = [];

  action.onMessage = (data, ctx) => {
    for (const cb of msgCbs) cb(String(data), ctx.peerId);
  };
  room.onPeerJoin = (id) => {
    for (const cb of joinCbs) cb(id);
  };
  room.onPeerLeave = (id) => {
    for (const cb of leaveCbs) cb(id);
  };

  return {
    selfId,
    send(data: string, to?: PeerId) {
      void action.send(data, to !== undefined ? { target: to } : undefined);
    },
    onMessage(cb) {
      msgCbs.push(cb);
    },
    onPeerJoin(cb) {
      joinCbs.push(cb);
    },
    onPeerLeave(cb) {
      leaveCbs.push(cb);
    },
    getPeers() {
      return Object.keys(room.getPeers());
    },
    close() {
      void room.leave();
    },
  };
}
