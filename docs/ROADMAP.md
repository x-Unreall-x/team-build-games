# TeamBuildGames — Product Roadmap

A living doc to track progress and high-level implementation details for the game pack,
anchored on the **Arena** P2P realtime game. Tick the `[ ]` boxes as work lands.

**Status:** Arena 2D single-player prototype shipped & deployed (Phaser 4 React island in Astro,
on Wix static hosting). Next: Arena → 8-player P2P last-man-standing 2.5D arena, then Wix
persistence, then the turn-based game #2.

## Decisions locked

- **Engine:** keep **Phaser 4** (already installed). "2.5D" is a *look* — faked with per-sprite
  y-sort, a tilted/scaled field, soft shadows, and a death "jump" tween — **not** a 3D engine.
- **Networking:** **Trystero** (zero-backend signaling: Nostr default + BitTorrent fallback) in a
  **host-authoritative star on a WebRTC mesh**; clients send inputs only, the host runs the sim.
- **Audio:** raw **Web Audio** oscillator SFX (no binary assets).
- **Scope:** Arena (Track A) + Wix backend (Track B) + turn-based game #2 (Track C).
- **Musa art:** tint **one base musa sprite** into 8 player colors.

---

## Architecture spine (applies to all tracks)

A pure, **engine/transport-free sim CORE** that depends on nothing; the Phaser renderer, the
Trystero netcode, the Web Audio layer, and the React HUD all depend **inward** on the core, never
vice-versa. **Inject `dt`/`now`/RNG** into the core — never read clocks or `Math.random()` inside it
— so ticks are deterministic, replayable, and unit-testable. Netcode hides behind a `Transport`
interface so the whole sim runs under a `LocalTransport` mock in tests and `RtcTransport` (Trystero)
in production. This preserves the prototype's proven pattern: pure `src/game/arena/logic.ts` +
colocated `logic.test.ts`, with the engine only *consuming* the sim.

### Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Engine/renderer | **Phaser 4** + fake-2.5D (y-sort by world-Y, tilted field, ellipse shadows) | Already installed; flat game needs no 3D; bundles input/tween/timer/audio |
| P2P + signaling | **Trystero** (Nostr + BitTorrent, `redundancy` on), behind a `Transport` iface | Only zero-backend option that works from static Wix hosting; binary channels, stable peer ids |
| Topology/authority | **Host-authoritative star on mesh**; host = lowest **alive** peer id; inputs-only @20 Hz | Single source of truth (anti-cheat for client tampering) + deterministic migration |
| NAT traversal | **STUN + a free TURN** (Metered Open Relay → Cloudflare Realtime TURN at scale) | ~10–20% behind strict NAT/CGNAT can't connect without TURN |
| Audio | **Web Audio** oscillators: one shared `AudioContext` + `playTone()` + note-sequence | Zero assets/bundle; chiptune = oscillators; resume on first gesture |
| Persistence (Track B) | **Astro server API routes** + `@wix/data` with elevated app creds | `output:"server"` already runs trusted req/res endpoints on Wix infra (see `api/checkout.ts`) |
| Test/build | zero-config **vitest** (`vitest run`); Astro 5.8 + `@wix/astro`; **vite pinned 6.4.3** | Pure core unit-tested; new deps must build under the pinned toolchain |

---

## Track A — Arena (P2P realtime arena)

Each phase is a testable, demoable increment; the riskiest unknown (P2P + authority + migration)
is tackled **before** lobby polish and juice.

### P0 — Pure-core foundation · `dependsOn: none`
Goal: lift the sim into a deterministic, engine/transport-free core encoding facing, dash, combat,
health, death, and win — fully unit-tested before any renderer/network.

- New pure modules under `src/game/arena/`: `types.ts` (PlayerState, Direction, MatchState, Intent…),
  `intent.ts` (facing = last-moved dir; attack dir locked at initiation), `dash.ts` (4× over 2 m,
  3 s cooldown, `dashCooldownFraction→0..1`), `combat.ts` (1 m reach in facing, −1 health),
  `sim.ts` (`stepWorld(world, intentsById, dt)`), `match.ts` + `countdown.ts`.
- Generalize `isNearNPC → withinRange`; centralize `Vec2`/`InputState` in `types.ts`; extend
  `constants.ts` (`SWORD_REACH_M`, `DASH_*`, `MAX_PLAYERS=8`, `START_HEALTH=3`, `TICK_HZ=20`).

Tracking:
- [x] `types.ts` created; `Vec2`/`InputState` centralized and re-exported from `logic.ts`
- [x] `logic.ts`: `isNearNPC` → `withinRange` (+ `directionVector`); existing tests still green
- [x] `constants.ts` extended (combat/dash/health/tick)
- [x] `intent.ts` + tests (facing-from-last-move, attack-dir lock, edge-triggered)
- [x] `dash.ts` + tests (4× over 2 m, 3 s cooldown, `dashCooldownFraction` 0..1)
- [x] `combat.ts` + tests (1 m reach, facing cone, −1 health, multi-hit)
- [x] `sim.ts` `stepWorld` + tests (movement + dash + combat + death + win); dash-burst & wall bugs fixed
- [x] `match.ts` + `countdown.ts` + tests
- [x] `vitest run` green (61 tests); **no engine/DOM/net imports, no internal clock/RNG** in the core
- [x] adversarial review pass: 2 dash bugs fixed (TDD), 6 coverage gaps closed; #5 (cooldown 3 s + 1 tick) accepted as a benign quantization artifact

### P1 — Single-player render rewrite (Phaser 4, 2.5D look, HUD, audio) · `dependsOn: P0`
Goal: replace the NPC prototype scene with a sim-driven renderer that plays the full mechanics solo.

- `input/keyboard.ts` (WASD/arrows + Shift + Space → InputState); `render/` Phaser scene (tilted
  field, **tinted musa sprites**, ellipse shadows, per-frame `setDepth(worldY)`, facing, ~1 m sword
  on attack, dash FX, death "jump" tween) — owns all px math.
