import Phaser from 'phaser';
import { setLanguage } from './i18n/i18n';
import { loadSettings } from './systems/SettingsStore';
import { CANVAS, PHYSICS, PALETTE } from './config/GameConfig';
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
import { TownScene } from './scenes/TownScene';
import { BattleScene } from './scenes/BattleScene';
import { GameOverScene } from './scenes/GameOverScene';
import { SettingsScene } from './scenes/SettingsScene';
import { RuntimeCoordinator } from './systems/RuntimeCoordinator';
import { AudioManager } from './systems/AudioManager';
import { AudioKeys } from './config/AssetKeys';
import { announceStatus } from './ui/Accessibility';
import { tr } from './i18n/i18n';

/**
 * Phaser bootstrap for Kingdom Rise.
 *
 * Scene flow: Boot -> Preload (loads the generated art/audio) -> Title -> Town
 * (the idle front end) with Settings and Battle reachable from the town. The
 * Battle scene resolves a wave via CombatSystem and hands off to GameOver for
 * the result summary before returning to Town.
 *
 * MOBILE-FILL RENDER PIPELINE (FEAT-002, shared)
 * ----------------------------------------------
 * The game is authored in a fixed 960x540 LANDSCAPE logical space. On a portrait
 * phone, a plain Scale.FIT of 960x540 shrank it into a thin letterboxed band.
 * We now route the scale through the SHARED @open-games/shared module: grow the
 * game SURFACE to the live viewport aspect (resolveViewportPlan) so FIT fills the
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
  return { cssWidth, cssHeight, dpr: clampDpr(window.devicePixelRatio || 1) };
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
  backgroundColor: PALETTE.BG_SKY_CSS,
  // Do NOT set `pixelArt: true`. It forces `antialias: false`, i.e. NEAREST on
  // EVERY texture, and Phaser Text is not exempt: TextureSource takes its
  // default scaleMode straight from `game.config.antialias`. Glyphs rasterized
  // at TEXT_RESOLUTION (>=2x) then get NEAREST-*minified* to their drawn size,
  // point-sampling texel rows away - Hangul jongseong merge into blobs. Smooth
  // scaling turns the same oversized texture into a supersampled downscale, and
  // pixel art is restored per-texture in PreloadScene.applyPixelArtFiltering().
  //
  // roundPixels stays false: the camera zoom is fractional, and snapping draw
  // positions to integers pushes centred labels off-centre.
  render: { antialias: true, roundPixels: false },
  scale: {
    // FIT of an ASPECT-MATCHED surface (fillWidth x fillHeight) fills a portrait
    // phone with no thin-band letterbox; the 960x540 layout is centered inside
    // it via the camera scroll from resolveViewportPlan.
    mode: Phaser.Scale.FIT,
    // The #game parent is a flexbox that already centers the canvas both axes;
    // NO_CENTER keeps flexbox the single centering owner (equal opposing margins).
    autoCenter: Phaser.Scale.NO_CENTER,
    width: currentPlan.gameWidth,
    height: currentPlan.gameHeight,
  },
  physics: {
    default: 'arcade',
    arcade: {
      // Top-down management view: no gravity. Movement (in battle) is planar.
      gravity: { x: 0, y: PHYSICS.GRAVITY_Y },
      debug: false,
    },
  },
  scene: [BootScene, PreloadScene, TitleScene, TownScene, BattleScene, GameOverScene, SettingsScene],
};

/** Zoom + center a scene's main camera per the current fill plan. */
function applyCameraZoom(cam: Phaser.Cameras.Scene2D.Camera | undefined): void {
  if (!cam) return;
  cam.setZoom(currentPlan.scale);
  cam.setScroll(currentPlan.scrollX, currentPlan.scrollY);
}

/**
 * Wire the shared render-scale pipeline: zoom+center every scene's main camera
 * to the current plan, and recompute (resize the backbuffer + re-apply the
 * camera) on window resize/orientationchange so the surface tracks the live
 * viewport. Mirrors whiteout's registerRenderScale.
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

  game.events.once(Phaser.Core.Events.READY, () => {
    for (const scene of game.scene.scenes) {
      attach(scene);
    }
    recompute();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', recompute);
      window.addEventListener('orientationchange', recompute);
    }
  });
}

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

seedLanguage();
const game = new Phaser.Game(config);
registerRenderScale(game);
// QA/debug hook: expose the running game only when explicitly requested via
// ?debug in the URL, so screenshot/e2e tooling can introspect scene state.
// Has no effect on the normal production page (no query flag). Mirrors the
// hook wirework and whiteout carry.
if (typeof location !== 'undefined' && location.search.includes('debug')) {
  (globalThis as unknown as { __GAME__?: Phaser.Game }).__GAME__ = game;
}

// One simulation/autosave owner remains active across Title, Town, Settings,
// Battle, and GameOver. Scene transitions therefore cannot pause production or
// duplicate listeners. Lifecycle exits synchronously request a durable save.
const runtime = new RuntimeCoordinator();
game.events.once(Phaser.Core.Events.READY, () => {
  runtime.subscribe((done) => {
    const trained = Object.values(done.trainingDone).reduce((sum, count) => sum + (count ?? 0), 0);
    const activeScene = game.scene.getScenes(true)[0];
    if (activeScene) {
      const audio = AudioManager.get(activeScene);
      if (done.buildingsDone.length > 0 || done.researchDone.length > 0) {
        audio.playSfx(AudioKeys.BuildComplete, 0.6);
      }
      if (trained > 0) audio.playSfx(AudioKeys.TrainComplete, 0.5);
    }
    announceStatus(tr('status.completions', {
      buildings: done.buildingsDone.length,
      research: done.researchDone.length,
      trained,
    }));
  });
  game.events.on(Phaser.Core.Events.STEP, () => runtime.step());
  game.events.on(Phaser.Core.Events.BLUR, () => runtime.save());
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) runtime.save();
      else runtime.resume();
    });
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => runtime.save());
});
