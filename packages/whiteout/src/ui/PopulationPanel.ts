import Phaser from 'phaser';
import { CANVAS, PALETTE, POPULATION } from '../config/GameConfig';
import { AudioKeys, BUILDING_TEXTURE_BY_KIND } from '../config/AssetKeys';
import { BUILDING_ORDER, isProducer } from '../config/BuildingConfig';
import type { BuildingKind } from '../types';
import { AudioManager } from '../systems/AudioManager';
import { GameState } from '../systems/GameState';
import { tr } from '../i18n/i18n';
import { Menu, type MenuButton } from './Menu';
import { textStyle } from './UiText';

/** Per-producer assignment row widgets that need live updates. */
interface AssignRow {
  kind: BuildingKind;
  nameLabel: Phaser.GameObjects.Text;
  countLabel: Phaser.GameObjects.Text;
  minus: MenuButton;
  plus: MenuButton;
}

/**
 * PopulationPanel - the survivor workforce interface (review v3).
 *
 * The pure {@link PopulationSystem} already models the whole WOS-style loop -
 * total survivors, per-producer assignment, satisfaction, and a staffing-driven
 * output multiplier - but before this panel nothing let the player ASSIGN,
 * RECRUIT, or RECALL survivors, so staffing sat at the STAFFING_FLOOR (0.35)
 * forever. This panel surfaces those actions so the upper ~65% of the staffing
 * multiplier is attainable:
 *
 *   - a Recruit button pulls idle survivors in (toward the housing cap),
 *   - each producer building gets a +/- assignment selector (idle -> working),
 *   - a Recall All button frees every assigned survivor back to idle.
 *
 * All logic stays in the pure system reached through the single shared
 * {@link GameState}; this is a plain container overlay (like TrainingPanel) so
 * TownScene can toggle it without a scene switch.
 */
export class PopulationPanel {
  private readonly scene: Phaser.Scene;
  private readonly state: GameState;
  private readonly root: Phaser.GameObjects.Container;
  private readonly rows: AssignRow[] = [];
  private summaryText!: Phaser.GameObjects.Text;
  private staffText!: Phaser.GameObjects.Text;
  private recruitButton!: MenuButton;
  private _visible = false;

  constructor(scene: Phaser.Scene, state: GameState) {
    this.scene = scene;
    this.state = state;
    this.root = scene.add.container(0, 0).setDepth(50).setVisible(false);
    this.build();
  }

  get visible(): boolean {
    return this._visible;
  }

  setVisible(visible: boolean): void {
    this._visible = visible;
    this.root.setVisible(visible);
    if (visible) this.refresh();
  }

  toggle(): void {
    this.setVisible(!this._visible);
  }

  /** The producer buildings a survivor can be assigned to work. */
  private producerKinds(): BuildingKind[] {
    return BUILDING_ORDER.filter((k) => isProducer(k) || k === 'forge_hall');
  }

