import Phaser from 'phaser';
import { CANVAS, PHYSICS, PALETTE } from './config/GameConfig';
import { setLanguage } from './i18n/i18n';
import { loadSettings } from './systems/SettingsStore';
import { GameState } from './systems/GameState';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TitleScene } from './scenes/TitleScene';
import { TownScene } from './scenes/TownScene';
import { BattleScene } from './scenes/BattleScene';
import { GameOverScene } from './scenes/GameOverScene';
import { SettingsScene } from './scenes/SettingsScene';
import { HeroScene } from './scenes/HeroScene';
import { SummonScene } from './scenes/SummonScene';
import { CampaignScene } from './scenes/CampaignScene';
import { ResearchScene } from './scenes/ResearchScene';
import { GearScene } from './scenes/GearScene';
import { AllianceScene } from './scenes/AllianceScene';
import { ArenaScene } from './scenes/ArenaScene';
import { QuestsScene } from './scenes/QuestsScene';
import { ensureFontsLoaded } from './ui/fonts';
import {
  resolveViewportPlan,
  resolveVisibleWorldRect,
  publishVisibleWorldRect,
  clampDpr,
  type ViewportPlan,
  type VisibleWorldRect,
} from '@open-games/shared';

/**
 * Phaser bootstrap for Frosthold: Last Ember.
 *
 * Scene flow: Boot -> Preload (loads the generated art/audio) -> Title -> Town
 * (the idle front end) with Settings and Battle reachable from the town. The
 * Battle scene resolves a wave via CombatSystem and hands off to GameOver for
 * the result summary before returning to Town.
 *
 * MOBILE-FILL + CRISP-TEXT RENDER PIPELINE (FEAT-002, shared)
 * -----------------------------------------------------------
 * The whole game is laid out in a fixed 960x540 LOGICAL coordinate system
 * (CANVAS). Two problems are solved here through the SHARED @open-games/shared
 * render module (single source of truth across every game):
 *
 *  1. PORTRAIT FILL. The game is landscape 16:9; on a portrait phone
 *     (e.g. 390x844) Scale.FIT of a fixed 960x540 canvas shrank it into a thin
 *     letterboxed band. We now grow the GAME SURFACE to the live viewport aspect
 *     (resolveViewportPlan -> resolveFillPlan) so FIT fills the screen with no
 *     band, and center the untouched 960x540 layout inside it via the camera
 *     scroll the plan returns. Scenes need NO coordinate changes.
 *
 *  2. CRISP TEXT. The backbuffer is sized to the real displayed physical pixels
 *     (fill size * a whole-number renderScale that tracks DPR AND the
 *     displayed-vs-logical ratio) and each scene's main camera is zoomed by the
 *     same scale, so text rasterizes at display resolution while the logical
 *     coordinate space is preserved. The DPR is CLAMPED (shared clampDpr) so a
 *     hi-DPR phone never allocates an oversized WebGL backbuffer (the reported
 *     mobile tab crashes).
 *
 * The plan is recomputed on every window resize / orientationchange (see
 * registerRenderScale) so the surface, buffer, and camera track the live
 * viewport.
 */

/** Measure the container the game is displayed in (CSS pixels) + the CLAMPED DPR. */
function measureDisplay(): { cssWidth: number; cssHeight: number; dpr: number } {
  if (typeof window === 'undefined') {
    return { cssWidth: CANVAS.WIDTH, cssHeight: CANVAS.HEIGHT, dpr: 1 };
  }
  const parent = typeof document !== 'undefined' ? document.getElementById('game') : null;
  const rect = parent?.getBoundingClientRect();
  const style = parent ? window.getComputedStyle(parent) : null;
  const horizontalPadding = style ? parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') : 0;
  const verticalPadding = style ? parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0') : 0;
  const cssWidth = rect && rect.width > 0 ? Math.max(1, rect.width - horizontalPadding) : window.innerWidth || CANVAS.WIDTH;
  const cssHeight = rect && rect.height > 0 ? Math.max(1, rect.height - verticalPadding) : window.innerHeight || CANVAS.HEIGHT;
  // clampDpr bounds the backbuffer so a hi-DPR phone can't OOM the tab.
  return { cssWidth, cssHeight, dpr: clampDpr(window.devicePixelRatio || 1) };
}

function planFromDisplay(): ViewportPlan {
  const { cssWidth, cssHeight, dpr } = measureDisplay();
  return resolveViewportPlan(CANVAS.WIDTH, CANVAS.HEIGHT, cssWidth, cssHeight, dpr);
}

