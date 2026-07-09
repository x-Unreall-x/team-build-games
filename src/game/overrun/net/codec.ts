// src/game/overrun/net/codec.ts
/**
 * Quantized wire codec (the absorbed P-A0): positions → int cm, times → int cs,
 * aim → int mrad; enemies/pickups/events as tuples; players as short-key objects
 * (≤8 of them). Deltas diff QUANTIZED forms so a client applying a delta lands
 * exactly on unq(q(hostWorld)) — no drift between keyframes.
 *
 * Keyframes carry EVERYTHING (seed, spawnSeq, pity, pending, offers…) so a
 * migrating host resumes bit-compatibly from its last received snapshot.
 */

import type { PlayerId, Vec2 } from "../types";
import { EVENT_TTL_TICKS, MAX_EVENTS } from "../constants";
import { ENEMY_KINDS } from "../enemies";
import { GUN_IDS } from "../weapons";
import { PERK_IDS } from "../perks";
import type {
  Enemy, EnemyKind, PerkId, PerkOffer, Pickup, PickupKind, ShooterEvent,
  ShooterPhase, ShooterPlayer, ShooterStatus, ShooterWorld,
} from "../types";

const cm = (m: number) => Math.round(m * 100);
const m = (cmv: number) => cmv / 100;
const cs = (s: number) => Math.round(s * 100);
const s = (csv: number) => csv / 100;
const mrad = (rad: number) => Math.round(rad * 1000);
const rad = (mr: number) => mr / 1000;

const STATUS: ShooterStatus[] = ["alive", "downed", "dead"];
const PICKUP_KINDS: PickupKind[] = ["shotgun", "rifle", "medkit"];
const EVENT_KINDS = ["shot", "kill", "pickup", "levelup", "downed", "revived"] as const;

// players: short-key object (readable, only 8 of them)
interface QPlayer {
  i: PlayerId; x: number; y: number; a: number; h: number; st: number; g: number;
  am: [number, number, number, number]; // mag, reserve, reloadCs, fireCdCs
  xp: number; lv: number; pk: string; of: number[][]; sh: [number, number, number]; // shots,hits,kills
  rv: number; gd: number;
}
type QEnemy = [string, number, number, number, number, number]; // id, kind, xcm, ycm, health, cdCs
type QPickup = [string, number, number, number, number]; // id, kind, xcm, ycm, ttlCs
type QEvent = (number | string)[]; // [tick, kindIdx, ...payload]

export interface QWorld {
  t: number; ph: number; sd: number; wv: number; ps: number; pd: string; im: number;
  pl: QPlayer[]; en: QEnemy[]; pk: QPickup[]; ev: QEvent[];
  sc: number; sq: number; py: number;
}

export interface ODelta {
  /** Base tick this delta applies to (client must hold exactly this world). */
  b: number;
  t: number;
  ph: number;
  pl: QPlayer[]; // players always ship in full (≤8)
  en: { a: QEnemy[]; u: [string, number, number, number, number][]; d: string[] }; // add / update(id,x,y,h,cd) / delete
  pk: QPickup[]; // full pickup list (≤24 small tuples — ttls tick every step, diffing buys nothing)
  ev: QEvent[]; // events newer than the base tick
  s: [number, number, number, number, number]; // wave, partySize, intermissionCs, score, pity
  sq: number;
  pd?: string; // pending — only when changed
}

const qVec = (v: Vec2): [number, number] => [cm(v.x), cm(v.y)];

function qPlayer(p: ShooterPlayer): QPlayer {
  return {
    i: p.id, x: cm(p.pos.x), y: cm(p.pos.y), a: mrad(p.aim), h: Math.round(p.health),
    st: STATUS.indexOf(p.status), g: GUN_IDS.indexOf(p.gun),
    am: [p.ammo.mag, p.ammo.reserve, cs(p.ammo.reloadRemaining), cs(p.ammo.fireCooldown)],
    xp: p.xp, lv: p.level,
    pk: p.perks.map((k) => PERK_IDS.indexOf(k)).join(""),
    of: p.offers.map((o) => o.choices.map((c) => PERK_IDS.indexOf(c))),
    sh: [p.stats.shots, p.stats.hits, p.stats.kills],
    rv: cs(p.reviveProgress), gd: cs(p.swapGuard),
  };
}

