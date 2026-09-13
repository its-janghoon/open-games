import Phaser from 'phaser';
import { PALETTE, CANVAS } from '../config/GameConfig';
import { HERO_COMBAT } from '../config/PlayerConfig';
import { prefersReducedMotion, type GameSettings } from '../systems/Persistence';
import { AudioManager } from '../systems/AudioManager';
import type { WavePhase } from '../systems/WaveSystem';
import { textStyle } from './UiText';
import { tr } from '../i18n/i18n';

export interface HudState {
  hpRatio: number; gasRatio: number; gasEmpty: boolean;
  outerRatio: number; innerRatio: number;
  outerBreaches: readonly boolean[]; innerBreaches: readonly boolean[];
  citizensSaved: number; citizensTotal: number; wave: number; totalWaves: number; score: number;
  activeMs: number; wavePhase: WavePhase; countdownMs: number; inputMode: 'keyboard' | 'gamepad' | 'touch';
  edgeThreats: readonly { screenX: number; screenY: number }[];
}
export interface WeakPointCue {
  screenX: number; screenY: number; radius: number; state: 'visible' | 'critical' | 'tether';
}

export class Hud {
  private readonly hpBar: Phaser.GameObjects.Rectangle;
  private readonly gasBar: Phaser.GameObjects.Rectangle;
  private readonly outerBar: Phaser.GameObjects.Rectangle;
  private readonly innerBar: Phaser.GameObjects.Rectangle;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly warningText: Phaser.GameObjects.Text;
  private readonly phaseText: Phaser.GameObjects.Text;
  private readonly waveBanner: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly cueText: Phaser.GameObjects.Text;
  private readonly cueGfx: Phaser.GameObjects.Graphics;
  private readonly threatGfx: Phaser.GameObjects.Graphics;
  private readonly ringGfx: Phaser.GameObjects.Graphics;
  private reducedMotion: boolean;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly anchored: { obj: Phaser.GameObjects.GameObject & { x: number; y: number }; ox: number; oy: number }[] = [];
  private static readonly BAR_W = 168;
  private static readonly BAR_H = 12;
  /** Gap between a row's label baseline box and the bar beneath it. */
  private static readonly LABEL_GAP = 4;
  /** Top of the first row, and the vertical pitch between rows. */
  private static readonly ROW_TOP = 10;
  private static readonly ROW_PITCH = 36;
  private static readonly DEPTH = 50;

  constructor(private readonly scene: Phaser.Scene) {
    this.reducedMotion = prefersReducedMotion(AudioManager.get(scene).getSettings());
    const start = scene.children.list.length;
    /**
     * One gauge row: the LABEL first, then its bar underneath. Reading order is
     * name-then-value, so the label must sit above the bar it names - otherwise
     * each bar appears to belong to the label below it and the topmost bar reads
     * as unlabelled. The bar offset is derived from the label's measured height
     * rather than a magic number, so changing the font size cannot desync them.
     */
    const row = (index: number, color: number, label: string): Phaser.GameObjects.Rectangle => {
      const top = Hud.ROW_TOP + index * Hud.ROW_PITCH;
      const text = scene.add.text(12, top, label, textStyle(14)).setDepth(Hud.DEPTH + 1);
      this.labels.push(text);
      const barY = top + text.height + Hud.LABEL_GAP + Hud.BAR_H / 2;
      scene.add.rectangle(12, barY, Hud.BAR_W, Hud.BAR_H, PALETTE.WALL_DARK).setOrigin(0, 0.5).setDepth(Hud.DEPTH);
      return scene.add.rectangle(12, barY, Hud.BAR_W, Hud.BAR_H, color).setOrigin(0, 0.5).setDepth(Hud.DEPTH + 1);
    };
    this.hpBar = row(0, PALETTE.CITIZEN, tr('hud.hp'));
    this.gasBar = row(1, PALETTE.PLAYER, tr('hud.charge'));
    this.outerBar = row(2, PALETTE.ACCENT, tr('hud.outer'));
    this.innerBar = row(3, PALETTE.ACCENT, tr('hud.inner'));
    this.statusText = scene.add.text(CANVAS.WIDTH - 12, 16, '', textStyle(16, { align: 'right' })).setOrigin(1, 0).setDepth(Hud.DEPTH + 1);
    this.phaseText = scene.add.text(CANVAS.WIDTH / 2, 16, '', textStyle(15, { align: 'center' })).setOrigin(0.5, 0).setDepth(Hud.DEPTH + 1);
    // Sits just under the last row's BAR. Derived rather than hardcoded: with the
    // label now above its bar, each row is taller at the bottom, and the old
    // fixed y overlapped the innermost gauge.
    this.warningText = scene.add.text(12, this.innerBar.y + Hud.BAR_H / 2 + Hud.LABEL_GAP, '', textStyle(14, { color: PALETTE.DANGER_CSS })).setDepth(Hud.DEPTH + 1);
    this.waveBanner = scene.add.text(CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.35, '', textStyle(32, { color: PALETTE.DANGER_CSS, fontStyle: 'bold', align: 'center' })).setOrigin(0.5).setDepth(Hud.DEPTH + 2).setAlpha(0);
    this.hint = scene.add.text(CANVAS.WIDTH / 2, CANVAS.HEIGHT - 16, tr('hud.hint'), textStyle(14)).setOrigin(0.5, 1).setDepth(Hud.DEPTH + 1).setAlpha(0.4);
    this.ringGfx = scene.add.graphics().setDepth(Hud.DEPTH + 1);
    this.cueGfx = scene.add.graphics().setDepth(Hud.DEPTH + 2);
    this.threatGfx = scene.add.graphics().setDepth(Hud.DEPTH + 2);
    this.cueText = scene.add.text(0, 0, '', textStyle(12, { fontStyle: 'bold' })).setOrigin(0.5, 1).setDepth(Hud.DEPTH + 3);
    this.captureAnchors(start);
    this.layout();
  }

