import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ArenaScene,
  type ArenaConfig,
} from "../../game/arena/render/scene";
import type { ArenaEvent, HudState, MatchDriver } from "../../game/arena/render/contract";
import { Session } from "../../game/net/session";
import { SoloDriver } from "../../game/arena/soloDriver";
import { buildJoinUrl, mintRoomId, parseRoomId } from "../../game/net/roomLink";
import { joinedIds } from "../../game/net/lobby";
import { Sfx } from "../../game/audio/sfx";
import type { PlayerId } from "../../game/arena/types";
import { DEFAULT_SHAPE, type Shape } from "../../game/arena/cosmetic";
import { DEFAULT_WEAPON, type Weapon } from "../../game/arena/weapons";
import WarmupRoom from "./lobby/WarmupRoom";
import Hearts from "./hud/Hearts";
import CooldownBadge from "./hud/CooldownBadge";
import Countdown from "./hud/Countdown";

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const FRESH_HUD: HudState = { countdown: 3, health: 3, dashFraction: 1, attackFraction: 1, alive: true };

/**
 * Arena island: warm-up room (lobby) → countdown → host-authoritative match → result.
 * The renderer scene is fed a MatchDriver — the netplay Session for multiplayer, or a
 * SoloDriver for practice — so the same canvas serves both.
 */