function unqPlayer(q: QPlayer): ShooterPlayer {
  return {
    id: q.i, pos: { x: m(q.x), y: m(q.y) }, aim: rad(q.a), health: q.h,
    status: STATUS[q.st]!, gun: GUN_IDS[q.g]!,
    ammo: { mag: q.am[0], reserve: q.am[1], reloadRemaining: s(q.am[2]), fireCooldown: s(q.am[3]) },
    xp: q.xp, level: q.lv,
    perks: [...q.pk].map((c) => PERK_IDS[Number(c)]!) as PerkId[],
    offers: q.of.map((o) => ({ choices: o.map((n) => PERK_IDS[n]!) as PerkOffer["choices"] })),
    stats: { shots: q.sh[0], hits: q.sh[1], kills: q.sh[2] },
    reviveProgress: s(q.rv), swapGuard: s(q.gd),
  };
}

const qEnemy = (e: Enemy): QEnemy => [e.id, ENEMY_KINDS.indexOf(e.kind), cm(e.pos.x), cm(e.pos.y), Math.round(e.health), cs(e.attackCooldown)];
const unqEnemy = (q: QEnemy): Enemy => ({ id: q[0], kind: ENEMY_KINDS[q[1]]!, pos: { x: m(q[2]), y: m(q[3]) }, health: q[4], attackCooldown: s(q[5]) });
const qPickup = (k: Pickup): QPickup => [k.id, PICKUP_KINDS.indexOf(k.kind), cm(k.pos.x), cm(k.pos.y), cs(k.ttl)];
const unqPickup = (q: QPickup): Pickup => ({ id: q[0], kind: PICKUP_KINDS[q[1]]!, pos: { x: m(q[2]), y: m(q[3]) }, ttl: s(q[4]) });

function qEvent(e: ShooterEvent): QEvent {
  const k = EVENT_KINDS.indexOf(e.kind);
  if (e.kind === "shot") return [e.tick, k, GUN_IDS.indexOf(e.gun), ...qVec(e.from), ...qVec(e.to)];
  if (e.kind === "kill") return [e.tick, k, ENEMY_KINDS.indexOf(e.enemy), ...qVec(e.pos)];
  if (e.kind === "pickup") return [e.tick, k, PICKUP_KINDS.indexOf(e.item), ...qVec(e.pos)];
  return [e.tick, k, e.playerId];
}

function unqEvent(q: QEvent): ShooterEvent {
  const tick = q[0] as number;
  const kind = EVENT_KINDS[q[1] as number]!;
  if (kind === "shot") return { tick, kind, gun: GUN_IDS[q[2] as number]!, from: { x: m(q[3] as number), y: m(q[4] as number) }, to: { x: m(q[5] as number), y: m(q[6] as number) } };
  if (kind === "kill") return { tick, kind, enemy: ENEMY_KINDS[q[2] as number]!, pos: { x: m(q[3] as number), y: m(q[4] as number) } };
  if (kind === "pickup") return { tick, kind, item: PICKUP_KINDS[q[2] as number]!, pos: { x: m(q[3] as number), y: m(q[4] as number) } };
  return { tick, kind, playerId: q[2] as string };
}

const qPending = (pd: EnemyKind[]): string => pd.map((k) => ENEMY_KINDS.indexOf(k)).join("");
const unqPending = (str: string): EnemyKind[] => [...str].map((c) => ENEMY_KINDS[Number(c)]!);

