import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import BattleScene, { type BattleSceneData } from './scenes/BattleScene';
import type { BattleOutcome } from './battleStore';
import type { MatchRequest } from './matchRequest';

interface PhaserGameProps {
  match: MatchRequest;
  /**
   * Incremented by App on every battle entry. Including it in the effect deps
   * guarantees a fresh scene even when the same matchup is replayed (a rematch
   * of identical champions), which champion-id-only deps would miss.
   */
  matchNonce: number;
  onGameEnd: (outcome: BattleOutcome) => void;
  /** Fires once fonts, scene textures, scale refresh, and a rendered frame settle. */
  onReady: () => void;
  /** Reports a terminal renderer/startup failure without exposing a false HUD. */
  onError: (error: unknown) => void;
}

const GAME_WIDTH = 900;
const GAME_HEIGHT = 640;
/**
 * Widest surface we will grow to. The world diamond is projected at a FIXED
 * 900x640 (DEFAULT_PROJECTION), so a wider surface reveals more map either side
 * rather than magnifying - past roughly 2.6:1 that is just void, so clamp.
 */
const MAX_GAME_WIDTH = 1680;

/**
 * Surface size for the live container.
 *
 * The canvas used to be a FIXED 900x640 fed to a plain `Scale.FIT`, which on a
 * wide desktop displayed the whole game as a ~900px island inside a ~1900px
 * viewport (measured 47% width fill) while every sibling game filled 100%. FIT
 * only letterboxes when the SURFACE aspect differs from the CONTAINER aspect,
 * so instead of scaling a 1.41:1 surface into a 2.5:1 box we grow the surface
 * to the container's own aspect at a fixed 640 logical height. FIT then has
 * nothing to letterbox, and because the world projection is independent of the
 * surface the extra width shows more lane instead of stretching anything.
 * Mirrors the shared `resolveViewportPlan` approach the other four games use.
 */
function surfaceFor(container: HTMLElement): { width: number; height: number } {
  const rect = container.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return { width: GAME_WIDTH, height: GAME_HEIGHT };
  }
  const width = Math.round(GAME_HEIGHT * (rect.width / rect.height));
  return {
    width: Math.min(MAX_GAME_WIDTH, Math.max(GAME_WIDTH, width)),
    height: GAME_HEIGHT,
  };
}
const FONT_TIMEOUT_MS = 1800;
const FIRST_RENDER_TIMEOUT_MS = 500;
const STARTUP_WATCHDOG_MS = 6500;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function settleWithTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = globalThis.setTimeout(finish, timeoutMs);
    void promise.then(finish, finish);
  });
}

async function settleCriticalFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await settleWithTimeout(
      Promise.all([
        document.fonts.load('700 12px "Noto Sans KR"', '전투 Battle'),
        document.fonts.load('600 16px Cinzel', 'Arena'),
        document.fonts.ready,
      ]),
      FONT_TIMEOUT_MS,
    );
  } catch {
    // Font loading is an enhancement; system fallbacks must always boot battle.
  }
}

/**
 * Mounts a single Phaser.Game into a container div and tears it down on
 * unmount. Startup is cancellation-safe for React StrictMode and reports ready
 * only after critical browser/scene resources have a bounded chance to settle.
 */
