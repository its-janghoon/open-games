import Phaser from 'phaser';
import { SceneKeys, PALETTE, CANVAS, GAME_STATE } from '../config/GameConfig';
import type { HeroInstance } from '../types';
import {
  TextureKeys,
  AudioKeys,
  GRADE_FRAME_FRAME,
  HERO_PORTRAIT_TYPE_INDEX,
  HERO_PORTRAIT_ROLE_INDEX,
} from '../config/AssetKeys';
import { AudioManager } from '../systems/AudioManager';
import { GameStore } from '../systems/GameStore';
import { heroDef } from '../config/Heroes';
import { placedHeroIds, type Row } from '../systems/Formation';
import { teamPower } from '../systems/League';
import { tr } from '../i18n/i18n';
import type { TrKey } from '../i18n/strings';
import { Menu } from '../ui/Menu';
import { textStyle } from '../ui/UiText';

/** Data passed when launching the Formation scene. */
export interface FormationSceneData {
  /** Scene key to return to when Formation closes. Defaults to Heroes. */
  returnTo?: string;
}

/** A rendered formation slot (front or back row). */
interface Slot {
  row: Row;
  index: number;
  x: number;
  y: number;
  bg: Phaser.GameObjects.Rectangle;
  portrait: Phaser.GameObjects.Image;
  frame: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  zone: Phaser.GameObjects.Zone;
}

/** A rendered roster bench chip the player picks / drags from. */
interface BenchChip {
  heroId: string;
  container: Phaser.GameObjects.Container;
  portrait: Phaser.GameObjects.Image;
}

const SLOT_SIZE = 64;

/**
 * FormationScene - assign owned heroes to the 2-front / 3-back squad board,
 * validated entirely by the tested {@link Formation} system (FEAT-003). The
 * player either taps a bench hero then a slot (touch-friendly) or drags a bench
 * hero onto a slot (desktop). Every placement routes through
 * {@link GameStore.setFormationSlot}, which validates via the pure
 * {@link validateFormation} and persists.
 *
 * A live team-power readout (from the tested {@link teamPower} over the
 * assembled team) and a clear same-type +20% buff indicator (from the assembled
 * team's `sameTypeBuff`) update after every change. No combat / stat math lives
 * here - the scene only reads the store's assembled team and renders.
 */