export function qWorld(w: ShooterWorld): QWorld {
  return {
    t: w.tick, ph: w.phase === "ended" ? 1 : 0, sd: w.seed, wv: w.wave, ps: w.partySize,
    pd: qPending(w.pending), im: cs(w.intermission),
    pl: Object.keys(w.players).sort().map((id) => qPlayer(w.players[id]!)),
    en: w.enemies.map(qEnemy), pk: w.pickups.map(qPickup), ev: w.events.map(qEvent),
    sc: w.score, sq: w.spawnSeq, py: w.pity,
  };
}

export function unqWorld(q: QWorld): ShooterWorld {
  const players: Record<PlayerId, ShooterPlayer> = {};
  for (const p of q.pl) players[p.i] = unqPlayer(p);
  return {
    tick: q.t, phase: (q.ph === 1 ? "ended" : "playing") as ShooterPhase, seed: q.sd,
    wave: q.wv, partySize: q.ps, pending: unqPending(q.pd), intermission: s(q.im),
    players, enemies: q.en.map(unqEnemy), pickups: q.pk.map(unqPickup), events: q.ev.map(unqEvent),
    score: q.sc, spawnSeq: q.sq, pity: q.py,
  };
}

/** Diff two QUANTIZED worlds (host: qWorld(lastSent) vs qWorld(current)). */
export function diffWorld(prevQ: QWorld, curQ: QWorld): ODelta {
  const prevEn = new Map(prevQ.en.map((e) => [e[0], e]));
  const curEnIds = new Set(curQ.en.map((e) => e[0]));
  const en: ODelta["en"] = { a: [], u: [], d: [] };
  for (const e of curQ.en) {
    const p = prevEn.get(e[0]);
    if (!p) en.a.push(e);
    else if (p[2] !== e[2] || p[3] !== e[3] || p[4] !== e[4] || p[5] !== e[5]) en.u.push([e[0], e[2], e[3], e[4], e[5]]);
  }
  for (const e of prevQ.en) if (!curEnIds.has(e[0])) en.d.push(e[0]);

  const d: ODelta = {
    b: prevQ.t, t: curQ.t, ph: curQ.ph, pl: curQ.pl, en, pk: curQ.pk,
    ev: curQ.ev.filter((e) => (e[0] as number) > prevQ.t),
    s: [curQ.wv, curQ.ps, curQ.im, curQ.sc, curQ.py], sq: curQ.sq,
  };
  if (curQ.pd !== prevQ.pd) d.pd = curQ.pd;
  return d;
}

/** Apply a delta to the client's held world. Wrong base → return prev (wait for keyframe). */
export function applyDelta(prev: ShooterWorld, d: ODelta): ShooterWorld {
  if (prev.tick !== d.b) return prev;
  const players: Record<PlayerId, ShooterPlayer> = {};
  for (const p of d.pl) players[p.i] = unqPlayer(p);

  const removed = new Set(d.en.d);
  const updated = new Map(d.en.u.map((u) => [u[0], u]));
  const enemies: Enemy[] = [];
  for (const e of prev.enemies) {
    if (removed.has(e.id)) continue;
    const u = updated.get(e.id);
    enemies.push(u ? { ...e, pos: { x: m(u[1]), y: m(u[2]) }, health: u[3], attackCooldown: s(u[4]) } : e);
  }
  enemies.push(...d.en.a.map(unqEnemy));

  const pickups = d.pk.map(unqPickup);

  // Rebuild events exactly as the sim would hold them: kept-window ∪ new, capped to newest.
  const kept = prev.events.filter((e) => e.tick > d.t - EVENT_TTL_TICKS);
  const events = [...kept, ...d.ev.map(unqEvent)];
  const capped = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;

  return {
    tick: d.t, phase: d.ph === 1 ? "ended" : "playing", seed: prev.seed,
    wave: d.s[0], partySize: d.s[1], intermission: s(d.s[2]),
    pending: d.pd !== undefined ? unqPending(d.pd) : prev.pending,
    players, enemies, pickups, events: capped, score: d.s[3], spawnSeq: d.sq, pity: d.s[4],
  };
}