- React HUD overlays: `Hearts.tsx`, `DashIndicator.tsx` (grey→clockwise-fill from `dashCooldownFraction`),
  `Countdown.tsx`; `audio/sfx.ts` (shared `AudioContext`, resume on first gesture, 5 SFX).
- Rework `Arena.tsx` into a phase-driven shell (lobby|countdown|playing|spectate|ended), keeping the
  mount/teardown + dev handle. Delete shopkeeper/ambient/Press-E paths.

Tracking:
- [x] `input/keyboard.ts` input adapter (WASD/arrows + Shift + Space)
- [x] `render/scene.ts` Phaser scene: field + tinted musa + shadows + y-sort + facing
- [x] ~1 m sword sprite renders on attack in locked facing direction
- [x] dash visual + death "jump and disappear" tween
- [x] musa base sprite generated procedurally (no binary asset) + tinted via an 8-color palette
- [x] `Hearts` / `DashIndicator` / `Countdown` HUD overlays bound to state
- [x] `audio/sfx.ts`: shared `AudioContext` + `playTone`/noise + tik/go/dash/attack/hit/gameover/win; resume-on-first-gesture
- [x] `Arena.tsx` phase-driven shell (menu → countdown → playing → ended); **solo slice playable** (move/face/dash/attack/hit/die/win)
- [x] `bot.ts` deterministic enemy AI (added) so the solo slice is fightable; unit-tested
- [x] `arena.astro` + `Arena.tsx` copy updated (dropped shopkeeper/prototype blurb); old `ArenaScene.ts` removed
- [x] verified live in-browser (keyboard→sim→render: move ~4 m/s, facing, dash cooldown, locked-direction attack, death/win), 0 console errors; build green; 66 tests

### P2 — P2P transport + protocol + host-authoritative sync (**riskiest**) · `dependsOn: P1`
Goal: 2+ real peers see each other move/dash/attack/die from one source of truth.

- `net/transport.ts` (+ `LocalTransport` mock), `net/protocol.ts` (versioned, binary-packed:
  hello/roster/kick/start/input/snapshot/event/ping/leave — unit-tested), `net/rtc.ts` (Trystero
  joinRoom, STUN+**TURN**, redundancy + BitTorrent fallback), `net/sync.ts` (host 20 Hz authoritative
  loop; clients input-only @20 Hz; **client-side prediction** for own avatar + **~100 ms interpolation**
  for others; ping/pong clock sync).
- Deterministic **host migration** (host = lowest **alive** id; recompute on `onPeerLeave`, seed from
  last snapshot; dead spectators excluded). Host-side input validation (speed cap, dash cooldown,
  reach, rate-limit).