export default function Arena() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sfxRef = useRef<Sfx>(new Sfx());
  const sessionRef = useRef<Session | null>(null);
  const activeDriverRef = useRef<MatchDriver | null>(null);
  const lastHud = useRef<HudState | null>(null);
  const lastBotCount = useRef(0);
  const nameRef = useRef("Player");
  const colorRef = useRef(0);
  const shapeRef = useRef<Shape>(DEFAULT_SHAPE);
  const weaponRef = useRef<Weapon>(DEFAULT_WEAPON);

  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [ready, setReady] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("Player");
  const [colorIndex, setColorIndex] = useState(0);
  const [shape, setShape] = useState<Shape>(DEFAULT_SHAPE);
  const [weapon, setWeapon] = useState<Weapon>(DEFAULT_WEAPON);
  const [practiceDriver, setPracticeDriver] = useState<SoloDriver | null>(null);
  const [practiceEpoch, setPracticeEpoch] = useState(0);
  const [hud, setHud] = useState<HudState>(FRESH_HUD);
  const [result, setResult] = useState<{ winnerId: PlayerId | null } | null>(null);

  // --- create transport + session once (client only) ---
  useEffect(() => {
    let cancelled = false;
    let session: Session | null = null;
    (async () => {
      const existing = parseRoomId(window.location.search);
      const id = existing ?? mintRoomId();
      if (!existing) {
        window.history.replaceState(null, "", buildJoinUrl(window.location.origin, window.location.pathname, id));
      }
      setRoomId(id);
      const { createRtcTransport } = await import("../../game/net/rtc"); // client-only (WebRTC)
      if (cancelled) return;
      const transport = createRtcTransport({ roomId: id, iceServers: DEFAULT_ICE });
      session = new Session({ transport, name: nameRef.current, iconColor: colorRef.current, shape: shapeRef.current, weapon: weaponRef.current, onChange: bump });
      sessionRef.current = session;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      session?.leave();
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [bump]);

  const onHud = useCallback((h: HudState) => {
    const p = lastHud.current;
    if (
      !p ||
      p.countdown !== h.countdown ||
      p.health !== h.health ||
      p.alive !== h.alive ||
      Math.abs(p.dashFraction - h.dashFraction) >= 0.02 ||
      Math.abs(p.attackFraction - h.attackFraction) >= 0.02
    ) {
      lastHud.current = h;
      setHud(h);
    }
  }, []);

  const onEvent = useCallback((e: ArenaEvent) => {
    const s = sfxRef.current;
    if (e.type === "tik") s.play("tik");
    else if (e.type === "go") s.play("go");
    else if (e.type === "dash") s.play("dash");
    else if (e.type === "attack") s.play("attack");
    else if (e.type === "hit") s.play("hit");
    else if (e.type === "death" && e.local) s.play("gameover");
  }, []);

  // --- (re)create the Phaser game whenever the active match changes ---
  const sessionState = ready ? sessionRef.current!.getState() : null;
  const inMatch = !!practiceDriver || (!!sessionState && sessionState.phase !== "lobby");
  const gameKey = practiceDriver
    ? `p${practiceEpoch}`
    : sessionState && sessionState.phase !== "lobby"
      ? `n${sessionState.matchEpoch}`
      : "";
  activeDriverRef.current = practiceDriver ?? (sessionState && sessionState.phase !== "lobby" ? sessionRef.current : null);

  useEffect(() => {
    gameRef.current?.destroy(true);
    gameRef.current = null;
    const driver = activeDriverRef.current;
    if (!gameKey || !driver || !hostRef.current) return;

    setResult(null);
    lastHud.current = null;
    setHud(FRESH_HUD);
    const cfg: ArenaConfig = {
      driver,
      onHud,
      onEvent,
      onEnd: (winnerId) => setResult({ winnerId }),
    };
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      parent: hostRef.current,
      backgroundColor: "#0f172a",
      scene: [ArenaScene],
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
      callbacks: { preBoot: (g) => g.registry.set("cfg", cfg) },
    });
    gameRef.current = game;
    if (import.meta.env.DEV) (window as unknown as { __arenaGame?: Phaser.Game }).__arenaGame = game;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, onEvent, onHud]);

  // --- connect chime: play once when a new remote peer appears in the lobby roster ---
  const rosterIds = sessionState ? sessionState.roster.map((pl) => pl.id) : [];
  const rosterKey = rosterIds.join(",");
  const prevRosterIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!sessionState) return;
    const joined = joinedIds(prevRosterIdsRef.current, rosterIds, sessionState.localId);
    prevRosterIdsRef.current = rosterIds;
    if (joined.length > 0) sfxRef.current.play("join");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  // Unlock audio on the first user gesture so lobby SFX (the join chime) are audible pre-match.
  useEffect(() => {
    const unlock = () => sfxRef.current.resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // --- handlers ---
  const changeName = (n: string) => {
    setName(n);
    nameRef.current = n;
    sessionRef.current?.setProfile(n, colorRef.current, shapeRef.current);
  };
  const changeColor = (i: number) => {
    setColorIndex(i);
    colorRef.current = i;
    sessionRef.current?.setProfile(nameRef.current, i, shapeRef.current);
  };
  const changeShape = (s: Shape) => {
    setShape(s);
    shapeRef.current = s;
    sessionRef.current?.setProfile(nameRef.current, colorRef.current, s, weaponRef.current);
  };
  const changeWeapon = (w: Weapon) => {
    setWeapon(w);
    weaponRef.current = w;
    sessionRef.current?.setProfile(nameRef.current, colorRef.current, shapeRef.current, w);
  };
  const startMatch = (bots: number) => {
    sfxRef.current.resume();
    lastBotCount.current = bots;
    sessionRef.current?.start(bots);
  };
  // Offline, zero-netcode solo warm-up vs bots. Currently has no UI entry point
  // (the "Practice vs bots" button was removed) — kept intact for future re-exposure.
  const practice = () => {
    sfxRef.current.resume();
    setPracticeDriver(new SoloDriver(3));
    setPracticeEpoch((n) => n + 1);
  };
  const playAgain = () => {
    if (practiceDriver) {
      setPracticeDriver(new SoloDriver(3));
      setPracticeEpoch((n) => n + 1);
    } else if (sessionState?.isHost) {
      startMatch(lastBotCount.current);
    }
  };
  const backToLobby = () => {
    if (practiceDriver) setPracticeDriver(null);
    else sessionRef.current?.toLobby();
    setResult(null);
  };

  if (!ready) {
    return <div className="py-16 text-center text-neutral-500">Connecting to the arena…</div>;
  }

  const joinUrl = buildJoinUrl(window.location.origin, window.location.pathname, roomId);
  const localId = practiceDriver ? practiceDriver.localId : sessionState!.localId;
  const youWon = result?.winnerId === localId;
  const canRematch = !!practiceDriver || !!sessionState?.isHost;

  return (
    <div className="flex flex-col items-center gap-3">
      {!inMatch ? (
        <WarmupRoom
          roster={sessionState!.roster}
          localId={sessionState!.localId}
          hostId={sessionState!.hostId}
          isHost={sessionState!.isHost}
          name={name}
          colorIndex={colorIndex}
          shape={shape}
          weapon={weapon}
          joinUrl={joinUrl}
          onName={changeName}
          onColor={changeColor}
          onShape={changeShape}
          onWeapon={changeWeapon}
          onStart={startMatch}
          onKick={(id) => sessionRef.current?.kick(id)}
        />
      ) : (
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: ARENA_WIDTH,
            aspectRatio: `${ARENA_WIDTH} / ${ARENA_HEIGHT}`,
          }}
        >
          <div ref={hostRef} style={{ position: "absolute", inset: 0, borderRadius: 12, overflow: "hidden", background: "#0f172a" }} />

          <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 16, alignItems: "center", pointerEvents: "none" }}>
            <Hearts health={hud.health} />
            <CooldownBadge fraction={hud.dashFraction} glyph="➤" color="#38bdf8" />
            <CooldownBadge fraction={hud.attackFraction} glyph="⚔" color="#fbbf24" />
          </div>

          {hud.countdown > 0 && <Countdown n={hud.countdown} />}

          {!hud.alive && !result && (
            <div style={{ position: "absolute", top: 12, right: 12, color: "#fca5a5", fontWeight: 600 }}>Spectating…</div>
          )}

          {result && (
            <Overlay>
              <h2 className="text-4xl font-bold">{youWon ? "You win! 🏆" : result.winnerId ? "You're out ☠️" : "Draw"}</h2>
              <div className="flex gap-3">
                {canRematch && (
                  <button onClick={playAgain} className="rounded-lg bg-sky-500 px-5 py-2 font-semibold text-white hover:bg-sky-400">
                    Play again
                  </button>
                )}
                <button onClick={backToLobby} className="rounded-lg border border-white/40 px-5 py-2 font-semibold text-white hover:bg-white/10">
                  Back to room
                </button>
              </div>
              {!canRematch && <p className="text-sm text-neutral-300">Waiting for the host to restart…</p>}
            </Overlay>
          )}
        </div>
      )}

      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        WASD/arrows move · Shift dash · Space attack — open the invite link in another browser to play together.
      </p>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "rgba(15,23,42,0.72)",
        borderRadius: 12,
        color: "#fff",
        textAlign: "center",
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}
