/**
 * Netplay session: ties the Transport, the warm-up roster, and the host-authoritative
 * SyncEngine into one object that also serves as the renderer's MatchDriver.
 *
 * Presence model (simple + robust): every peer announces itself with `hello` on join and
 * whenever a new peer appears, so everyone accumulates the roster; departures drop on peer-leave.
 * Host (for Start/kick) = lowest connected id. On Start, the host broadcasts the ordered player
 * list (+ bots) so all peers build an identical world, then everyone runs a local countdown and
 * the SyncEngine takes over.
 */

import type { Intent, PlayerId, RawInput, World } from "../arena/types";
import type { Transport } from "./transport";
import { decode, encode, type StartPlayer } from "./protocol";
import { SyncEngine } from "./sync";
import { electHost } from "./election";
import { createWorld, evenSpawns } from "../arena/match";
import { initialMemory, inputToIntent } from "../arena/intent";
import { botIntent } from "../arena/bot";
import { COUNTDOWN_S } from "../constants";
import type { FramePacket, MatchDriver, PlayerMeta } from "../arena/render/contract";
import type { LobbyPlayer, Roster } from "./lobby";
import { remove, rosterList, upsert } from "./lobby";
import { coerceShape, DEFAULT_SHAPE, type Shape } from "../arena/cosmetic";
import { coerceWeapon, DEFAULT_WEAPON, type Weapon } from "../arena/weapons";

export type SessionPhase = "lobby" | "countdown" | "playing" | "ended";

export interface SessionOptions {
  transport: Transport;
  name: string;
  iconColor: number;
  shape: Shape;
  weapon: Weapon;
  /** Notified whenever roster/phase/host changes so React can re-render. */
  onChange: () => void;
}

const EMPTY_WORLD: World = { players: {}, projectiles: [], phase: "lobby", tick: 0, winnerId: null };
const NO_INPUT: RawInput = { up: false, down: false, left: false, right: false, dash: false, attack: false };

export class Session implements MatchDriver {
  readonly localId: PlayerId;
  private readonly t: Transport;
  private profile: LobbyPlayer;
  private roster: Roster = {};
  phase: SessionPhase = "lobby";
  /** Bumped on each match start so the UI can recreate the renderer cleanly. */
  matchEpoch = 0;

  private engine: SyncEngine | null = null;
  private initialWorld: World | null = null;
  private meta: Record<PlayerId, PlayerMeta> = {};
  private botIds: PlayerId[] = [];
  private countdownLeft = 0;
  private mem = initialMemory();
  private pendingRaw: RawInput = NO_INPUT;