  private build(): void {
    const cx = CANVAS.WIDTH / 2;
    const cy = CANVAS.HEIGHT / 2;
    const panelW = 620;
    const panelH = 460;

    const backdrop = this.scene.add
      .rectangle(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setInteractive();
    backdrop.on(Phaser.Input.Events.POINTER_DOWN, () => this.setVisible(false));
    this.root.add(backdrop);

    const panel = Menu.panel(this.scene, cx, cy, panelW, panelH);
    panel.setInteractive();
    this.root.add(panel);

    this.root.add(Menu.title(this.scene, cx, cy - panelH / 2 + 34, tr('population.title'), 30));

    const left = cx - panelW / 2 + 40;
    // The Recruit/Recall buttons occupy the panel's right side, so these lines
    // may only use the width to their left. Both are created empty and filled by
    // setText from translated strings, so their length is unknown here - the same
    // shape that let the objective strip's instruction run out past its frame.
    const summaryW = panelW - 335;

    // Summary: total / idle / working + satisfaction.
    this.summaryText = this.scene.add
      .text(left, cy - panelH / 2 + 68, '', textStyle(15, { color: PALETTE.FROST_CSS, wordWrap: { width: summaryW } }))
      .setOrigin(0, 0);
    this.root.add(this.summaryText);
    this.staffText = this.scene.add
      .text(left, cy - panelH / 2 + 90, '', textStyle(13, { color: PALETTE.SUCCESS_CSS, wordWrap: { width: summaryW } }))
      .setOrigin(0, 0);
    this.root.add(this.staffText);

    // Recruit + Recall actions.
    this.recruitButton = Menu.button(
      this.scene,
      cx + panelW / 2 - 210,
      cy - panelH / 2 + 82,
      tr('population.recruit'),
      () => this.recruit(),
      { width: 150, fontSize: 14, padY: 6 },
    );
    this.root.add(this.recruitButton.container);
    const recall = Menu.button(
      this.scene,
      cx + panelW / 2 - 60,
      cy - panelH / 2 + 82,
      tr('population.recallAll'),
      () => this.recallAll(),
      { width: 120, fontSize: 14, padY: 6, accent: PALETTE.DANGER },
    );
    this.root.add(recall.container);

    // Per-producer assignment rows.
    let y = cy - panelH / 2 + 128;
    for (const kind of this.producerKinds()) {
      this.buildAssignRow(kind, left, y, panelW - 80);
      y += 52;
    }

    const close = Menu.button(this.scene, cx, cy + panelH / 2 - 30, tr('common.close'), () => this.setVisible(false), {
      width: 180,
    });
    this.root.add(close.container);
  }

  private buildAssignRow(kind: BuildingKind, x: number, y: number, width: number): void {
    const tex = BUILDING_TEXTURE_BY_KIND[kind];
    if (tex) {
      const icon = this.scene.add.image(x + 16, y + 8, tex, 0).setOrigin(0.5).setScale(1.1);
      this.root.add(icon);
    }
    const nameLabel = this.scene.add
      .text(x + 40, y, tr(`building.${kind}`), textStyle(15, { fontStyle: 'bold' }))
      .setOrigin(0, 0.5);
    this.root.add(nameLabel);

    const selectorX = x + width - 200;
    const countLabel = this.scene.add.text(selectorX + 60, y, '0', textStyle(18)).setOrigin(0.5);
    const minus = Menu.button(this.scene, selectorX + 20, y, '\u2212', () => this.assignDelta(kind, -1), {
      width: 34,
      height: 34,
      fontSize: 18,
    });
    const plus = Menu.button(this.scene, selectorX + 100, y, '+', () => this.assignDelta(kind, 1), {
      width: 34,
      height: 34,
      fontSize: 18,
    });
    this.root.add(minus.container);
    this.root.add(countLabel);
    this.root.add(plus.container);

    this.rows.push({ kind, nameLabel, countLabel, minus, plus });
  }

  private assignDelta(kind: BuildingKind, delta: number): void {
    const pop = this.state.population;
    const current = pop.assignedTo(kind);
    pop.assign(kind, current + delta, this.state.buildings.level(kind));
    this.audio().playSfx(AudioKeys.UiClick, 0.4);
    this.state.save(Date.now());
    this.refresh();
  }

  private recruit(): void {
    const pop = this.state.population;
    const added = pop.recruit(POPULATION.RECRUIT_BATCH, this.state.buildings.totalHousing());
    if (added > 0) {
      this.audio().playSfx(AudioKeys.BuildComplete, 0.4);
      this.state.save(Date.now());
    }
    this.refresh();
  }

  private recallAll(): void {
    this.state.population.recallAll();
    this.audio().playSfx(AudioKeys.UiClick, 0.5);
    this.state.save(Date.now());
    this.refresh();
  }

  private audio(): AudioManager {
    return AudioManager.get(this.scene);
  }

  /** Refresh all live labels + button enablement against current state. */
  refresh(): void {
    if (!this._visible) return;
    const pop = this.state.population;
    const extraHousing = this.state.buildings.totalHousing();
    const cap = pop.housingCap(extraHousing);
    const warmthRatio = this.state.warmth.warmthRatio(this.state.buildings.furnaceLevel);
    const desiredStaff = this.state.buildings.totalProducerLevels() * POPULATION.STAFF_PER_PRODUCER_LEVEL;

    this.summaryText.setText(
      `${tr('population.value', { total: Math.floor(pop.total), cap: Math.floor(cap) })}   ·   ${tr('population.assigned', { assigned: pop.assigned, idle: pop.idle })}`,
    );
    const satisfactionPct = Math.round(pop.satisfaction(warmthRatio, extraHousing) * 100);
    const outputPct = Math.round(pop.outputMultiplier(warmthRatio, extraHousing, desiredStaff) * 100);
    this.staffText.setText(
      `${tr('population.satisfaction', { pct: satisfactionPct })}   ·   ${tr('population.workforceOutput', { pct: outputPct })}`,
    );

    // Recruit is only meaningful while there is housing room.
    this.recruitButton.setEnabled(pop.total < cap);

    for (const row of this.rows) {
      const assigned = pop.assignedTo(row.kind);
      const built = this.state.buildings.level(row.kind) > 0;
      row.countLabel.setText(String(assigned));
      row.nameLabel.setColor(built ? PALETTE.TEXT_CSS : PALETTE.MUTED_CSS);
      // Can only assign to a built producer, and only when a survivor is idle.
      row.plus.setEnabled(built && pop.idle > 0 && assigned < this.state.buildings.level(row.kind));
      row.minus.setEnabled(built && assigned > 0);
    }
  }

  update(): void {
    if (this._visible) this.refresh();
  }

  destroy(): void {
    this.root.destroy();
  }
}
