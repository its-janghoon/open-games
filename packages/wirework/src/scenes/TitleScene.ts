import Phaser from 'phaser';
import { SceneKeys, PALETTE, CANVAS } from '../config/GameConfig';
import { TextureKeys, AudioKeys } from '../config/AssetKeys';
import { AudioManager } from '../systems/AudioManager';
import { Menu } from '../ui/Menu';
import { textStyle } from '../ui/UiText';
import { tr } from '../i18n/i18n';
import { LANGUAGES } from '../i18n/strings';
import { prefersReducedMotion } from '../systems/Persistence';
import { onViewportRefit, type VisibleWorldRect } from '@open-games/shared';

/**
 * TitleScene - the front door. Renders the layered pixel backdrop, the game
 * title, and Start / Settings buttons, and kicks off the music bed. Deploys
 * into the GameScene with a fade transition.
 */
export class TitleScene extends Phaser.Scene {
  private bgSky!: Phaser.GameObjects.TileSprite;
  private bgHills!: Phaser.GameObjects.TileSprite;
  private bgWall!: Phaser.GameObjects.Image;
  private drift = 0;
  private reducedMotion = false;

  constructor() {
    super({ key: SceneKeys.Title });
  }

  create(): void {
    this.reducedMotion = prefersReducedMotion(AudioManager.get(this).getSettings());
    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    Menu.fadeIn(this);

    const cx = CANVAS.WIDTH / 2;

    // The camera shows a taller-than-540 world rect on a portrait phone. Paint
    // the parallax backdrop across that WHOLE visible rect (not just the fixed
    // 960x540 design band) so there are no flat-black dead margins; interactive
    // UI below stays authored in the unchanged 960x540 space. All three layers
    // re-fit on resize/orientationchange via the shared provider.

    // Parallax backdrop from the loaded background layers (slow auto-drift).
    this.bgSky = this.add.tileSprite(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, TextureKeys.BgSky).setOrigin(0, 0);
    this.bgHills = this.add
      .tileSprite(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, TextureKeys.BgHills)
      .setOrigin(0, 0)
      .setAlpha(0.92);
    // A right-edge wall slab sized to the design band (see refitBackdrop for why
    // it must NOT be stretched to the visible width). The side margins of a wide
    // viewport are covered by the tiling sky/hills above, not by this.
    this.bgWall = this.add.image(cx, CANVAS.HEIGHT / 2, TextureKeys.BgWall).setAlpha(0.85);
    onViewportRefit(this, { width: CANVAS.WIDTH, height: CANVAS.HEIGHT }, (rect) => this.refitBackdrop(rect));

    // Hero silhouette perched on the wall.
    this.add.image(cx + 300, CANVAS.HEIGHT * 0.62, TextureKeys.Hero, 0).setScale(4).setFlipX(true);

    // Title + tagline.
    const title = Menu.title(this, cx, CANVAS.HEIGHT * 0.3, tr('brand.name'), 64);
    if (!this.reducedMotion) this.tweens.add({ targets: title, y: title.y - 4, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    Menu.label(this, cx, CANVAS.HEIGHT * 0.44, tr('title.tagline'), 20, 0.85);

    // Menu buttons.
    Menu.button(this, cx, CANVAS.HEIGHT * 0.62, tr('title.deploy'), () => this.startGame(), { width: 240 });
    Menu.button(this, cx, CANVAS.HEIGHT * 0.77, tr('title.settings'), () => this.openSettings(), { width: 240 });

    // Compact language toggle in the top-right so players can switch language
    // straight from the front door by TAP, without opening Settings or needing a
    // keyboard - matching kingshot/whiteout. Persists via the AudioManager.
    this.buildLanguageToggle(36);

    Menu.label(this, cx, CANVAS.HEIGHT * 0.92, tr('title.hint'), 14, 0.5);

    // Keyboard shortcuts mirror the buttons.
    this.input.keyboard?.on('keydown-SPACE', () => this.startGame());
    this.input.keyboard?.on('keydown-S', () => this.openSettings());
    // L cycles the language, mirroring the on-screen toggle.
    this.input.keyboard?.on('keydown-L', () => this.stepLanguage(1));

    // Start the music bed (idempotent; survives across scenes via AudioManager).
    const audio = AudioManager.get(this);
    // The browser may hold audio locked until the first gesture; retry on input.
    audio.playMusic(AudioKeys.MusicLoop);
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => { audio.unlock(); audio.playMusic(AudioKeys.MusicLoop); });
    this.input.keyboard?.once('keydown', () => { audio.unlock(); audio.playMusic(AudioKeys.MusicLoop); });
  }

  /**
   * Re-fit the parallax sky/hills tiles + the wall image to the live
   * visible-world rect. Runs at create() and on every resize/orientationchange
   * so a mid-scene rotate never leaves a flat-black dead margin.
   */
  private refitBackdrop(rect: VisibleWorldRect): void {
    this.bgSky.setPosition(rect.x, rect.y).setSize(rect.width, rect.height);
    this.bgHills.setPosition(rect.x, rect.y).setSize(rect.width, rect.height);
    // The wall is pinned to the DESIGN BAND, not stretched to rect.width.
    // wall.png is 480x270 whose left 75% is fully transparent - it is a
    // right-edge wall slab, not a full-width texture like sky/hills (which are
    // tileSprites and genuinely do tile to cover the margins). Stretching it
    // horizontally therefore did not fill a bare strip; it just widened the
    // slab in proportion to the viewport, painting a hard-edged grey column
    // over the right of the screen and the language selector with it. At the
    // band size the source lands at exactly 2x (960/480 == 540/270), so this is
    // both aspect-preserving and stable: the slab stays at logical x 780..960,
    // under the hero that create() perches on it.
    this.bgWall.setPosition(CANVAS.WIDTH / 2, CANVAS.HEIGHT / 2).setDisplaySize(CANVAS.WIDTH, CANVAS.HEIGHT);
  }

  update(_time: number, delta: number): void {
    if (this.reducedMotion) return;
    this.drift += delta * 0.004;
    this.bgSky.tilePositionX = this.drift * 0.4;
    this.bgHills.tilePositionX = this.drift;
  }

  /**
   * A compact language toggle in the top-right corner: a small label, a prev
   * button, the current language name, and a next button. Mirrors kingshot's
   * front-door stepper so the control is reachable by TAP without a keyboard.
   *
   * The whole cluster is anchored a comfortable margin inside the 960px-wide
   * canvas (the ▶ button's right edge stays well under the edge) so it never
   * clips off on any viewport.
   */
  private buildLanguageToggle(y: number): void {
    const lang = AudioManager.get(this).getSettings().language;

    const nextX = CANVAS.WIDTH - 34; // 926 -> right edge ~943 (>=16px margin)
    const prevX = nextX - 120; // 806: ◀ button, 120px gap from ▶
    const valueX = (prevX + nextX) / 2; // 866: current-language name centered in the gap
    const labelX = prevX - 30; // 776: right-aligned label ends here

    Menu.label(this, labelX, y, tr('settings.language'), 14, 0.7).setOrigin(1, 0.5);
    this.add.text(valueX, y, tr(`language.${lang}`), textStyle(16)).setOrigin(0.5);
    Menu.button(this, prevX, y, '\u25C0', () => this.stepLanguage(-1), { width: 34, fontSize: 14, padY: 6 });
    Menu.button(this, nextX, y, '\u25B6', () => this.stepLanguage(1), { width: 34, fontSize: 14, padY: 6 });
  }

  /**
   * Cycle the UI language, persist + mirror it through the AudioManager
   * (updateSettings persists AND calls setLanguage into the i18n runtime), then
   * restart the scene so every Title label re-renders in the new language.
   */
  private stepLanguage(dir: -1 | 1): void {
    const audio = AudioManager.get(this);
    const current = audio.getSettings().language;
    const len = LANGUAGES.length;
    const idx = LANGUAGES.indexOf(current);
    const next = LANGUAGES[(((idx + dir) % len) + len) % len];
    if (next === current) return;
    audio.updateSettings({ language: next });
    Menu.fadeTo(this, () => this.scene.restart());
  }

  private startGame(): void {
    const difficulty = AudioManager.get(this).getSettings().difficulty;
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Game, { difficulty }));
  }

  private openSettings(): void {
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Settings));
  }
}
