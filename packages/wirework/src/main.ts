import Phaser from 'phaser';
import { CANVAS, PHYSICS } from './config/GameConfig';
import {
  resolveViewportPlan,
  resolveVisibleWorldRect,
  publishVisibleWorldRect,
  clampDpr,
  type ViewportPlan,
  type VisibleWorldRect,
} from '@open-games/shared';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { TitleScene } from './scenes/TitleScene';
import { SettingsScene } from './scenes/SettingsScene';
import { GameScene } from './scenes/GameScene';
import { PauseScene } from './scenes/PauseScene';
import { GameOverScene } from './scenes/GameOverScene';

/**
 * Phaser bootstrap for Wirework.
 *
 * MOBILE-FILL RENDER PIPELINE (FEAT-002, shared)
 * ----------------------------------------------
 * The game is authored in a fixed 960x540 LANDSCAPE logical space. On a portrait
 * phone, a plain Scale.FIT of 960x540 shrank it into a thin letterboxed band. We
 * now route the scale through the SHARED @open-games/shared module: grow the game
 * SURFACE to the live viewport aspect (resolveViewportPlan) so FIT fills the
 * screen with no band, size the backbuffer to the real displayed physical pixels
 * (with a CLAMPED devicePixelRatio so a hi-DPR phone can't OOM the tab), and zoom
 * + center each scene's main camera so the untouched 960x540 layout stays
 * centered. Recomputed on resize/orientationchange. Scenes need no changes.
 */

/** Measure the display container (CSS px) + the CLAMPED devicePixelRatio. */
function measureDisplay(): { cssWidth: number; cssHeight: number; dpr: number } {
  if (typeof window === 'undefined') {
    return { cssWidth: CANVAS.WIDTH, cssHeight: CANVAS.HEIGHT, dpr: 1 };
  }
  const parent = typeof document !== 'undefined' ? document.getElementById('game') : null;
  const rect = parent?.getBoundingClientRect();
  const cssWidth = rect && rect.width > 0 ? rect.width : window.innerWidth || CANVAS.WIDTH;
  const cssHeight = rect && rect.height > 0 ? rect.height : window.innerHeight || CANVAS.HEIGHT;
  const rawDpr = clampDpr(window.devicePixelRatio || 1);
  const budgetDpr = Math.sqrt(CANVAS.MAX_BACKBUFFER_PIXELS / Math.max(1, cssWidth * cssHeight));
  return { cssWidth, cssHeight, dpr: Math.min(rawDpr, budgetDpr) };
}

function planFromDisplay(): ViewportPlan {
  const { cssWidth, cssHeight, dpr } = measureDisplay();
  return resolveViewportPlan(CANVAS.WIDTH, CANVAS.HEIGHT, cssWidth, cssHeight, dpr);
}

let currentPlan = planFromDisplay();

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

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f14',
  // Do NOT set `pixelArt: true`. It forces `antialias: false`, which makes
  // EVERY texture sample with NEAREST - including the Phaser Text glyph
  // textures, which are NOT exempt (see TextureSource: the default scaleMode
  // comes straight from `game.config.antialias`). Text is rasterized at
  // TEXT_RESOLUTION (>=3x) and then drawn at the fractional camera zoom, so
  // NEAREST *minification* drops whole texel rows and shreds small glyphs -
  // Hangul suffers worst because jongseong stack 2-3 strokes into a few
  // pixels and merge into blobs. Scaling SMOOTHLY instead turns that same 3x
  // texture into supersampled, sharp text. Pixel-art crispness is restored
  // per-texture in PreloadScene.applyPixelArtFiltering(), not globally.
  //
  // roundPixels MUST stay false: the camera zoom is fractional (fill scale),
  // and snapping draw positions to integers shifts centred labels off-centre
  // by up to half a logical pixel. champs and lastwar document the same trap.
  render: { antialias: true, roundPixels: false },
  scale: {
    // FIT of an ASPECT-MATCHED surface (fillWidth x fillHeight) fills a portrait
    // phone with no thin-band letterbox; the 960x540 layout is centered inside
    // it via the camera scroll from resolveViewportPlan.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: currentPlan.gameWidth,
    height: currentPlan.gameHeight,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // Top-down view: no gravity. PHYSICS.GRAVITY_Y is 0 so movement is planar.
      gravity: { x: 0, y: PHYSICS.GRAVITY_Y },
      fps: PHYSICS.FIXED_FPS,
      fixedStep: true,
      customUpdate: true,
      debug: false,
    },
  },
  input: { gamepad: true },
  scene: [BootScene, PreloadScene, TitleScene, SettingsScene, GameScene, PauseScene, GameOverScene],
};

/** Zoom + center a scene's main camera per the current fill plan. */
function applyCameraZoom(cam: Phaser.Cameras.Scene2D.Camera | undefined): void {
  if (!cam) return;
  cam.setZoom(currentPlan.scale);
  cam.setScroll(currentPlan.scrollX, currentPlan.scrollY);
}

/**
 * Wire the shared render-scale pipeline: zoom+center every scene's main camera
 * and recompute the backbuffer/surface on resize/orientationchange so the
 * canvas tracks the live viewport. Mirrors whiteout/kingshot.
 */
function registerRenderScale(game: Phaser.Game): void {
  const attach = (scene: Phaser.Scene): void => {
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => applyCameraZoom(scene.cameras.main));
    applyCameraZoom(scene.cameras.main);
  };

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

  let resizeFrame = 0;
  const scheduleRecompute = (): void => {
    if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; recompute(); });
  };

  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) {
      attach(scene);
    }
    recompute();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', scheduleRecompute);
      window.addEventListener('orientationchange', scheduleRecompute);
      game.events.once(Phaser.Core.Events.DESTROY, () => {
        window.removeEventListener('resize', scheduleRecompute);
        window.removeEventListener('orientationchange', scheduleRecompute);
        if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
      });
    }
  });
}

const game = new Phaser.Game(config);
registerRenderScale(game);
// QA/debug hook: expose the running game only when explicitly requested via
// ?debug in the URL, so screenshot/e2e tooling can introspect scene state.
// Has no effect on the normal production page (no query flag). Mirrors the
// hook the other games already carry.
if (typeof location !== 'undefined' && location.search.includes('debug')) {
  (globalThis as unknown as { __GAME__?: Phaser.Game }).__GAME__ = game;
}