  constructor(private readonly opts: SessionOptions) {
    this.t = opts.transport;
    this.localId = this.t.selfId;
    this.profile = { id: this.localId, name: opts.name, iconColor: opts.iconColor, shape: opts.shape, weapon: opts.weapon };
    this.roster = upsert({}, this.profile);

    this.t.onMessage((data, from) => this.onMessage(data, from));
    this.t.onPeerJoin(() => this.sendHello()); // greet newcomers so they learn our profile
    this.t.onPeerLeave((id) => {
      this.roster = remove(this.roster, id);
      this.opts.onChange();
    });
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
      winnerId: this.engine?.getWorld().winnerId ?? null,
    };
  }

  /** Return to the warm-up room (after a match ends). */
  toLobby(): void {
    this.phase = "lobby";
    this.engine = null;
    this.initialWorld = null;
    this.opts.onChange();
  }

  setProfile(name: string, iconColor: number, shape: Shape = this.profile.shape, weapon: Weapon = this.profile.weapon): void {
    this.profile = { id: this.localId, name, iconColor, shape, weapon };
    this.roster = upsert(this.roster, this.profile);
    this.sendHello();
    this.opts.onChange();
  }

  /** Host-only: start a match with the current roster plus `botCount` host-driven bots. */
  start(botCount = 0): void {
    if (this.hostId() !== this.localId) return;
    const humans: StartPlayer[] = rosterList(this.roster).map((p) => ({
      id: p.id,
      name: p.name,
      iconColor: p.iconColor,
      shape: p.shape,
      weapon: p.weapon,
      isBot: false,
    }));
    const bots: StartPlayer[] = Array.from({ length: botCount }, (_, i) => ({
      id: `bot:${i + 1}`,
      name: `Bot ${i + 1}`,
      iconColor: (humans.length + i) % 8,
      shape: DEFAULT_SHAPE,
      weapon: DEFAULT_WEAPON,
      isBot: true,
    }));
    const players = [...humans, ...bots];
    this.t.send(encode({ t: "start", countdownMs: COUNTDOWN_S * 1000, players }));
    this.beginMatch(players);
  }

  kick(targetId: PlayerId): void {
    if (this.hostId() !== this.localId || targetId === this.localId) return;
    this.t.send(encode({ t: "kick", targetId }));
    this.roster = remove(this.roster, targetId);
    this.opts.onChange();
  }

  leave(): void {
    this.t.close();
  }

  // ---- MatchDriver (renderer) --------------------------------------------------

  getMeta(id: PlayerId): PlayerMeta {
    return this.meta[id] ?? { name: id.slice(0, 6), colorIndex: 0, shape: DEFAULT_SHAPE };
  }

  frame(dt: number, input: RawInput): FramePacket {
    this.pendingRaw = input;

    if (this.phase === "countdown") {
      this.countdownLeft = Math.max(0, this.countdownLeft - dt);
      if (this.countdownLeft <= 0) {
        this.phase = "playing";
        this.opts.onChange();
      }
      return { world: this.initialWorld ?? EMPTY_WORLD, countdown: Math.ceil(this.countdownLeft) };
    }

    if ((this.phase === "playing" || this.phase === "ended") && this.engine) {
      this.engine.tick(dt);
      const world = this.engine.getWorld();
      if (world.phase === "ended" && this.phase !== "ended") {
        this.phase = "ended";
        this.opts.onChange();
      }
      return { world, countdown: 0 };
    }

    return { world: this.initialWorld ?? EMPTY_WORLD, countdown: 0 };
  }

  // ---- internals ---------------------------------------------------------------

  private hostId(): PlayerId | null {
    return electHost([this.localId, ...this.t.getPeers()]);
  }

  private sendHello(): void {
    this.t.send(encode({ t: "hello", name: this.profile.name, iconColor: this.profile.iconColor, shape: this.profile.shape, weapon: this.profile.weapon }));
  }

  private onMessage(data: string, from: PlayerId): void {
    const m = decode(data);
    if (!m) return;
    switch (m.t) {
      case "hello": {
        const isNew = !(from in this.roster);
        this.roster = upsert(this.roster, { id: from, name: m.name, iconColor: m.iconColor, shape: coerceShape(m.shape), weapon: coerceWeapon(m.weapon) });
        if (isNew) this.sendHello(); // reply so the newcomer learns us (bounded: only on first sight)
        this.opts.onChange();
        break;
      }
      case "kick":
        if (m.targetId === this.localId) {
          this.leave();
          this.phase = "lobby";
          this.opts.onChange();
        }
        break;
      case "start":
        this.beginMatch(m.players);
        break;
      default:
        break; // input/snapshot are consumed by the SyncEngine's own handler
    }
  }

  private beginMatch(players: StartPlayer[]): void {
    const ids = players.map((p) => p.id);
    this.meta = Object.fromEntries(players.map((p) => [p.id, { name: p.name, colorIndex: p.iconColor, shape: p.shape }]));
    this.botIds = players.filter((p) => p.isBot).map((p) => p.id);
    // Zip the deterministic spawn ring with each player's equipped weapon (same order as ids).
    const spawns = evenSpawns(ids).map((s, i) => ({ ...s, weapon: players[i]!.weapon }));
    this.initialWorld = createWorld(spawns, "playing");
    this.mem = initialMemory();

    this.engine = new SyncEngine({
      transport: this.t,
      localId: this.localId,
      world: this.initialWorld,
      readIntent: () => {
        const { intent, memory } = inputToIntent(this.pendingRaw, this.mem);
        this.mem = memory;
        return intent;
      },
      onWorld: () => {},
      hostExtraIntents: () => {
        const w = this.engine!.getWorld();
        const out: Record<PlayerId, Intent> = {};
        for (const id of this.botIds) out[id] = botIntent(id, w);
        return out;
      },
    });

    this.phase = "countdown";
    this.countdownLeft = COUNTDOWN_S;
    this.matchEpoch += 1;
    this.opts.onChange();
  }
}