  private captureAnchors(from: number): void {
    for (let index = from; index < this.scene.children.list.length; index += 1) {
      const object = this.scene.children.list[index] as Phaser.GameObjects.GameObject & { x?: number; y?: number };
      if (object === this.ringGfx || object === this.cueGfx || object === this.threatGfx) continue;
      if (typeof object.x !== 'number' || typeof object.y !== 'number') continue;
      this.anchored.push({ obj: object as Phaser.GameObjects.GameObject & { x: number; y: number }, ox: object.x, oy: object.y });
    }
  }

  layout(): void {
    const view = this.scene.cameras.main.worldView;
    for (const anchor of this.anchored) { anchor.obj.x = view.x + anchor.ox; anchor.obj.y = view.y + anchor.oy; }
  }

  applySettings(settings: GameSettings): void {
    this.reducedMotion = prefersReducedMotion(settings);
    const labelKeys = ['hud.hp', 'hud.charge', 'hud.outer', 'hud.inner'] as const;
    this.labels.forEach((label, index) => label.setText(tr(labelKeys[index])));
    this.hint.setText(tr('hud.hint'));
    if (this.reducedMotion) {
      this.scene.tweens.killTweensOf([this.waveBanner, this.hint, this.cueGfx]);
      this.cueGfx.setAlpha(1);
    }
  }

  flashDamage(): void {
    this.hpBar.setAlpha(0.35).setStrokeStyle(3, PALETTE.TEXT, 1);
    const duration = this.reducedMotion ? Math.min(80, HERO_COMBAT.DAMAGE_FEEDBACK_MS) : HERO_COMBAT.DAMAGE_FEEDBACK_MS;
    this.scene.time.delayedCall(duration, () => this.hpBar.setAlpha(1).setStrokeStyle(0));
  }

  update(state: HudState): void {
    this.layout();
    const fill = (ratio: number): number => Math.max(0, Math.floor(Hud.BAR_W * ratio));
    this.hpBar.setSize(fill(state.hpRatio), Hud.BAR_H);
    this.gasBar.setSize(fill(state.gasRatio), Hud.BAR_H);
    this.outerBar.setSize(fill(state.outerRatio), Hud.BAR_H);
    this.innerBar.setSize(fill(state.innerRatio), Hud.BAR_H);
    this.hpBar.fillColor = state.hpRatio < 0.3 ? 0xff725c : PALETTE.CITIZEN;
    this.gasBar.fillColor = state.gasEmpty ? 0xff725c : PALETTE.PLAYER;
    const warnings: string[] = [];
    if (state.hpRatio < 0.3) warnings.push(`! ${tr('hud.lowHp')}`);
    if (state.gasEmpty) warnings.push(`⚡ ${tr('hud.emptyCharge')}`);
    if (state.outerBreaches.some(Boolean) || state.innerBreaches.some(Boolean)) warnings.push(`◇ ${tr('hud.breach')}`);
    this.warningText.setText(warnings.join('   '));
    this.statusText.setText(tr('hud.status', {
      score: state.score, wave: state.wave, total: state.totalWaves,
      saved: state.citizensSaved, citizensTotal: state.citizensTotal,
      time: (state.activeMs / 1000).toFixed(1),
      input: state.inputMode === 'gamepad' ? 'PAD' : state.inputMode === 'touch' ? 'TCH' : 'KBM',
    }));
    this.phaseText.setText(state.wavePhase === 'countdown'
      ? tr('hud.countdown', { seconds: Math.ceil(state.countdownMs / 1000) })
      : tr(`hud.phase.${state.wavePhase}`));
    this.drawBreachRings(state.outerBreaches, state.innerBreaches);
    this.drawEdgeThreats(state.edgeThreats);
  }

