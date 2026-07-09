// src/game/overrun/net/session.ts
/**
 * Overrun netplay session: Transport + warm-up roster + the generic SyncEngine,
 * exposed as the renderer's OverrunDriver. Mirrors the arena Session's presence
 * + explicit-host model (hello/host/kick/leave), minus rounds/bots/cosmetics —
 * Overrun and Arena are separate games and share no game-specific imports.
 *
 * Roster + hello use Overrun's own `oHello` message (no shape/weapon/iconColor
 * on the wire — colorIndex is DERIVED at match start from each player's index
 * in the host-ordered `oStart` players array, never transmitted separately).
 *
 * The ONE permitted impurity in this file: `start()` mints the match seed with
 * Math.random() — it is broadcast in `oStart` and from then on all randomness
 * is the world-carried coordinate-hash.
 */

import type { PlayerId } from "../types";
import type { Transport } from "../../net/transport";
import { decode, encode } from "../../net/protocol";
import { SyncEngine } from "../../net/sync";
import { electHost } from "../../net/election";
import { OVERRUN_COUNTDOWN_S, MAX_CATCHUP_TICKS, SHOOTER_DT, SNAPSHOT_INTERVAL_S } from "../constants";
import { initialShooterMemory, inputToShooterIntent } from "../intent";
import { createShooterWorld } from "../match";
import { overrunSyncAdapter } from "./adapter";
import { lerpWorlds } from "./interp";
import type { RawShooterInput, ShooterIntent, ShooterWorld } from "../types";

export type OverrunPhase = "lobby" | "countdown" | "playing" | "ended";

export interface OverrunSessionOptions {
  transport: Transport;
  name: string;
  isCreator?: boolean;
  onChange: () => void;
}

/** Overrun's own tiny warm-up roster — just presence, no cosmetics (those are arena's). */
interface OverrunRosterEntry {
  id: PlayerId;
  name: string;
}
type OverrunRoster = Record<PlayerId, OverrunRosterEntry>;

function upsertPlayer(roster: OverrunRoster, entry: OverrunRosterEntry): OverrunRoster {
  return { ...roster, [entry.id]: entry };
}

function removePlayer(roster: OverrunRoster, id: PlayerId): OverrunRoster {
  if (!(id in roster)) return roster;
  const next = { ...roster };
  delete next[id];
  return next;
}

