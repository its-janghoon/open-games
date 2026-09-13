import Phaser from 'phaser';
import { SceneKeys, PALETTE } from '../config/GameConfig';
import { AUDIO, IMAGES, SHEETS, assetPath } from '../config/AssetKeys';
import { textStyle } from '../ui/UiText';
import { tr } from '../i18n/i18n';

/**
 * PreloadScene loads every runtime asset (spritesheets, backgrounds, UI,
 * FX, and audio) declared in AssetKeys.ts, drawing a loading bar while the
 * queue drains, then advances to the Title scene.
 *
 * All URLs are built with assetPath() so files in public/ resolve under the
 * Vite base path ('/wirework/' in production, '/' in dev).
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: SceneKeys.Preload });
  }

  preload(): void {
    this.buildLoadingBar();

    // Spritesheets (frame configs come straight from AssetKeys).
    for (const sheet of SHEETS) {
      this.load.spritesheet(sheet.key, assetPath(sheet.url), sheet.frame);
    }

    // Single-frame images (backgrounds, hook, 9-slice UI parts).
    for (const img of IMAGES) {
      this.load.image(img.key, assetPath(img.url));
    }

    // Audio (each entry may list several formats; Phaser picks a supported one).
    for (const clip of AUDIO) {
      this.load.audio(clip.key, clip.urls.map(assetPath));
    }
  }

  create(): void {
    this.applyPixelArtFiltering();
    this.scene.start(SceneKeys.Title);
  }

  /**
   * Keep the pixel-art sprites/UI crisp WITHOUT pixelating the whole canvas.
   *
   * The game deliberately does not set `pixelArt: true` (see main.ts): that
   * forced NEAREST filtering on every texture, and Phaser Text glyph textures
   * are not exempt, so small Korean text was nearest-minified and broke up.
   * The canvas now scales smoothly, which keeps the high-resolution text sharp,
   * and crisp pixel art is restored by setting NEAREST filtering PER-TEXTURE on
   * the loaded spritesheets and single images here. Text textures are created
   * later, dynamically, and so keep the smooth default - which is exactly what
   * they want. Mirrors lastwar's PreloadScene.
   */
  private applyPixelArtFiltering(): void {
    for (const { key } of [...SHEETS, ...IMAGES]) {
      if (this.textures.exists(key)) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      }
    }
  }

  /** A simple pixel-styled loading bar wired to the loader progress events. */
  private buildLoadingBar(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const barWidth = Math.floor(width * 0.6);
    const barX = Math.floor((width - barWidth) / 2);
    const barY = Math.floor(height / 2);

    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);

    this.add
      .text(cx, barY - 44, tr('brand.name'), textStyle(32, { fontStyle: 'bold' }))
      .setOrigin(0.5);

    const label = this.add
      .text(cx, barY + 32, tr('preload.loading', { pct: 0 }), textStyle(16))
      .setOrigin(0.5)
      .setAlpha(0.8);

    const border = this.add.rectangle(cx, barY, barWidth + 8, 20, PALETTE.WALL_DARK);
    border.setStrokeStyle(2, PALETTE.WALL);
    const bar = this.add.rectangle(barX, barY, 1, 12, PALETTE.ACCENT).setOrigin(0, 0.5);

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      bar.width = Math.max(1, Math.floor(barWidth * value));
      label.setText(tr('preload.loading', { pct: Math.round(value * 100) }));
    });

    this.load.on(Phaser.Loader.Events.COMPLETE, () => {
      border.destroy();
      bar.destroy();
      label.destroy();
    });
  }
}