Tracking:
- [x] `net/transport.ts` interface + in-memory `LocalHub` mock; sim runs multi-"peer" in tests
- [x] `net/protocol.ts` message types + JSON serialize/deserialize unit-tested (round-trip) + `coerceIntent`
- [x] `net/rtc.ts`: Trystero room join (Nostr default; BitTorrent via import path), STUN+TURN via `iceServers`, relay redundancy — typechecks + builds
- [x] `net/sync.ts`: host-authoritative loop, clients send input-only; tick-driven (caller sets the 20 Hz cadence)
- [x] host election (lowest alive id) + deterministic migration on host leave — unit-tested
- [x] dead/spectating players excluded from host election — unit-tested
- [x] host-side input validation: inputs-only design (no positions/health on the wire) + `coerceIntent` + one-input-per-tick overwrite
- [ ] **client-side prediction + ~100 ms interpolation** — deferred to scene integration (P3), to be felt/tuned
- [ ] **wire `SyncEngine` into the Arena scene** (replace local bot loop) — needs the lobby (P4) to gather peers; engine is ready behind `Transport`
- [ ] **2+ real browsers synced; Chrome/Firefox/Safari** — pending MANUAL cross-browser (headless harness can't drive live Nostr/TURN signaling)

### P3 — Networked combat, death, spectate, last-man-standing · `dependsOn: P2`
- Authoritative hit resolution (host owns health); `event` msgs (hit|death|gameover|win) drive
  heart-hollow, death jump + game-over sting, spectate transition, win overlay.
- Spectate (dead player watches, sends no input, can't host); rejoin-by-roomId; reconnect policy.

Tracking:
- [x] host-authoritative hit resolution; health decrements only host-side (host runs `stepWorld`)
- [x] hit/death/gameover/win rendered consistently — each peer derives them by diffing host snapshots (no separate event msgs needed)
- [x] death "jump and disappear" + game-over sting fire on elimination
- [x] spectate mode: dead player keeps rendering snapshots, sends no effective input, can't host
- [x] last-man-standing win detection + result overlay (win/out/draw)
- [x] peer-drop → host marks that player dead so the match resolves; host migration excludes dead/disconnected (unit-tested)
- [x] rejoin-by-roomId: re-opening the link rejoins the room (mid-match → spectator via host's authoritative world)
- [ ] **deeper reconnect edge cases** (host-eliminated-mid-tick desync window, ICE restart) — needs live multi-peer; P5 hardening

### P4 — Warm-up room, party list, join link, synchronized countdown · `dependsOn: P3`
- `lobby.ts` (pure room model: id, players[name,iconColor,isHost], max 8, add/remove/kick, host
  election — unit-tested), `roomLink.ts` (`?room=<id>` build/parse — unit-tested),
  `lobby/WarmupRoom.tsx` (name input, musa color picker, right-side party list + per-player kick,
  copyable join link, host **Start**).
- hello/roster handshake; authoritative roster re-broadcast on join/leave/kick; opening a link joins
  the party; Start → synchronized 3 s **tik-tok** countdown → match on all peers.

Tracking:
- [x] `lobby.ts` reducers (room, players, max-8, add/remove/kick, host election) unit-tested
- [x] `roomLink.ts` build/parse/mint unit-tested
- [x] `WarmupRoom.tsx`: name input + musa color picker (8 swatches) + party list + kick + copy link + Start
- [x] presence handshake: `hello` on join + reply-on-first-sight so rosters converge (any join order) — unit-tested
- [x] opening a join link joins the party (`?room=`); max-8 enforced in `lobby.upsert`
- [x] kick removes a player (host) and they leave the room
- [x] host Start → `start` payload (ordered players + bots) → synchronized 3 s tik-tok countdown → match on all peers (unit-tested via LocalHub)
- [x] bonus: `Practice vs bots` (SoloDriver) for single-browser play; host can add bots to a real match

### P5 — Juice, hardening, cross-browser, ship · `dependsOn: P4`
- Final juice (dash sweep, heart fill, sword arc, interpolation tuning); resilience (TURN-path
  verification, relay-flakiness UI, host-migration stress, reconnection); cross-browser; bundle/build
  check under vite 6.4.3 + `@wix/astro`; document residual malicious-host risk; update site copy.

Tracking:
- [ ] dash sweep / heart fill / sword / death juice finalized
- [ ] TURN verified for a symmetric-NAT/CGNAT client; player can join
- [ ] relay-flakiness handling (redundancy + fallback + "connecting…" UI) verified
- [ ] host-migration stress + reconnection edge cases pass
- [ ] verified on Chrome, Firefox, Safari (gameplay + audio autoplay)
- [ ] builds + deploys on Wix static (vite 6.4.3 + Astro 5.8 + Wix adapter)
- [ ] residual malicious-host risk documented
- [ ] `index.astro` / `arena.astro` copy updated to "live multiplayer"

---

## Track A — post-ship expansion (feel · customization · modes · arenas · mutators)

Net-new content on top of the shipped arena. Ordered by risk/dependency; all assume a working
multiplayer base (P3+/P4). **Invariant carried from P0:** the sim core stays engine/transport-free
and **deterministic** — any new randomness (maze layout, powerup spawns) is produced on the **host**
from a **seed broadcast in `start`** and injected into the core, never read from a clock/`Math.random()`
inside it. Player customization (shape, avatar image) is **cosmetic only** and must **not** enter the
sim core. (Each feature has a stable id `F1…F7` for cross-referencing.)

### P6 — Lobby feel & death juice · `dependsOn: P4 (lobby), P1 (death tween)`
Goal: cheap, high-value feel wins — audible lobby presence and a readable death moment.

- **F1 — connect sound:** add a `"join"` `SfxName` to `audio/sfx.ts` (short rising two-tone via the
  existing `tone()`), fired from `Arena.tsx` when a **new remote** peer appears. The host already
  detects newcomers in `session.ts onMessage` `"hello"` (`isNew`, session.ts:177) — surface it as a new
  `ArenaEvent` (`{ type: "join" }` in `render/contract.ts`) or diff roster length on `onChange`. Don't
  play for your own join or bots. `resume()` unlocks audio on the Start click today; a join sound heard
  *in the lobby* needs an earlier unlock (first lobby gesture).
- **F2 — death animation:** the death "jump and disappear" tween already exists (P1/P3) — this *enhances*
  it, not net-new. Add a pop/spin on death then a **phase-out** (alpha fade + scale-down), driven by the
  `status: "alive"→"dead"` transition each peer already derives from snapshots. Render-only, lives entirely
  in `render/scene.ts`; reuse the existing `{ type: "death" }` event + gameover sting.

Tracking:
- [x] `joinedIds(prev,next,self)` pure helper in `lobby.ts` (excludes self; bots aren't in the lobby roster) — unit-tested (4 tests)
- [x] `"join"` SFX in `sfx.ts` (two-note rise); `Arena.tsx` roster-diff effect plays it once per new remote
- [x] lobby audio-unlock: first `pointerdown`/`keydown` calls `sfx.resume()` so the chime is audible pre-match
- [x] death tween upgraded (recoil pop → spin-up + alpha phase-out) in `scene.ts:playDeath`, render-only & per-peer
- [ ] **live playtest** the chime + death animation in-browser (audio/visual — not covered by unit tests)
- known nuance (deferred): a newcomer hears one chime per existing peer as the roster converges; refine to suppress the initial-population burst if it feels noisy

### P7 — Player customization: shapes & uploaded avatars · `dependsOn: P4`
Goal: let a player personalize their musa (pick a shape **or** upload an image) and have every peer
render it. **Cosmetic only — never enters the sim core** (determinism preserved).

- **F3 — shape selection:** extend `PlayerMeta` (`render/contract.ts`) with `shape` and carry it on the
  wire — add `shape` to `hello` + `StartPlayer`/`RosterEntry` in `protocol.ts`, thread through
  `session.ts` (`profile`/`meta`/roster) and `lobby.ts`. Add a shape picker beside the color swatches in
  `WarmupRoom.tsx` (e.g. circle / square / triangle / diamond / hex). `render/scene.ts` draws the chosen
  shape as the body, reusing the per-color tint pipeline (procedural, no assets).
- **F4 — custom image avatar (decided: Wix Media CDN + login).** **Requires sign-in** — adds **Google
  (Gmail) login** as the identity so avatars *and future player data* (stats, currency, unlocks) link to a
  durable account, not an ephemeral peer id. This pulls **Track B W0 (auth) forward** as F4's dependency.
  Flow: file input in `WarmupRoom.tsx` (jpg/png) → client-side **resize + center-crop to a square** (~256×256)
  via an offscreen `<canvas>` → **upload to Wix Media** (server route with elevated app creds, since P2P
  clients can't be trusted writers) → store the **CDN URL** on the member profile. Only the **URL** goes on
  the wire (in `hello`/`StartPlayer`); `render/scene.ts` loads it as a Phaser texture keyed by player id and
  maps it onto the body, falling back to shape/tint when absent or still loading. (Small payload on the wire,
  no relay-budget risk; avatars persist across sessions because they're tied to the account.)

Tracking:
- [x] new pure `arena/cosmetic.ts` (`Shape`, `SHAPES`, `DEFAULT_SHAPE`, `coerceShape` wire-boundary) — unit-tested; leaf module, no inward-dep violation
- [x] `PlayerMeta` + protocol (`hello`/`start`/`roster`) carry `shape`; `lobby.ts`/`session.ts`/`soloDriver.ts` thread it (bots default; `coerceShape` on receive)
- [x] shape picker in `WarmupRoom` (4 shapes: circle/square/triangle/diamond) + per-shape procedural body textures in `render/scene.ts`
- [ ] **live playtest** shapes render + sync across peers
- [ ] _(F4, deferred)_ **Google (Gmail) login** wired (via Track B W0); identity persists across sessions
- [ ] avatar upload → canvas resize + center-crop to a square (~256×256)
- [ ] server route uploads to **Wix Media**; **CDN URL** stored on the member profile (server-only writer)
- [ ] avatar **URL** carried on the wire (`hello`/`start`); `render/scene.ts` applies texture per id; falls back to shape/tint; **cosmetic-only** (no sim-core change)

### P8 — Rounds & podium scoreboard · `dependsOn: P3`
Goal: best-of-N matches with a between-rounds reset and a final 1-2-3 podium.

- **F5 — rounds:** round-count selector in `WarmupRoom.tsx` (like the bots `<select>`); carry `rounds` in
  the `start` message so all peers agree. **Host-authoritative lifecycle:** track per-player round wins;
  on a round's last-man-standing, host records the winner and — if rounds remain — re-spawns via
  `createWorld(evenSpawns(...))` and re-runs the 3 s countdown (reuse `match.ts`/`countdown.ts`); after the
  final round, end. **Tie-break:** if the final standings tie for a **podium place** (esp. 1st), play
  **sudden-death extra round(s)** among the tied players until that place is decided. Extend `MatchPhase`
  with `"intermission"` (between rounds) and `"scoreboard"`, and
  carry a host-owned `standings`/`roundIndex` in `snapshot` (or an `event`) so every peer agrees.
  **Podium UI:** a React `Podium.tsx` over the canvas — 1st/2nd/3rd pedestals, each winner's tinted musa
  (with their shape/avatar) on the step and their **nickname above** (reuse `getMeta`); ties / fewer-than-3
  handled gracefully.

Tracking:
- [ ] round-count selector in `WarmupRoom`; `rounds` carried in `start`
- [ ] host tallies round wins; between-round reset + re-countdown; match ends after final round
- [ ] standings synced to all peers; `MatchPhase` extended (`intermission`/`scoreboard`)
- [ ] `Podium` overlay: 1st/2nd/3rd pedestals, musa per place, nickname above; ties handled
- [ ] tie-for-podium → sudden-death extra round(s) among the tied players — unit-tested
- [ ] sim-core round logic (win tally, reset, end-after-N, tie-break) unit-tested — pure, no clock/RNG

### P9 — Arena types: auto-generated labyrinth · `dependsOn: P3`
Goal: an arena-type selector; first type is an auto-generated maze with 3 m-wide, fully-interconnected
corridors.

- **F6 — labyrinth:** arena-type selector in `WarmupRoom.tsx` (`open` | `labyrinth`); carry `arena` + a
  maze **seed** in `start`. **Generation (host, deterministic):** host runs a ready perfect-maze
  algorithm — **recursive backtracker (randomized DFS)** or randomized Prim's — yielding a fully-connected
  maze (a path between any two cells); broadcast the **seed** (and/or the wall grid) so every peer rebuilds
  the identical maze with no in-core RNG. Grid sized to the 30 m field at **3 m cells** (~10×10), walls as
  thin segments between cells; optionally knock out a few extra walls for loops. **Sim:** today `sim.ts`
  only clamps to field bounds — add **wall collision** (segment/AABB vs. `FIGURE_RADIUS_M`) so movement
  *and the dash burst* respect corridors; walls live as pure data in the `World` (or a static `Arena`
  passed alongside). Spawns must land in open cells (adjust `evenSpawns`). **Render & bots:**
  `render/scene.ts` draws the walls (2.5D look); `bot.ts` needs maze-aware navigation (BFS/A* through open
  cells) instead of straight-line chase.

Tracking:
- [ ] arena-type selector in `WarmupRoom`; `arena` + `seed` in `start`
- [ ] seeded maze generator (recursive-backtracker/Prim's), 3 m cells over the 30 m field — pure + unit-tested (same seed → same maze; connectivity assertion)
- [ ] walls in `World`/`Arena` data; `sim.ts` wall collision for movement + dash (radius-aware) — unit-tested
- [ ] spawns placed in open cells; walls drawn in `render/scene.ts` (2.5D)
- [ ] `bot.ts` maze-aware pathfinding (BFS/A*) so bots don't wall-hug

### P10 — Mutators: haste powerups · `dependsOn: P3`
Goal: opt-in gameplay modifiers toggled in the lobby; first mutator spawns powerups that double a
picker's action rate.

- **F7 — powerup mutator:** mutator **checkbox list** in `WarmupRoom.tsx`; carry the enabled `mutators`
  set in `start`. When enabled, the **host** spawns powerup pickups at **seeded** positions/times (seed in
  `start`, same pattern as the maze). Model pickups as pure data in the `World`
  (`powerups: { id, pos, … }[]`). In `sim.ts`, on overlap (player radius vs. pickup) grant a **"haste"
  buff** — halve the player's **attack** and **dash** cooldowns (`ATTACK_COOLDOWN_S` / `DASH_COOLDOWN_S`
  × 0.5) so both fire **twice as often**; add `buffs`/`hasteRemaining` to `PlayerState` and apply the
  multiplier where cooldowns are set in `combat.ts`/`dash.ts`/`sim.ts`. Timed-vs-permanent is an Open
  decision. **Render:** an **animated** powerup object (bob/spin/glow, procedural) + a buff indicator on
  the buffed musa; new pickup SFX in `sfx.ts`. (This is the first of an open-ended mutator set.)

Tracking:
- [ ] mutator checkboxes in `WarmupRoom`; enabled `mutators` carried in `start`
- [ ] `World.powerups` + seeded host spawns (seed in `start`); pickup overlap in `sim.ts` — pure + unit-tested
- [ ] haste buff: per-player attack + dash cooldown ×0.5 (`PlayerState.buffs`/`hasteRemaining`); duration decided — unit-tested
- [ ] animated powerup + buff indicator in `render/scene.ts`; pickup SFX in `sfx.ts`

### P11 — Free-aim combat (mouse aim) · `dependsOn: P3`
Goal: decouple aim from movement — **keys move, the mouse aims the weapon** — so you can run one way
and strike another. (Foundational for P12 weapons.)

- **F8 — mouse aim.** Today facing is **4-way**, derived from the last-moved direction
  (`intent.ts nextFacing`) and combat fires a cone around that cardinal (`combat.ts inAttackCone` via
  `directionVector`). Replace the *attack/weapon* aim with a **continuous angle**: add `aim` (radians or a
  unit `Vec2`) to `RawInput` + `Intent`; `coerceIntent` (`protocol.ts`) clamps it to a finite, normalized
  value (host trust boundary — same place `facing` is sanitized). Generalize `inAttackCone`/`resolveAttack`
  to take an **aim vector** instead of a cardinal `Direction`.
- **Input adapter:** the renderer knows each player's screen position, so it computes the angle from the
  local player to the pointer and feeds it into `RawInput` (new `input/mouse.ts`, alongside
  `input/keyboard.ts`). The musa **body** can still snap to the nearest cardinal `Direction` for the sprite
  while the **weapon** rotates freely to `aim`.
- **Render:** weapon rotates to the aim angle, projected through `Y_SCALE` (same fix as the sword). No-mouse
  / touch fallback is an Open decision.

Tracking:
- [x] `aim?` added to `RawInput`/`Intent` (optional → falls back to facing); `PlayerState.aim` + `AttackState.aim`; `coerceIntent` finite-checks it (host trust boundary) — unit-tested
- [x] `directionAngle`/`aimVector` geometry helpers in `logic.ts` — unit-tested
- [x] `combat.ts` cone generalized from cardinal `Direction` → aim angle; `sim.ts` locks aim into the swing + knockback along aim — unit-tested (off-axis hit/miss + full-step off-axis attack)
- [x] `input/mouse.ts`: pure `screenDeltaToWorldAngle` (un-projects the y-squash) — unit-tested; `scene.ts` injects pointer aim into `RawInput` each frame
- [x] `render/scene.ts` sweeps the weapon around `attack.aim` (Y-projected); body still faces movement; cooldown/feel preserved
- [x] no-mouse fallback: aim defaults to the movement-facing angle (keyboard-only still attacks where you face) — Open decision #11
- [x] `bot.ts` aims at its target so bot attacks land under aim-based combat
- [ ] **live playtest**: mouse aim feels right across the 2.5D field; aim syncs to other peers via snapshot
- [ ] richer touch/twin-stick fallback (deferred — basic facing fallback ships now)

### P12 — Weapon types: sword · spear · knife · bow · `dependsOn: P11`
Goal: pick a weapon in the lobby; each trades reach / arc / speed — and the **bow** trades melee for
**ranged** fire.

- **F9 — weapons.** Add a `weapon` to player identity (loadout): extend `PlayerMeta` + carry on the wire
  (`hello`/`StartPlayer`), thread `session.ts`/`lobby.ts`; weapon picker in `WarmupRoom.tsx`. Define
  per-weapon stats in `constants.ts`. **Melee (cone):** **sword** (today: reach 2 m, 90° cone, 1 s),
  **spear** (longer reach ~3–3.5 m, narrow cone, slower cooldown, bigger knockback), **knife** (short ~1 m,
  fast cooldown, small knockback) — `combat.ts resolveAttack` already accepts `reach`/`halfAngle`, so extend
  it to read the attacker's weapon stats (incl. per-weapon cooldown/knockback).
- **Ranged — bow (the first non-melee weapon):** instead of an instant cone, it **fires an arrow projectile**
  along the `aim` (pairs directly with P11 free-aim). This needs a **projectile system in the sim core** —
  add `projectiles: { id, ownerId, pos, vel, … }[]` to the `World` (pure data), step them in `sim.ts` each
  tick (advance by `vel·dt`, expire on range/wall, resolve a hit = −1 health on first overlap with an *enemy*
  body), all deterministic. Reuses the team check from co-op (P13) for friendly fire. `PlayerState` carries
  the equipped weapon.
- **Render:** distinct (procedural) weapon sprites drawn/animated along the aim, **plus in-flight arrow
  sprites for the bow**; weapon-specific SFX in `sfx.ts` (bow draw / release / impact). A balance pass is
  expected (Open decision).

Tracking:
- [x] new pure `arena/weapons.ts` (`Weapon`, `WEAPONS` stats, `coerceWeapon`); sword references legacy constants so it's byte-identical to today — unit-tested
- [x] `PlayerState.weapon` (sim-relevant) + `SpawnSpec`/`createPlayer`; threaded through `lobby`/protocol (`hello`/`start`/`roster`)/`session` (incl. `beginMatch` zips weapon into spawns); picker in `WarmupRoom` (melee)
- [x] `sim.ts` uses the attacker's weapon stats (reach/cone/cooldown/knockback) — unit-tested (spear reaches 3 m, knife can't); `render/scene.ts` blade length/arc per weapon
- [ ] _(bow slice)_ **`World.projectiles` + `sim.ts` step/expire/hit for the bow arrow (deterministic, team-aware)** — unit-tested; add bow to picker; snapshot carries projectiles
- [ ] _(bow slice)_ in-flight arrow sprites + bow draw/release/impact SFX
- [ ] **live playtest** + balance pass (sword/spear/knife feel; then bow)

### P13 — Co-op mode: players vs bots · `dependsOn: P3 (+ rounds P8 optional)`
Goal: a cooperative mode — all humans are **allies** versus a **team of bots** that fight together;
players spawn together in the middle.

- **F10 — co-op.** Add a `mode` (`ffa` | `coop`) selector in `WarmupRoom.tsx`, carried in `start`.
  Introduce a **team** concept — add `team` to `PlayerState` (humans vs. bots in co-op; FFA keeps everyone
  solo). **No friendly fire:** `combat.ts resolveAttack` skips same-team targets. **Win/lose is
  team-based:** `match.ts` win detection becomes mode-aware — players win when all bots die, lose when all
  players die (replaces the FFA `soleSurvivor` rule). **Spawns:** players cluster at field center, bots ring
  the edge (new spawn spec alongside `evenSpawns`).
- **Bot AI:** `bot.ts` targets the nearest **enemy** (player) and the bot team pressures together;
  difficulty scaling is an Open decision. Pairs naturally with **rounds (P8)** as survival waves.

Tracking:
- [ ] `mode` (`ffa`|`coop`) selector in `WarmupRoom`; carried in `start`
- [ ] `team` on `PlayerState`; `combat.ts` skips same-team targets (no friendly fire) — unit-tested
- [ ] mode-aware win/lose in `match.ts` (players-vs-bots) — unit-tested (FFA path unchanged)
- [ ] center-cluster player spawns + edge bot spawns (new spawn spec)
- [ ] `bot.ts` enemy-targeting + team coordination; difficulty scaling decided

---

## Track B — Wix Headless backend (persistence, accounts, economy) · `dependsOn: A/P3+`

Goal: persist identity, stats, and currency, and feed the shop-keeper real inventory — using
**trusted Astro server API routes** (run on Wix infra with elevated app creds), since the P2P clients
can't be trusted writers.

- **W0 — Auth & profile:** **Google (Gmail) sign-in** via Wix Members social login (decided 2026-06-22 —
  see F4); player name/musa color **and avatar CDN URL** stored on the member/profile; lobby reads identity
  from the logged-in member. This is the account that **F4 avatars and all future player data** attach to,
  so it is now a **dependency of F4 (P7)**, not only Track B.
- **W1 — Data model & write path:** Wix Data collections `Players`, `Matches`, `Items`, `Shops`,
  `Transactions` with **PRIVILEGED**-write permissions; an API route `POST /api/match-result` where the
  **host reports the result**, the server validates (sanity bounds) and writes stats/currency — the
  only writer of balances (clients can't write directly).
- **W2 — Economy & shop-keeper:** shop-keeper inventory from `@wix/stores`/`Items`; spend in-game
  currency (server-validated); optional real-money currency top-ups via existing `@wix/ecom` checkout
  path; Wix dashboard CMS as the free backoffice.

Tracking:
- [ ] members log in; identity flows into the lobby
- [ ] collections created with PRIVILEGED write permissions
- [ ] `POST /api/match-result` validates + persists stats/currency (server-only writer)
- [ ] shop-keeper reads live items; spending currency is server-validated
- [ ] (optional) real-money top-ups via `@wix/ecom`
- **Open risk:** a cheating host can still mis-report results — acceptable for casual play; add server sanity checks.

---

## Track C — Turn-based game #2 · `dependsOn: A/P0 (reuses core patterns)`

Goal: the pack's second game, reusing the architecture spine (pure core + Transport + Phaser render +
React shell). Turn-based suits P2P far better (no tick-rate/latency pressure; tolerates the
flaky-relay window).

- **T0 — Concept lock:** pick the turn-based game (brainstorm) and define its pure rules core.
- **T1 — Build:** pure rules + `LocalTransport` tests → Phaser/React render → Trystero turn exchange
  (reuse the lobby/room/join-link/kick infra from Track A, generalized) → ship; replace the
  "Tactics — Coming soon" card on `index.astro`.

Tracking:
- [ ] game chosen + rules core unit-tested
- [ ] networked turns over Trystero (reusing lobby infra)
- [ ] live on the start page (replaces "Coming soon")

---

## Module map (where code lands)

- **Pure core (unit-tested):** `src/game/arena/{types,intent,dash,combat,sim,match,countdown,lobby,roomLink}.ts`
  (+ existing `logic.ts`, `constants.ts`), `src/game/net/protocol.ts`.
- **Adapters (impure, integration/manual):** `src/game/arena/render/` (Phaser scene),
  `src/game/arena/input/keyboard.ts`, `src/game/net/{transport,rtc,sync}.ts`, `src/game/audio/sfx.ts`.
- **React UI:** `src/components/game/Arena.tsx` (shell), `src/components/game/lobby/WarmupRoom.tsx`,
  `src/components/game/hud/{Hearts,DashIndicator,Countdown}.tsx`.
- **Post-ship expansion (planned):** pure core — `src/game/arena/maze.ts` (seeded generator + connectivity),
  powerups/buffs in `sim.ts`/`types.ts`, round tally + co-op spawns/win-rules in `match.ts`, weapon stats in
  `constants.ts`, aim + team + bow projectiles on `types.ts`/`sim.ts`; impure — `src/game/arena/input/mouse.ts` (pointer→aim); UI —
  `src/components/game/scoreboard/Podium.tsx`; extended — `WarmupRoom.tsx`
  (shape/arena/rounds/mutator/weapon/mode/upload controls), `render/scene.ts`, `protocol.ts`, `sfx.ts`,
  `bot.ts` (maze + enemy targeting). Auth/avatar (F4): Wix Members Google login + a server route to Wix Media.
- **Server (Track B):** `src/pages/api/match-result.ts` etc.
- **Assets:** one base musa sprite under `public/` (runtime-tinted to 8 colors).
- **Keep untouched:** Astro site chrome (`layout/`, `footer`, `navbar`), the vite 6.4.3 override.

## Open decisions (recommendation in **bold**)

1. Trystero signaling: **Nostr + BitTorrent fallback, redundancy on** / Firebase-Supabase / self-hosted WS.
2. TURN provider: **Metered Open Relay free tier** now → Cloudflare Realtime TURN at scale.
3. Host election: **lowest alive peer id** (deterministic) / lowest-aggregate-RTT (only if lag complaints).
4. Eliminated player who refreshes: **returns as spectator only** / can't rejoin / revive.
5. Turn-based game #2 identity (Track C) — pick via a short brainstorm before T0.
6. Custom-avatar transport (F4): **DECIDED (2026-06-22) — Wix Media CDN URL on the wire, gated on Google (Gmail) login** (avatars + future player data link to the account). Supersedes the earlier P2P-blob option.
7. Maze algorithm (F6): **recursive backtracker (randomized DFS)**, seed broadcast in `start` / randomized Prim's / Eller's; add loops by knocking out a few extra walls.
8. Haste-powerup buff model (F7): **DECIDED (2026-06-22) — timed (~8 s, cooldowns ×0.5)** (not permanent/stacking).
9. Rounds default (F5): **DECIDED (2026-06-22) — best-of-3; a tie for a podium place → sudden-death extra round(s)** until decided.
10. Identity/auth provider (F4 + Track B W0): **DECIDED (2026-06-22) — Google (Gmail) sign-in** (via Wix Members social login) as the account players' avatars + data attach to.
11. No-mouse / touch fallback for free-aim (F8/P11): **DECIDED (2026-07-06) — aim falls back to the movement-facing angle** when no pointer aim is present (keyboard-only plays as before). Richer twin-stick/drag-to-aim deferred.
12. Weapon balance (F9/P12): start at sword 2 m·90°·1 s / spear ~3.5 m·narrow·slower / knife ~1 m·fast / **bow** ranged (arrow ~12 m/s, ~15 m range, slow draw, little/no knockback) — **tune in playtest**.
13. Co-op difficulty (F10/P13): **fixed bot count** / escalating waves (pairs with rounds) / scales with player count — **decide at P13**.

## Risks (carry into every phase)

- **TURN is non-negotiable** from P2 or strict-NAT users silently fail to join.
- Mesh ceiling ~10 peers — cap **strictly at 8**, tear down kicked/left connections.
- Flaky public relays affect only the initial handshake — mitigate with redundancy + fallback + a "connecting…" state.
- Cross-browser WebRTC/audio quirks (Firefox lag, Safari/iOS autoplay) — test all three.
- Malicious host can cheat/see hidden state (inherent to host-authoritative P2P) — documented, acceptable for casual play.
- **Determinism leak:** the old `ArenaScene` uses `Math.random` for wanderers — that must **not** enter the sim core.
  The expansion **re-arms this risk** (maze + powerup spawns): generate on the host from a **seed broadcast in `start`** and inject it — never `Math.random()`/clocks inside the core.
- **Avatar payloads (F4):** uncapped uploads can blow the relay/handshake budget — resize/crop client-side and cap (≤~8 KB); validate type/size; treat as untrusted cosmetic data (no sim effect).
- New deps must build under **vite 6.4.3 + Astro 5.8 + `@wix/astro`** on static hosting.

---

## Progress log

- **2026-07-06** — **Implementation started (P6, P7-F3, P11 landed).** **P6:** pure `joinedIds` connect-sound
  detection + `"join"` SFX + first-gesture audio unlock; two-phase death tween (recoil → spin-up phase-out).
  **P7-F3:** new pure `arena/cosmetic.ts` (`Shape` + `coerceShape` wire-boundary), threaded shape through
  `PlayerMeta`/protocol/`lobby`/`session`/`soloDriver`; 4-shape picker in `WarmupRoom` + per-shape procedural
  body textures. **P11 (free-aim, core change):** `Intent`/`RawInput` gain optional `aim` (falls back to
  facing), `PlayerState.aim` + `AttackState.aim`; `combat.inAttackCone` + `sim` knockback now aim-vector based
  (facing kept for the body); `directionAngle`/`aimVector` helpers; pure `input/mouse.screenDeltaToWorldAngle`
  (un-projects the 2.5D y-squash); scene injects pointer aim + sweeps the blade around the locked aim; bots aim
  at their target; `coerceIntent` finite-checks aim. TDD throughout (+16 unit tests → **112 total**), `tsc`
  clean (caught a latent Phaser-typings bug in the F3 diamond shape), build green. **Pending:** live in-browser
  playtest of audio/visual + peer sync (headless can't drive it). Decisions locked: #11 no-mouse aim fallback.
- **2026-06-22** — **Expansion round 2 + decisions locked.** Locked F4 → **Wix Media CDN avatars gated on
  Google (Gmail) login** (avatars + future player data attach to the account; pulls Track B W0 auth forward
  and sets the provider to Google), F7 → **timed** haste, F5 → **best-of-3 with a sudden-death extra round
  to break a podium-place tie**. Added three new Track A features: **P11** free-aim combat (F8 — keys move,
  mouse aims; `Intent.facing` 4-way → continuous `aim`, combat cone generalized to an aim vector), **P12**
  weapon types (F9 — sword/spear/knife + **bow** loadout; melee uses the existing cone (`resolveAttack`
  already param'd), bow is the first **ranged** weapon → adds a deterministic `World.projectiles` system in
  `sim.ts`), **P13** co-op mode (F10 — humans vs. a bot team, no friendly
  fire, team-based win/lose, players spawn center). Updated Track B W0 (Google login), Module map, and
  3 new Open decisions (11–13). Planning only — no feature code yet.
- **2026-06-22** — **Lobby tuning + roadmap expanded.** Shipped a `WarmupRoom` pass (default 2 bots that
  clear when a 2nd player joins; Start gated at ≥2 participants with a hover hint; removed the redundant
  "Practice vs bots" button — `SoloDriver` core kept for future re-exposure). Added **post-ship Track A
  expansion** phases: **P6** lobby feel & death juice (F1 connect sound, F2 death phase-out), **P7** player
  customization (F3 shapes, F4 uploaded image avatars — cosmetic-only), **P8** rounds & podium scoreboard
  (F5), **P9** arena types / auto-generated labyrinth (F6), **P10** mutators / haste powerups (F7). Maze +
  powerup randomness routed through host-seeded `start` broadcast to keep the sim core deterministic; 4 new
  open decisions + 2 risks logged. Planning only — no feature code yet.
- **2026-06-18** — Roadmap created. Arena 2D single-player prototype shipped & deployed.
- **2026-06-18** — **P0 complete.** Pure sim core landed (`types`, `intent`, `dash`, `combat`,
  `sim`, `match`, `countdown` + generalized `logic`), 61 unit tests, project builds. Adversarial
  review found & TDD-fixed 2 real dash bugs (2 m overshoot; dashing-into-wall freeze) and closed
  6 coverage gaps. Core is engine/transport-free with injected `dt` (no clocks/RNG).
- **2026-06-18** — **P1 complete.** Sim-driven Phaser 4 renderer (fake-2.5D: y-sort, tilted floor,
  shadows, death-jump tween, procedural tinted musa, locked-direction sword); React HUD
  (hearts / dash sweep / countdown); Web Audio SFX; deterministic `bot.ts` for solo play; phase-driven
  `Arena.tsx` shell. 66 tests, build green, verified live in-browser.
- **2026-06-18** — **P1 balance pass** (user feedback): added a **1 s attack cooldown** (`ATTACK_COOLDOWN_S`,
  gated in `sim.ts`, shown via a new HUD attack badge — `CooldownBadge` reused for dash + attack) and
  **1 m knockback** away from the attacker on a hit (`KNOCKBACK_M`, clamped to field). TDD: 3 new sim
  tests (cooldown gating, knockback, knockback clamp). 69 tests, build green, verified live.
- **2026-06-19** — **2.5D sword projection fix** (user feedback: up/down attacks felt like misses). The sim
  hit cone is symmetric in world space (added up/down combat tests to prove it), but the sword sprite was
  drawn un-projected while the field is vertically foreshortened (`Y_SCALE`), so pointing up/down it visually
  over-reached and players mis-aimed. Fix: project the sword swing onto the ground plane (y × `Y_SCALE`) so its
  on-screen reach matches the real reach in every direction. Build green; live-verified up-attack hits.
- **2026-06-18** — **Combat feel pass 2** (user feedback): unified the figure size so the drawn musa ==
  the physical body (`FIGURE_M` 0.5 → 1.5; `VIS_R` derived from `FIGURE_RADIUS_M`), so hit detection now
  covers the **whole body** (`resolveAttack` uses `reach + FIGURE_RADIUS_M`, not center-only). Sword sprite
  now **pivots at the player and sweeps the 90° cone** during a swing (animated by attack TTL), so the
  visual traces the actual hit area. TDD: combat "hits the whole body" test. 97 tests, build green;
  live-verified (hit at 2.5 m + sword sweep ~90°, 0 console errors).
- **2026-06-18** — **Combat balance pass** (user feedback): attack reach now matches the sword image
  (`SWORD_REACH_M` 1 → 2 m; the sword sprite geometry is derived from the constant so image == hit range),
  and knockback bumped to `reach + 1` (= 3 m, `KNOCKBACK_M` derived). TDD: new combat tests (1.8 m hits;
  `KNOCKBACK_M === SWORD_REACH_M + 1`). 96 tests, build green; live-confirmed the 1.8 m hit in practice.
- **2026-06-18** — **P3 + P4 complete (wired & locally playable).** Built the netplay `Session` (roster
  presence, host election, Start→countdown→match), wired the host-authoritative `SyncEngine` into a
  driver-agnostic renderer (`MatchDriver`: net `Session` or `SoloDriver`), and the `WarmupRoom` UI
  (name, 8-color musa picker, party list + kick, copyable `?room=` join link, Start + bots). Combat/
  death/win render on every peer by diffing host snapshots; peer-drop marks players dead; rematch +
  back-to-room. **94 tests** (full lobby→start→play + bot + migration + peer-drop flows under `LocalHub`),
  type-clean, build green. Browser-verified: lobby + room-link + Practice (move/attack/4 players, 0 errors);
  Trystero P2P confirmed connecting (incidental ghost-peer synced match). **Manual TODO:** real 2-browser
  cross-machine playtest + TURN for strict-NAT (P5). Next: **P5** polish/hardening + live cross-browser.
- **2026-06-18** — **P2 net engine complete (under LocalHub).** Built `net/{transport,protocol,election,sync}`
  + Trystero adapter `net/rtc.ts` (installed `trystero`). Host-authoritative sync: clients send inputs-only,
  host runs `stepWorld` + broadcasts snapshots; deterministic host election + migration (lowest alive id);
  `coerceIntent` anti-cheat boundary. **84 tests** (15 new net tests, all green via in-memory multi-peer
  `LocalHub`), `net/*` type-clean, build green. **Remaining for P2:** prediction/interpolation polish, wiring
  the engine into the scene (with P4 lobby), and manual cross-browser real-peer verification (needs live
  relays/2 machines — can't be driven headlessly). Next: **P3** (networked combat/match) — likely paired with P4 lobby to enable real-peer testing.