/** Players sorted by id (stable display + the host's oStart order → colorIndex). */
function rosterList(roster: OverrunRoster): OverrunRosterEntry[] {
  return Object.values(roster).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const NO_INPUT: RawShooterInput = { up: false, down: false, left: false, right: false, fire: false, reload: false, pick1: false, pick2: false, pick3: false };

export class OverrunSession {
  readonly localId: PlayerId;
  phase: OverrunPhase = "lobby";
  matchEpoch = 0;

  private readonly t: Transport;
  private name: string;
  private roster: OverrunRoster = {};
  private explicitHostId: PlayerId | null = null;
  private engine: SyncEngine<ShooterWorld, ShooterIntent> | null = null;
  private initialWorld: ShooterWorld | null = null;
  private meta: Record<PlayerId, { name: string; colorIndex: number }> = {};
  private countdownLeft = 0;
  private mem = initialShooterMemory();
  private pendingRaw: RawShooterInput = NO_INPUT;
  private queuedPick: 0 | 1 | 2 | null = null;
  private acc = 0;
  // client interpolation state
  private prevSnap: ShooterWorld | null = null;
  private latestSnap: ShooterWorld | null = null;
  private latestTick = -1;
  private sinceLatest = 0;

  constructor(private readonly opts: OverrunSessionOptions) {
    this.t = opts.transport;
    this.localId = this.t.selfId;
    this.name = opts.name;
    this.roster = upsertPlayer({}, { id: this.localId, name: this.name });
    if (opts.isCreator) this.explicitHostId = this.localId; // the creator owns host until it transfers/leaves

    this.t.onMessage((data, from) => this.onMessage(data, from));
    this.t.onPeerJoin(() => this.sendHello()); // greet newcomers so they learn our profile + host
    this.t.onPeerLeave((id) => this.onPeerLeave(id));
    this.sendHello();
  }

  // ---- public state for the UI -------------------------------------------------

  getState() {
    const hostId = this.hostId();
    return {
      localId: this.localId,
      phase: this.phase,
      matchEpoch: this.matchEpoch,
      roster: rosterList(this.roster),
      hostId,
      isHost: hostId === this.localId,
    };
  }

  setProfile(name: string): void {
    this.name = name;
    this.roster = upsertPlayer(this.roster, { id: this.localId, name });
    this.sendHello();
    this.opts.onChange();
  }

  /** Host-only: start the run for the current roster with a freshly minted seed. */
  start(): void {
    if (this.hostId() !== this.localId) return;
    const players = rosterList(this.roster).map((p) => ({ id: p.id, name: p.name }));
    if (players.length < 1) return;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    this.t.send(encode({ t: "oStart", countdownMs: OVERRUN_COUNTDOWN_S * 1000, seed, players }));
    this.beginMatch(players, seed);
  }

  /** HUD click path for a perk choice (keyboard 1/2/3 flows through RawShooterInput). */
  pickPerk(i: 0 | 1 | 2): void {
    this.queuedPick = i;
  }

  kick(targetId: PlayerId): void {
    if (this.hostId() !== this.localId || targetId === this.localId) return;
    this.t.send(encode({ t: "kick", targetId }));
    this.roster = removePlayer(this.roster, targetId);
    this.opts.onChange();
  }

  /** Host-only: hand the host role to another connected player in the lobby. */
  makeHost(targetId: PlayerId): void {
    if (this.hostId() !== this.localId || targetId === this.localId) return;
    if (!(targetId in this.roster)) return;
    this.explicitHostId = targetId;
    this.t.send(encode({ t: "host", hostId: targetId }));
    this.opts.onChange();
  }

  leave(): void {
    this.t.close();
  }

  /** Return to the warm-up room (after a match ends). */
  toLobby(): void {
    this.phase = "lobby";
    this.engine = null;
    this.initialWorld = null;
    this.prevSnap = null;
    this.latestSnap = null;
    this.latestTick = -1;
    this.opts.onChange();
  }

  getMeta(id: PlayerId): { name: string; colorIndex: number } {
    return this.meta[id] ?? { name: id.slice(0, 6), colorIndex: 0 };
  }

  /** Advance the fixed-tick sim and return the world to RENDER (+ countdown). */
  frame(dt: number, input: RawShooterInput): { world: ShooterWorld; countdown: number } {
    this.pendingRaw = input;

    if (this.phase === "countdown") {
      this.countdownLeft = Math.max(0, this.countdownLeft - dt);
      if (this.countdownLeft <= 0) {
        this.phase = "playing";
        this.opts.onChange();
      }
      return { world: this.initialWorld ?? createShooterWorld([this.localId], 0), countdown: Math.ceil(this.countdownLeft) };
    }

    if ((this.phase === "playing" || this.phase === "ended") && this.engine) {
      this.acc = Math.min(this.acc + dt, MAX_CATCHUP_TICKS * SHOOTER_DT);
      while (this.acc >= SHOOTER_DT) {
        this.engine.tick(SHOOTER_DT);
        this.acc -= SHOOTER_DT;
      }
      const w = this.engine.getWorld();
      if (w.tick !== this.latestTick) {
        this.prevSnap = this.latestSnap;
        this.latestSnap = w;
        this.latestTick = w.tick;
        this.sinceLatest = 0;
      } else {
        this.sinceLatest += dt;
      }
      if (w.phase === "ended" && this.phase === "playing") {
        this.phase = "ended";
        this.opts.onChange();
      }
      const render = this.engine.isHost
        ? w
        : lerpWorlds(this.prevSnap, this.latestSnap ?? w, this.sinceLatest / SNAPSHOT_INTERVAL_S);
      return { world: render, countdown: 0 };
    }

    return { world: this.initialWorld ?? createShooterWorld([this.localId], 0), countdown: 0 };
  }

  // ---- internals ----------------------------------------------------------------

  private hostId(): PlayerId | null {
    // Explicit host when known; otherwise fall back to lowest-id election (bootstrap + migration).
    if (this.explicitHostId && [this.localId, ...this.t.getPeers()].includes(this.explicitHostId)) {
      return this.explicitHostId;
    }
    return electHost([this.localId, ...this.t.getPeers()]);
  }

  private onPeerLeave(id: PlayerId): void {
    // NB: by the time any peer-leave listener runs, LocalHub has already dropped `id` from
    // getPeers() everywhere, so `hostId()` below is already the POST-departure election —
    // `wasHost` can equal the departed id only via an explicit (not-yet-stale) claim, which
    // can't happen once the claim holder is excluded. Mirrors the arena Session exactly;
    // `hostId()`'s own election fallback is what keeps reads consistent even when this is false.
    const wasHost = id === this.hostId();
    this.roster = removePlayer(this.roster, id);
    if (wasHost) {
      // Host left → drop the stale claim so everyone falls back to lowest-id election (consistent),
      // then the newly-elected host re-claims + announces so late joiners adopt it too.
      this.explicitHostId = null;
      if (electHost([this.localId, ...this.t.getPeers()]) === this.localId) {
        this.explicitHostId = this.localId;
        this.t.send(encode({ t: "host", hostId: this.localId }));
      }
    }
    // SyncEngine.onPeerLeave is registered on this same transport AFTER ours (it's created in
    // beginMatch, which runs after the constructor), so it fires right after this callback in
    // the same dispatch. It gates its fold-in (marking the departed player dead) on its OWN
    // cached `isHost`, which `tick()` alone refreshes — so on a host departure every surviving
    // engine would still believe the departed peer is host and silently skip the fold. Forcing
    // a zero-dt tick here (unconditionally, since the departure may or may not have been the
    // engine's believed host) guarantees that cache is current before its handler runs.
    this.engine?.tick(0);
    this.opts.onChange();
  }

  private sendHello(): void {
    this.t.send(encode({ t: "oHello", name: this.name, hostId: this.explicitHostId }));
  }

  private onMessage(data: string, from: PlayerId): void {
    const m = decode(data);
    if (!m) return;
    switch (m.t) {
      case "oHello": {
        const isNew = !(from in this.roster);
        this.roster = upsertPlayer(this.roster, { id: from, name: m.name });
        // A joiner with no host yet adopts the sender's claimed host (creator/host propagation).
        if (this.explicitHostId == null && m.hostId != null) this.explicitHostId = m.hostId;
        if (isNew) this.sendHello(); // reply so the newcomer learns us + our host (bounded: first sight)
        this.opts.onChange();
        break;
      }
      case "host":
        this.explicitHostId = m.hostId;
        this.opts.onChange();
        break;
      case "kick":
        if (m.targetId === this.localId) {
          this.leave();
          this.phase = "lobby";
          this.opts.onChange();
        }
        break;
      case "oStart":
        this.beginMatch(m.players, m.seed);
        break;
      default:
        break; // oInput/oSnap/oDelta are consumed by the SyncEngine's own handler
    }
  }

  private beginMatch(players: { id: PlayerId; name: string }[], seed: number): void {
    // colorIndex is DERIVED, never carried on the wire: it's each player's position
    // in this host-ordered array (host built it via rosterList — sorted by id).
    this.meta = Object.fromEntries(players.map((p, i) => [p.id, { name: p.name, colorIndex: i }]));
    this.initialWorld = createShooterWorld(players.map((p) => p.id), seed);
    this.mem = initialShooterMemory();
    this.acc = 0;
    this.prevSnap = null;
    this.latestSnap = null;
    this.latestTick = -1;

    this.engine = new SyncEngine({
      transport: this.t,
      localId: this.localId,
      world: this.initialWorld,
      adapter: overrunSyncAdapter,
      readIntent: () => {
        const { intent, memory } = inputToShooterIntent(this.pendingRaw, this.mem);
        this.mem = memory;
        const perkPick = intent.perkPick ?? this.queuedPick;
        this.queuedPick = null;
        return { ...intent, perkPick };
      },
      onWorld: () => {},
    });

    this.phase = "countdown";
    this.countdownLeft = OVERRUN_COUNTDOWN_S;
    this.matchEpoch += 1;
    this.opts.onChange();
  }
}