export class FormationScene extends Phaser.Scene {
  private returnTo: string = SceneKeys.Heroes;
  private slots: Slot[] = [];
  private benchChips: BenchChip[] = [];
  private selectedHeroId: string | null = null;
  private selectionText!: Phaser.GameObjects.Text;
  private powerText!: Phaser.GameObjects.Text;
  private buffText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: SceneKeys.Formation });
  }

  create(data: FormationSceneData): void {
    this.returnTo = data?.returnTo ?? SceneKeys.Heroes;
    this.slots = [];
    this.benchChips = [];
    this.selectedHeroId = null;
    const cx = CANVAS.WIDTH / 2;

    this.cameras.main.resetFX();
    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    Menu.fadeIn(this);
    AudioManager.get(this).playMusic();

    this.add.image(cx, 0, TextureKeys.BgBattle).setOrigin(0.5, 0).setAlpha(0.35);

    Menu.title(this, cx, CANVAS.HEIGHT * 0.06, tr('formation.title'), 32).setColor(PALETTE.SQUAD_CSS);
    Menu.label(this, cx, CANVAS.HEIGHT * 0.1, tr('formation.tapToPlace'), 11, 0.7, true);

    this.powerText = this.add
      .text(cx, CANVAS.HEIGHT * 0.135, '', textStyle(16, { fontStyle: 'bold', color: PALETTE.ACCENT_CSS, allowSmall: true }))
      .setOrigin(0.5);
    this.buffText = this.add
      .text(cx, CANVAS.HEIGHT * 0.165, '', textStyle(12, { align: 'center', color: PALETTE.SUCCESS_CSS, allowSmall: true }))
      .setOrigin(0.5);

    this.buildBoard();
    this.buildBench();

    this.selectionText = this.add
      .text(cx, CANVAS.HEIGHT * 0.6, '', textStyle(12, { align: 'center', color: PALETTE.SQUAD_CSS, allowSmall: true }))
      .setOrigin(0.5);

    Menu.button(this, cx - 100, CANVAS.HEIGHT * 0.955, tr('formation.remove'), () => this.clearSelectedSlot(), { width: 150 });
    Menu.button(this, cx + 100, CANVAS.HEIGHT * 0.955, tr('common.back'), () => this.close(), { width: 150 });

    this.input.keyboard?.on('keydown-ESC', () => this.close());

    this.refresh();
  }

  /** Build the 2-front / 3-back board of drop slots. */
  private buildBoard(): void {
    const cx = CANVAS.WIDTH / 2;
    const frontY = CANVAS.HEIGHT * 0.25;
    const backY = CANVAS.HEIGHT * 0.4;

    Menu.label(this, cx, frontY - 52, tr('formation.front'), 12, 0.7, true);
    Menu.label(this, cx, backY - 52, tr('formation.back'), 12, 0.7, true);

    this.layoutRow('front', GAME_STATE.FORMATION.FRONT_SLOTS, frontY);
    this.layoutRow('back', GAME_STATE.FORMATION.BACK_SLOTS, backY);
  }

  /** Lay out a row of `count` slots centered horizontally at `y`. */
  private layoutRow(row: Row, count: number, y: number): void {
    const gap = 84;
    const totalW = (count - 1) * gap;
    const startX = CANVAS.WIDTH / 2 - totalW / 2;
    for (let i = 0; i < count; i += 1) {
      const x = startX + i * gap;
      const bg = this.add.rectangle(x, y, SLOT_SIZE, SLOT_SIZE, PALETTE.PANEL, 0.85).setStrokeStyle(2, PALETTE.LANE_LINE);
      const portrait = this.add.image(x, y, TextureKeys.HeroPortraits, 0).setScale(1.6).setVisible(false);
      const frame = this.add.image(x, y, TextureKeys.GradeFrames, 0).setScale(1.6).setVisible(false);
      const label = this.add.text(x, y + SLOT_SIZE / 2 + 8, tr('formation.empty'), textStyle(9, { align: 'center', allowSmall: true })).setOrigin(0.5);
      const zone = this.add
        .zone(x, y, SLOT_SIZE, SLOT_SIZE)
        .setInteractive({ useHandCursor: true });
      const slot: Slot = { row, index: i, x, y, bg, portrait, frame, label, zone };
      zone.on(Phaser.Input.Events.POINTER_DOWN, () => this.onSlotTapped(slot));
      this.slots.push(slot);
    }
  }

  /** Build the bench of owned heroes not yet placed (draggable + tappable). */
  private buildBench(): void {
    const store = GameStore.get();
    const owned = Object.values(store.state.heroes.roster) as HeroInstance[];
    const placed = new Set(placedHeroIds(store.formation()));

    const bench = owned.filter((h) => !placed.has(h.id));
    const cols = 5;
    const cellW = CANVAS.WIDTH / cols;
    const startY = CANVAS.HEIGHT * 0.66;
    const rowH = 78;

    if (owned.length === 0) {
      Menu.label(this, CANVAS.WIDTH / 2, startY + 20, tr('heroes.rosterEmpty'), 13, 0.8, true);
      return;
    }

    bench.forEach((hero, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const x = cellW * col + cellW / 2;
      const y = startY + rowIdx * rowH;
      this.benchChips.push(this.makeBenchChip(hero, x, y));
    });
  }

  /** Build one draggable/tappable bench chip for an owned hero. */
  private makeBenchChip(hero: HeroInstance, x: number, y: number): BenchChip {
    const def = heroDef(hero.id);
    const portraitFrame = def ? HERO_PORTRAIT_TYPE_INDEX[def.type] * 3 + HERO_PORTRAIT_ROLE_INDEX[def.role] : 0;
    const gradeFrame = def ? GRADE_FRAME_FRAME[def.grade] : 0;

    const bg = this.add.rectangle(0, 0, 58, 58, PALETTE.PANEL, 0.9).setStrokeStyle(2, PALETTE.ACCENT);
    const portrait = this.add.image(0, -4, TextureKeys.HeroPortraits, portraitFrame).setScale(1.4);
    const frame = this.add.image(0, -4, TextureKeys.GradeFrames, gradeFrame).setScale(1.4);
    const name = this.add
      .text(0, 22, def ? tr(def.nameKey as TrKey) : hero.id, textStyle(8, { align: 'center', allowSmall: true }))
      .setOrigin(0.5);

    const container = this.add.container(x, y, [bg, portrait, frame, name]);
    container.setSize(58, 58);
    // setSize-derived hit box, NOT an explicit centred Geom.Rectangle:
    // pointWithinHitArea already normalizes the pointer by displayOrigin, so
    // `Rectangle(-29, -29, 58, 58)` double-applies the half-size shift and the
    // card only responds 29px up and left of where it is drawn - which also
    // makes the drag grab feel like it misses.
    container.setInteractive({ useHandCursor: true });
    this.input.setDraggable(container);

    const home = { x, y };
    container.on(Phaser.Input.Events.POINTER_DOWN, () => this.selectHero(hero.id));
    container.on(Phaser.Input.Events.DRAG, (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      container.setPosition(dragX, dragY);
      container.setDepth(50);
    });
    container.on(Phaser.Input.Events.DRAG_END, (p: Phaser.Input.Pointer) => {
      container.setDepth(0);
      const slot = this.slotAt(p.worldX, p.worldY);
      if (slot) {
        this.selectHero(hero.id);
        this.placeInSlot(slot);
      }
      container.setPosition(home.x, home.y);
    });

    return { heroId: hero.id, container, portrait };
  }

  /** The board slot under a world point, or null. */
  private slotAt(worldX: number, worldY: number): Slot | null {
    for (const slot of this.slots) {
      if (
        Math.abs(worldX - slot.x) <= SLOT_SIZE / 2 &&
        Math.abs(worldY - slot.y) <= SLOT_SIZE / 2
      ) {
        return slot;
      }
    }
    return null;
  }

  /** Select a bench hero (tap-to-place flow). */
  private selectHero(heroId: string): void {
    this.selectedHeroId = heroId;
    AudioManager.get(this).playSfx(AudioKeys.UiClick, 0.5);
    for (const chip of this.benchChips) {
      const on = chip.heroId === heroId;
      chip.portrait.setTint(on ? PALETTE.SQUAD : 0xffffff);
    }
    const def = heroDef(heroId);
    this.selectionText.setText(tr('formation.selected', { name: def ? tr(def.nameKey as TrKey) : heroId }));
  }

  /** Tapping a slot: if a hero is selected, place it; else select any occupant. */
  private onSlotTapped(slot: Slot): void {
    if (this.selectedHeroId) {
      this.placeInSlot(slot);
      return;
    }
    // No selection: tapping an occupied slot selects its hero for a move.
    const occupant = this.occupantOf(slot);
    if (occupant) this.selectHero(occupant);
  }

  /** The hero id currently in a slot, or null. */
  private occupantOf(slot: Slot): string | null {
    const formation = GameStore.get().formation();
    const arr = slot.row === 'front' ? formation.front : formation.back;
    return arr[slot.index] ?? null;
  }

  /** Place the selected hero into `slot` via the store, then rebuild. */
  private placeInSlot(slot: Slot): void {
    if (!this.selectedHeroId) return;
    const store = GameStore.get();
    if (store.setFormationSlot(slot.row, slot.index, this.selectedHeroId)) {
      AudioManager.get(this).playSfx(AudioKeys.TabSwitch, 0.6);
      this.tweens.add({ targets: slot.bg, scale: { from: 1.15, to: 1 }, duration: 220, ease: 'Back.out' });
      this.showToast(tr('formation.saved'));
    } else {
      this.showToast(tr('formation.duplicate'));
    }
    this.selectedHeroId = null;
    this.rebuildBench();
    this.refresh();
  }

  /** Clear the last-selected slot's occupant, if the selection is a slot hero. */
  private clearSelectedSlot(): void {
    // If a placed hero is selected, remove it from its slot.
    if (!this.selectedHeroId) {
      this.showToast(tr('formation.tapToPlace'));
      return;
    }
    const store = GameStore.get();
    const formation = store.formation();
    const findAndClear = (row: Row, arr: (string | null)[]): boolean => {
      const idx = arr.indexOf(this.selectedHeroId);
      if (idx >= 0) {
        store.setFormationSlot(row, idx, null);
        return true;
      }
      return false;
    };
    const cleared = findAndClear('front', formation.front) || findAndClear('back', formation.back);
    if (cleared) {
      AudioManager.get(this).playSfx(AudioKeys.UiClick, 0.6);
    }
    this.selectedHeroId = null;
    this.rebuildBench();
    this.refresh();
  }

  /** Destroy + rebuild the bench chips after a placement changes the roster set. */
  private rebuildBench(): void {
    for (const chip of this.benchChips) chip.container.destroy(true);
    this.benchChips = [];
    this.buildBench();
  }

  /** Repaint every board slot from the stored formation + the live readouts. */
  private refresh(): void {
    const store = GameStore.get();
    const formation = store.formation();
    for (const slot of this.slots) {
      const arr = slot.row === 'front' ? formation.front : formation.back;
      const id = arr[slot.index] ?? null;
      const def = id ? heroDef(id) : undefined;
      if (id && def) {
        const portraitFrame = HERO_PORTRAIT_TYPE_INDEX[def.type] * 3 + HERO_PORTRAIT_ROLE_INDEX[def.role];
        slot.portrait.setFrame(portraitFrame).setVisible(true);
        slot.frame.setFrame(GRADE_FRAME_FRAME[def.grade]).setVisible(true);
        slot.label.setText(tr(def.nameKey as TrKey));
        slot.bg.setStrokeStyle(2, PALETTE.SQUAD);
      } else {
        slot.portrait.setVisible(false);
        slot.frame.setVisible(false);
        slot.label.setText(tr('formation.empty'));
        slot.bg.setStrokeStyle(2, PALETTE.LANE_LINE);
      }
    }

    // Live team power + same-type buff indicator from the assembled team.
    const team = store.battleTeam();
    this.powerText.setText(tr('formation.teamPower', { power: teamPower(team) }));
    if (team.sameTypeBuff) {
      this.buffText.setText(tr('formation.sameTypeBuff')).setColor(PALETTE.SUCCESS_CSS);
    } else {
      this.buffText.setText(tr('formation.buffOff')).setColor(PALETTE.MUTED_CSS);
    }
  }

  private toast: Phaser.GameObjects.Container | null = null;

  /** A short auto-dismissing toast. */
  private showToast(message: string): void {
    if (this.toast) {
      this.toast.destroy(true);
      this.toast = null;
    }
    const cx = CANVAS.WIDTH / 2;
    const y = CANVAS.HEIGHT * 0.9;
    const text = this.add.text(0, 0, message, textStyle(13, { align: 'center' })).setOrigin(0.5);
    const bg = Menu.panel(this, 0, 0, Math.ceil(text.width) + 40, 40, 0.96);
    const toast = this.add.container(cx, y, [bg, text]).setDepth(60);
    this.toast = toast;
    this.tweens.add({
      targets: toast,
      alpha: { from: 1, to: 0 },
      delay: 1100,
      duration: 400,
      onComplete: () => {
        toast.destroy(true);
        if (this.toast === toast) this.toast = null;
      },
    });
  }

  private close(): void {
    Menu.fadeTo(this, () => this.scene.start(this.returnTo, { returnTo: SceneKeys.Home }));
  }
}