const RENDER_PLAN = planFromDisplay();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.BG_SKY_CSS,
  // Do NOT set `pixelArt: true`. It forces `antialias: false`, i.e. NEAREST on
  // EVERY texture - and Phaser Text is not exempt, because TextureSource takes
  // its default scaleMode straight from `game.config.antialias`. A device-pixel
  // backbuffer stops text being *blurry*, but it does not stop this: glyphs are
  // rasterized at TEXT_RESOLUTION (>=3x) and then NEAREST-minified to their
  // drawn size, which point-samples whole texel rows away. Hangul jongseong
  // merge into blobs. Scaling smoothly makes that oversized texture a
  // supersampled downscale, and pixel art stays crisp per-texture via
  // PreloadScene.applyPixelArtFiltering().
  //
  // roundPixels stays false: the camera zoom is fractional, and snapping draw
  // positions to integers pushes centred labels off-centre.
  render: { antialias: true, roundPixels: false },
  scale: {
    // FIT of an ASPECT-MATCHED game surface: because the game width/height now
    // matches the viewport aspect (fillWidth x fillHeight, see resolveViewportPlan),
    // FIT fills the screen with no thin-band letterbox on a portrait phone. The
    // 960x540 layout is centered inside that surface via the camera scroll.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Backbuffer sized to the DISPLAYED physical pixels (fill size * a
    // DPR-clamped, display-aware renderScale). Each scene's main camera is
    // zoomed by the same scale (see registerRenderScale) so the 960x540 logical
    // layout is preserved and simply drawn at higher resolution. This is the
    // BOOT size; the plan is recomputed and game.scale.resize()d on every resize.
    width: RENDER_PLAN.gameWidth,
    height: RENDER_PLAN.gameHeight,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // Top-down management view: no gravity. Movement (in battle) is planar.
      gravity: { x: 0, y: PHYSICS.GRAVITY_Y },
      debug: false,
    },
  },
  scene: [
    BootScene,
    PreloadScene,
    TitleScene,
    TownScene,
    BattleScene,
    GameOverScene,
    SettingsScene,
    // FEAT-006: player-facing screens for the expanded systems.
    HeroScene,
    SummonScene,
    CampaignScene,
    ResearchScene,
    GearScene,
    AllianceScene,
    ArenaScene,
    QuestsScene,
  ],
};

/**
 * Boot the game once the KOREAN-FIRST UI font is registered. Phaser rasterizes
 * text to a canvas at first paint, so if the bundled Korean face is not ready
 * yet the opening frames fall back to a system font (or tofu). Awaiting
 * ensureFontsLoaded() first guarantees Hangul renders correctly from frame one;
 * it resolves immediately (and never rejects) in environments without the CSS
 * Font Loading API, so boot is never blocked.
 */
/**
 * Resolve the UI language BEFORE any scene renders.
 *
 * The language was previously set as a side effect of the first
 * `AudioManager.get()` call, which happens partway through TitleScene.create().
 * Labels built before that call rendered in the module default (Korean) and
 * labels built after it rendered in the resolved language, so a first-run
 * English browser saw a title screen that was half Korean and half English.
 * Seeding here makes the whole session render in one language from the first
 * frame.
 */
function seedLanguage(): void {
  setLanguage(loadSettings().language);
}

function boot(): void {
  seedLanguage();
  const game = new Phaser.Game(config);
  registerRenderScale(game);
  // QA/debug hook: expose the running game only when explicitly requested via
  // ?debug in the URL, so screenshot/e2e tooling can introspect scene state.
  // Has no effect on the normal production page (no query flag).
  if (typeof location !== 'undefined' && location.search.includes('debug')) {
    (globalThis as unknown as { __GAME__?: Phaser.Game }).__GAME__ = game;
  }
}

/**
 * The live render plan. Starts at the boot-time RENDER_PLAN and is recomputed on
 * every window resize so the backbuffer and camera zoom track the current
 * displayed size (see the pipeline note above). Kept module-level so the resize
 * handler and the per-scene camera hook read one source of truth.
 */
let currentPlan = RENDER_PLAN;

/**
 * The LIVE visible world rect (the world-space rectangle the zoomed+scrolled
 * camera actually shows, in the 960x540 design coordinate space) for the current
 * plan. On a portrait phone it is taller than 540 and starts at a negative y, so
 * scenes can paint their backdrop across the whole visible area (no dead
 * margins) while keeping interactive UI in the unchanged 960x540 band. Reads the
 * module-level currentPlan so it reflects the latest resize/orientationchange.
 */
export function getVisibleWorldRect(): VisibleWorldRect {
  return resolveVisibleWorldRect(CANVAS.WIDTH, CANVAS.HEIGHT, currentPlan);
}