  private drawBreachRings(outer: readonly boolean[], inner: readonly boolean[]): void {
    this.ringGfx.clear();
    const view = this.scene.cameras.main.worldView;
    const cx = view.x + 205;
    const cy = view.y + 112;
    for (const [segments, radius] of [[outer, 18], [inner, 12]] as const) {
      for (let index = 0; index < segments.length; index += 1) {
        const a0 = (index / segments.length) * Math.PI * 2;
        const a1 = ((index + 0.72) / segments.length) * Math.PI * 2;
        this.ringGfx.lineStyle(segments[index] ? 3 : 2, segments[index] ? 0xff725c : PALETTE.TEXT, 1);
        this.ringGfx.beginPath();
        this.ringGfx.arc(cx, cy, radius, a0, a1);
        this.ringGfx.strokePath();
      }
    }
  }

  private drawEdgeThreats(threats: readonly { screenX: number; screenY: number }[]): void {
    this.threatGfx.clear();
    const view = this.scene.cameras.main.worldView;
    const centerX = CANVAS.WIDTH / 2;
    const centerY = CANVAS.HEIGHT / 2;
    for (const threat of threats.slice(0, 6)) {
      const dx = threat.screenX - centerX;
      const dy = threat.screenY - centerY;
      const length = Math.hypot(dx, dy) || 1;
      const scale = Math.min((centerX - 28) / Math.max(Math.abs(dx), 0.001), (centerY - 28) / Math.max(Math.abs(dy), 0.001));
      const x = view.x + centerX + dx * scale;
      const y = view.y + centerY + dy * scale;
      const nx = dx / length;
      const ny = dy / length;
      const px = -ny;
      const py = nx;
      this.threatGfx.fillStyle(0xff725c, 0.95);
      this.threatGfx.fillTriangle(x + nx * 10, y + ny * 10, x - nx * 7 + px * 7, y - ny * 7 + py * 7, x - nx * 7 - px * 7, y - ny * 7 - py * 7);
      this.threatGfx.lineStyle(2, PALETTE.TEXT, 1).lineBetween(x - px * 3, y - py * 3, x + px * 3, y + py * 3);
    }
  }

  drawWeakPointCue(cue: WeakPointCue | null): void {
    this.cueGfx.clear();
    this.cueText.setText('');
    if (!cue) return;
    const view = this.scene.cameras.main.worldView;
    const x = view.x + cue.screenX;
    const y = view.y + cue.screenY;
    const radius = cue.radius;
    const color = cue.state === 'critical' ? 0x59e6ff : PALETTE.ACCENT;
    this.cueGfx.lineStyle(2, color, 1);
    this.cueGfx.strokePoints([
      new Phaser.Geom.Point(x, y - radius), new Phaser.Geom.Point(x + radius, y),
      new Phaser.Geom.Point(x, y + radius), new Phaser.Geom.Point(x - radius, y),
    ], true);
    if (cue.state === 'critical') {
      this.cueGfx.fillStyle(color, 0.7).fillCircle(x, y, Math.max(2, radius * 0.45));
      this.cueText.setPosition(x, y - radius - 3).setText(tr('hud.critical'));
    } else if (cue.state === 'tether') {
      this.cueGfx.lineBetween(x - radius, y + radius + 3, x + radius, y + radius + 3);
      this.cueText.setPosition(x, y - radius - 3).setText(tr('hud.wire'));
    }
    if (!this.reducedMotion && cue.state === 'critical') this.cueGfx.setAlpha(0.85 + Math.sin(this.scene.time.now / 90) * 0.15);
    else this.cueGfx.setAlpha(1);
  }

  announceWave(wave: number, total: number, size: number): void {
    this.waveBanner.setText(`${tr('hud.wave', { wave, total })}\n${tr('hud.incoming', { count: size })}`).setAlpha(1);
    this.scene.tweens.add({ targets: this.waveBanner, alpha: 0, duration: this.reducedMotion ? 80 : 1600, delay: this.reducedMotion ? 0 : 900 });
  }

  showHint(durationMs = 4000): void {
    this.hint.setAlpha(0.75);
    this.scene.tweens.add({ targets: this.hint, alpha: 0.25, delay: this.reducedMotion ? 0 : durationMs, duration: this.reducedMotion ? 80 : 900 });
  }
}