export default function PhaserGame({
  match,
  matchNonce,
  onGameEnd,
  onReady,
  onError,
}: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onGameEndRef = useRef(onGameEnd);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onGameEndRef.current = onGameEnd;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || gameRef.current) return;

    let cancelled = false;
    let game: Phaser.Game | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let layoutRaf = 0;
    let readinessRaf = 0;
    let renderTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let startupWatchdog: ReturnType<typeof globalThis.setTimeout> | undefined;
    let startupSettled = false;
    const motionQuery = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;

    const preventContextMenu = (event: Event) => event.preventDefault();
    // Re-derive the surface from the live container so a resize keeps FIT
    // aspect-matched (and therefore keeps filling) instead of re-letterboxing.
    const refresh = () => {
      if (!game || !container.isConnected) return;
      const next = surfaceFor(container);
      const size = game.scale.gameSize;
      if (size.width !== next.width || size.height !== next.height) {
        game.scale.resize(next.width, next.height);
      }
      game.scale.refresh();
    };

    const finishReady = () => {
      if (cancelled || startupSettled) return;
      startupSettled = true;
      if (renderTimeout !== undefined) {
        globalThis.clearTimeout(renderTimeout);
        renderTimeout = undefined;
      }
      if (startupWatchdog !== undefined) {
        globalThis.clearTimeout(startupWatchdog);
        startupWatchdog = undefined;
      }
      game?.events.off('postrender', finishReady);
      onReadyRef.current();
    };

    const failStartup = (error: unknown) => {
      if (cancelled || startupSettled) return;
      startupSettled = true;
      if (renderTimeout !== undefined) {
        globalThis.clearTimeout(renderTimeout);
        renderTimeout = undefined;
      }
      if (startupWatchdog !== undefined) {
        globalThis.clearTimeout(startupWatchdog);
        startupWatchdog = undefined;
      }
      game?.events.off('postrender', finishReady);
      onErrorRef.current(error);
    };

    const handleSceneReady = () => {
      if (cancelled || !game || readinessRaf !== 0) return;
      readinessRaf = requestAnimationFrame(() => {
        readinessRaf = 0;
        if (cancelled || !game) return;
        game.scale.refresh();
        // Phaser's postrender event means every scene has painted. The timeout
        // fallback covers background tabs, context loss, and test shims.
        game.events.once('postrender', finishReady);
        renderTimeout = globalThis.setTimeout(finishReady, FIRST_RENDER_TIMEOUT_MS);
      });
    };

    const handleMotionChange = (event: MediaQueryListEvent) => {
      if (!game) return;
      const scene = game.scene.getScene('battle');
      if (scene instanceof BattleScene) scene.setReducedMotion(event.matches);
    };

    const boot = async () => {
      await settleCriticalFonts();
      if (cancelled || gameRef.current || !container.isConnected) return;

      const sceneData: BattleSceneData = {
        ...match,
        reducedMotion: motionQuery?.matches ?? false,
        onSceneReady: handleSceneReady,
        onGameEnd: (outcome) => onGameEndRef.current(outcome),
      };

      const surface = surfaceFor(container);
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: container,
        width: surface.width,
        height: surface.height,
        backgroundColor: '#071018',
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: surface.width,
          height: surface.height,
        },
        // roundPixels MUST stay false: FIT displays the surface at a
        // NON-INTEGER scale, and snapping draw positions to integers under a
        // fractional resample shifts centred art off-centre and makes the
        // lerped camera scroll stair-step (the world visibly shook). lastwar
        // documents the same trap.
        render: { antialias: true, roundPixels: false },
        scene: [BattleScene],
      });
      gameRef.current = game;
      // QA/debug hook: expose the running game only when explicitly requested
      // via ?debug in the URL, so screenshot/e2e tooling can introspect scene
      // state. No effect on the normal production page (no query flag).
      if (typeof location !== 'undefined' && location.search.includes('debug')) {
        (globalThis as unknown as { __GAME__?: Phaser.Game }).__GAME__ = game;
      }
      game.scene.start('battle', sceneData);

      canvas = game.canvas;
      canvas?.addEventListener('contextmenu', preventContextMenu);
      motionQuery?.addEventListener('change', handleMotionChange);

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(refresh);
        resizeObserver.observe(container);
      }
      layoutRaf = requestAnimationFrame(refresh);
      window.addEventListener('resize', refresh);
    };

    // Outermost bound: constructor/scene-create exceptions and browser
    // lifecycle stalls report an explicit failure instead of exposing a false HUD.
    startupWatchdog = globalThis.setTimeout(
      () => failStartup(new Error('Battle renderer startup timed out')),
      STARTUP_WATCHDOG_MS,
    );
    void boot().catch(failStartup);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', refresh);
      motionQuery?.removeEventListener('change', handleMotionChange);
      if (layoutRaf !== 0) cancelAnimationFrame(layoutRaf);
      if (readinessRaf !== 0) cancelAnimationFrame(readinessRaf);
      if (renderTimeout !== undefined) globalThis.clearTimeout(renderTimeout);
      if (startupWatchdog !== undefined) globalThis.clearTimeout(startupWatchdog);
      resizeObserver?.disconnect();
      canvas?.removeEventListener('contextmenu', preventContextMenu);
      game?.events.off('postrender', finishReady);
      game?.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
    };
  }, [match, matchNonce]);

  return <div className="phaser-game" ref={containerRef} aria-hidden="true" />;
}