/**
 * Zoom a scene's main camera by the current plan's scale so the 960x540 LOGICAL
 * layout fills the display-resolution backbuffer (see the pipeline note above).
 * Because the backbuffer is `logical * scale` and the camera is zoomed by the
 * same `scale`, the camera's world view is exactly 960x540 again - we only
 * re-anchor it to logical (0,0) via the plan's scroll offset (a zoomed camera
 * otherwise centres its world view on the buffer midpoint). Every scene in this
 * game is a static full-screen 960x540 layout that only touches `cameras.main`
 * (no scrolling/following cameras), so applying to `cameras.main` is sufficient
 * and keeps all per-scene coordinates and pointer input in logical space.
 *
 * At scale 1 (a small/1x display) zoom becomes 1 and scroll 0, i.e. a no-op, so
 * nothing changes on displays that don't need a scaled buffer.
 */
function applyCameraZoom(cam: Phaser.Cameras.Scene2D.Camera | undefined): void {
  if (!cam) return;
  cam.setZoom(currentPlan.scale);
  // scrollX/scrollY both anchor the zoomed camera AND center the 960x540 design
  // rect inside the (possibly taller/wider) fill surface, so the layout stays
  // centered on a portrait phone without any per-scene coordinate change.
  cam.setScroll(currentPlan.scrollX, currentPlan.scrollY);
}

/**
 * Wire the render-scale pipeline: zoom every scene's main camera to the current
 * plan, and recompute the plan (resize the backbuffer + re-zoom every camera)
 * whenever the window/container size or DPR changes. This keeps UI text crisp as
 * the window is resized on a dpr=1 display (the buffer grows/shrinks to match
 * the real displayed pixel size) while the 960x540 logical layout and input map
 * stay identical.
 */
function registerRenderScale(game: Phaser.Game): void {
  // Attach the zoom to a scene's main camera on every CREATE (create() runs on
  // first start AND on every restart/return, so the zoom re-applies to the
  // fresh camera) plus once immediately in case the scene already created.
  const attach = (scene: Phaser.Scene): void => {
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => applyCameraZoom(scene.cameras.main));
    applyCameraZoom(scene.cameras.main);
  };

  // Recompute buffer size + camera zoom for the live displayed size. Only
  // resize the game when the buffer dimensions actually change (avoids churn on
  // spurious resize events) and always re-apply the zoom to every live camera.
  const recompute = (): void => {
    const next = planFromDisplay();
    const changed =
      next.gameWidth !== currentPlan.gameWidth || next.gameHeight !== currentPlan.gameHeight;
    currentPlan = next;
    if (changed) {
      game.scale.resize(next.gameWidth, next.gameHeight);
    }
    for (const scene of game.scene.scenes) {
      applyCameraZoom(scene.cameras.main);
    }
    // Publish the fresh visible-world rect + notify live scenes so their
    // backdrops re-fit the new (possibly rotated) viewport instead of keeping
    // the create()-time size. Shared across the three landscape games.
    publishVisibleWorldRect(game, getVisibleWorldRect());
  };

  // The Scene Manager instantiates the config `scene` classes ASYNCHRONOUSLY
  // during boot, so `game.scene.scenes` is empty synchronously after
  // `new Phaser.Game(config)`. Wait for the game READY event (fired once the
  // boot sequence, incl. scene creation, has completed) before attaching to
  // every scene from this single place.
  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) {
      attach(scene);
    }

    // One app-wide clock advances the same simulation in Town, command,
    // battle, result, and settings scenes. Scene changes cannot pause or double it.
    let lastTickAt = Date.now();
    game.events.on(Phaser.Core.Events.STEP, () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      GameState.get().tick(now, Math.max(0, now - lastTickAt));
      lastTickAt = now;
    });
    const onVisibility = (): void => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') GameState.get().save(now);
      else GameState.get().reconcileAbsence(now);
      lastTickAt = now;
    };
    const onPageHide = (): void => GameState.get().save(Date.now());
    const onGameBlur = (): void => GameState.get().save(Date.now());
    game.events.on(Phaser.Core.Events.BLUR, onGameBlur);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);

    // Re-measure once now that the canvas is in the DOM (the boot-time measure
    // may have run before layout settled), then track subsequent resizes.
    recompute();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', recompute);
      // A phone rotate fires orientationchange; recompute so the fill surface
      // re-matches the new portrait/landscape viewport aspect.
      window.addEventListener('orientationchange', recompute);
    }
  });
}

void ensureFontsLoaded().then(boot);
