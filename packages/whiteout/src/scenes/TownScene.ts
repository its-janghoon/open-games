import Phaser from 'phaser';
import { SceneKeys, PALETTE, CANVAS, RESOURCE_ORDER, type SceneKey } from '../config/GameConfig';
import { TextureKeys, AudioKeys, BUILDING_TEXTURE_BY_KIND, RESOURCE_ICON_FRAME, SPARK_ICON_FRAME, MENU_ICON_FRAME } from '../config/AssetKeys';
import { BUILDING_ORDER, buildingDef, isProducer, unlockRequirement } from '../config/BuildingConfig';
import { BUILDING_LAYOUT } from '../config/TownLayout';
import type { BuildingKind, ResourceKind } from '../types';
import { currentObjective, type Objective, type ObjectiveView } from '../systems/ObjectiveSystem';
import { AudioManager } from '../systems/AudioManager';
import { GameState } from '../systems/GameState';
import { Menu, type MenuButton, type ProgressBar } from '../ui/Menu';
import { TrainingPanel } from '../ui/TrainingPanel';
import { PopulationPanel } from '../ui/PopulationPanel';
import { textStyle } from '../ui/UiText';
import { announce, beginModal, mirrorButton } from '../ui/AccessibilityBridge';
import { prefersReducedMotion } from '../ui/Motion';
import { tr } from '../i18n/i18n';
import type { TrKey } from '../i18n/strings';
import { onViewportRefit, type VisibleWorldRect } from '@open-games/shared';

/** The Town hub's links to the FEAT-006 system screens. */
const HUB_LINKS: { key: keyof typeof MENU_ICON_FRAME; scene: SceneKey; label: TrKey }[] = [
  { key: 'hero', scene: SceneKeys.Hero, label: 'nav.hero' },
  { key: 'summon', scene: SceneKeys.Summon, label: 'nav.summon' },
  { key: 'campaign', scene: SceneKeys.Campaign, label: 'nav.campaign' },
  { key: 'research', scene: SceneKeys.Research, label: 'nav.research' },
  { key: 'gear', scene: SceneKeys.Gear, label: 'nav.gear' },
  { key: 'alliance', scene: SceneKeys.Alliance, label: 'nav.alliance' },
  { key: 'arena', scene: SceneKeys.Arena, label: 'nav.arena' },
  { key: 'quest', scene: SceneKeys.Quests, label: 'nav.quests' },
];

/**
 * Format a NET offline resource delta for the "while away" banner. The amount
 * can be negative (the Furnace burned more fuel than was produced), so a
 * positive value is prefixed with '+' and a negative one keeps its '-', making
 * the honest net change unambiguous. Magnitude is floored so tiny fractional
 * drift renders as 0 rather than noise.
 */
function signed(value: number): string {
  const whole = value < 0 ? Math.ceil(value) : Math.floor(value);
  return whole > 0 ? `+${whole}` : String(whole);
}


/** Per-resource live widgets in the top bar. */
interface ResourceWidget {
  res: ResourceKind;
  amount: Phaser.GameObjects.Text;
  rate: Phaser.GameObjects.Text;
}

/** Per-building interactive marker + its overhead level badge. */
interface BuildingMarker {
  kind: BuildingKind;
  sprite: Phaser.GameObjects.Image;
  levelBadge: Phaser.GameObjects.Text;
  /** Dark backing chip sized to the badge text for legibility over the town art. */
  badgeChip: Phaser.GameObjects.Rectangle;
  /** The y the badge was authored at; the de-overlap pass solves from here. */
  badgeAnchorY: number;
}

/** Live warmth readout widgets in the HUD. */
interface WarmthWidgets {
  bar: ProgressBar;
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
}

/**
 * TownScene - the main idle screen.
 *
 * Draws the town backdrop and each building sprite at its map position, a top
 * resource bar (food/wood/coal/iron with icons) that updates every frame from
 * the shared {@link GameState}'s ResourceStore, and ticks idle production live
 * through GameState.tick(delta). Clicking a building opens an upgrade panel
 * showing its current level, next-level cost, upgrade time and an Upgrade
 * button (disabled + greyed when unaffordable or the Furnace prerequisite is
 * unmet) plus an in-progress timer/progress bar while an upgrade builds. A War
 * Camp button opens the {@link TrainingPanel}; a Battle button routes to the
 * BattleScene; a Settings button opens SettingsScene.
 *
 * All state lives in the single GameState instance, so the training panel, the
 * upgrade flow, and (later) the battle all read/write the same simulation.
 */
export class TownScene extends Phaser.Scene {
  /**
   * The one explicit outer margin for the Town HUD (top resource row, the
   * Sparks/Survivors sub-row, and the bottom action bar). Leftmost content
   * starts at HUD_MARGIN and rightmost content ends at 960 - HUD_MARGIN, so the
   * left and right margins match.
   */
  private static readonly HUD_MARGIN = 24;

  private state!: GameState;
  private audio!: AudioManager;

  private resourceWidgets: ResourceWidget[] = [];
  private markers: BuildingMarker[] = [];
  private warmthWidgets!: WarmthWidgets;
  private bgSky!: Phaser.GameObjects.TileSprite;
  private bgTown!: Phaser.GameObjects.Image;

  private trainingPanel!: TrainingPanel;
  private populationPanel!: PopulationPanel;
  private hubMenu?: Phaser.GameObjects.Container;

  // FEAT-003 new-player guidance: a persistent next-step objective banner and a
  // pulsing pointer/glow at the current objective's target building. Both are
  // per-visit widgets (created in create(), cleaned up on SHUTDOWN) so
  // re-entering the Town never touches destroyed objects (Town re-entry fix).
  private objectiveBanner?: Phaser.GameObjects.Container;
  /** Heading line of the banner: '다음 목표 · <step label>'. */
  private objectiveHeading?: Phaser.GameObjects.Text;
  private objectiveLabel?: Phaser.GameObjects.Text;
  private objectivePointer?: Phaser.GameObjects.Container;
  /** The objective id currently reflected in the banner/pointer, or null. */
  private currentObjectiveId: string | null = null;
  /** Set once the guided flow finished during this session (plays SFX once). */
  private guidedFlowSignalled = false;
  private sparksText!: Phaser.GameObjects.Text;
  private populationText!: Phaser.GameObjects.Text;

  // Upgrade panel widgets (rebuilt per selected building).
  private upgradePanel!: Phaser.GameObjects.Container;
  private selected: BuildingKind | null = null;
  private upgradeTitle!: Phaser.GameObjects.Text;
  private upgradeLevel!: Phaser.GameObjects.Text;
  private upgradeDesc!: Phaser.GameObjects.Text;
  private upgradeOutput!: Phaser.GameObjects.Text;
  private upgradeCostLabel!: Phaser.GameObjects.Text;
  private upgradeStatus!: Phaser.GameObjects.Text;
  private upgradeButton!: MenuButton;
  private upgradeProgress!: ProgressBar;

  constructor() {
    super({ key: SceneKeys.Town });
  }

  create(): void {
    this.state = GameState.get();
    this.audio = AudioManager.get(this);

    // Phaser REUSES the scene instance across scene.start() restarts, so these
    // per-widget arrays are only initialized once (at construction) and would
    // otherwise retain references to the Text/Image objects from a previous
    // visit - which were destroyed on shutdown. Re-entering the Town (e.g. from
    // a hub screen) then rebuilt fresh widgets while the stale destroyed ones
    // lingered in the arrays; the per-frame refresh loops later called setText/
    // setColor on those destroyed objects, whose backing canvas is null, which
    // threw inside update() and silently killed the whole render loop (the
    // screen froze on a ~85% black fade that never cleared). Reset them here so
    // every entry starts from a clean slate.
    this.resourceWidgets = [];
    this.markers = [];
    // Per-visit guidance widgets: cleared here so a re-entry never retains
    // references to the destroyed banner/pointer from a previous visit (the
    // same class of bug the resourceWidgets/markers reset guards against).
    this.objectiveBanner = undefined;
    this.objectiveHeading = undefined;
    this.objectiveLabel = undefined;
    this.objectivePointer = undefined;
    this.currentObjectiveId = null;
    this.guidedFlowSignalled = false;

    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    Menu.fadeIn(this);

    // Backdrop. Cover the full visible world rect (taller than 540 on a portrait
    // phone) so there is no flat dead margin: a sky tile fills the whole rect and
    // the town image is anchored to the rect BOTTOM. Building/bar UI stays in the
    // unchanged 960x540 band. Both layers re-fit on resize/orientationchange
    // (shared provider).
    this.bgSky = this.add
      .tileSprite(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, TextureKeys.BgSky)
      .setOrigin(0, 0)
      .setDepth(-30);
    this.bgTown = this.add
      .image(CANVAS.WIDTH / 2, CANVAS.HEIGHT, TextureKeys.BgTown)
      .setOrigin(0.5, 1)
      .setDepth(-29);
    onViewportRefit(this, { width: CANVAS.WIDTH, height: CANVAS.HEIGHT }, (rect) => this.refitBackdrop(rect));

    this.buildBuildings();
    this.buildTopBar();
    this.buildWarmthBar();
    this.buildBottomBar();
    this.buildUpgradePanel();
    this.buildObjectiveGuidance();

    this.trainingPanel = new TrainingPanel(this, this.state);
    this.populationPanel = new PopulationPanel(this, this.state);

    // Keyboard shortcuts.
    this.input.keyboard?.on('keydown-B', () => this.goBattle());
    this.input.keyboard?.on('keydown-S', () => this.openSettings());
    this.input.keyboard?.on('keydown-P', () => this.openPopulation());
    this.input.keyboard?.on('keydown-ESC', () => this.closeUpgradePanel());

    this.audio.playMusic(AudioKeys.MusicLoop);

    // Surface offline gains once, if any were credited on load; on a brand-new
    // hold, show a one-time onboarding hint instead.
    if (this.state.offlineSeconds > 1) {
      this.maybeShowOfflineGains();
    }
    const saveNotice = this.state.loadDiagnostic === 'save_recovered'
      ? tr('save.recovered')
      : this.state.blockedSave
        ? tr('save.blocked')
        : this.state.persistenceWarning
          ? tr('save.persistenceWarning')
          : null;
    if (saveNotice) {
      const isError = this.state.loadDiagnostic !== 'save_recovered';
      announce(saveNotice, isError);
      this.add.text(CANVAS.WIDTH / 2, 124, saveNotice,
        textStyle(12, { color: isError ? PALETTE.DANGER_CSS : PALETTE.SUCCESS_CSS, backgroundColor: PALETTE.PANEL_CSS, padding: { x: 8, y: 5 } }))
        .setOrigin(0.5).setDepth(65);
    }
    // Show the SHORT first-run welcome only for a genuine new player who has
    // never dismissed it. Returning players (or anyone who dismissed it) go
    // straight into the guided objective flow (pointer + banner), never the
    // wall-of-text card.
    if (!this.state.onboarding.introDismissed) {
      this.showOnboarding();
    }

    // Persist on leaving the tab / closing.
    this.game.events.on(Phaser.Core.Events.BLUR, this.saveNow, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, this.saveNow, this);
      // Tear down the per-visit guidance widgets so a later re-entry rebuilds
      // them fresh and the update loop never touches destroyed objects.
      this.objectiveBanner?.destroy();
      this.objectivePointer?.destroy();
      this.objectiveBanner = undefined;
      this.objectiveHeading = undefined;
      this.objectiveLabel = undefined;
      this.objectivePointer = undefined;
      this.saveNow();
    });
  }

  /**
   * Re-fit the sky tile + town skyline to the live visible-world rect. Runs at
   * create() and on every resize/orientationchange so a mid-scene rotate never
   * leaves a dead margin behind the town.
   */
  private refitBackdrop(rect: VisibleWorldRect): void {
    this.bgSky.setPosition(rect.x, rect.y).setSize(rect.width, rect.height);
    this.bgTown
      .setPosition(CANVAS.WIDTH / 2, rect.y + rect.height)
      .setDisplaySize(rect.width, CANVAS.HEIGHT);
  }

  update(_time: number, _delta: number): void {
    const now = Date.now();
    // The app-wide runtime clock in main.ts advances simulation in every scene.
    // Town only refreshes its presentation here, avoiding duplicate credit.

    this.refreshResourceBar();
    this.refreshWarmthBar();
    this.refreshBuildingBadges();
    this.refreshObjectiveGuidance(now);
    this.refreshUpgradePanel(now);
    this.trainingPanel.update();
    this.populationPanel.update();
  }

  // ---- Buildings -----------------------------------------------------------

  private buildBuildings(): void {
    for (const kind of BUILDING_ORDER) {
      const layout = BUILDING_LAYOUT[kind];
      const tex = BUILDING_TEXTURE_BY_KIND[kind];
      // The expanded FEAT-002 city has no sprites yet (art lands in a later
      // feature); skip any building whose texture is not registered so the
      // town renders cleanly while its economy/city logic is already live.
      if (!tex) continue;
      const sprite = this.add
        .image(layout.x, layout.y, tex, 0)
        .setScale(layout.scale)
        .setInteractive({ useHandCursor: true });
      sprite.on(Phaser.Input.Events.POINTER_OVER, () => sprite.setTint(0xfff0c0));
      sprite.on(Phaser.Input.Events.POINTER_OUT, () => sprite.clearTint());
      sprite.on(Phaser.Input.Events.POINTER_DOWN, () => this.selectBuilding(kind));
      mirrorButton(this, tr(`building.${kind}` as TrKey), () => this.selectBuilding(kind));

      // Sit the label a fixed gap ABOVE the sprite's real top edge (its
      // display height varies per building), never over the sprite body, so
      // tall pieces like the Furnace chimney no longer occlude it. A dark
      // backing chip + hard shadow keep it legible over the bright snowfield,
      // and a high depth lifts every label above ALL sprites so a neighbouring
      // building never draws on top of an adjacent label.
      const badgeY = layout.y - sprite.displayHeight / 2 - 12;
      const badgeChip = this.add
        .rectangle(layout.x, badgeY, 10, 16, 0x0d1420, 0.72)
        .setOrigin(0.5)
        .setDepth(20);
      const levelBadge = this.add
        .text(layout.x, badgeY, '', textStyle(12, { color: PALETTE.ACCENT_CSS, fontStyle: 'bold' }))
        .setOrigin(0.5)
        .setDepth(21)
        .setShadow(0, 1, '#000000', 2, true, true);

      this.markers.push({ kind, sprite, levelBadge, badgeChip, badgeAnchorY: badgeY });
    }
  }

  private refreshBuildingBadges(): void {
    for (const marker of this.markers) {
      const level = this.state.buildings.level(marker.kind);
      const upgrading = this.state.buildings.isUpgrading(marker.kind);
      // Building sprites show their upgraded-tier frame once past level 1.
      const frame = level >= 2 ? 1 : 0;
      if (marker.sprite.frame.name !== String(frame)) marker.sprite.setFrame(frame);
      if (level <= 0) {
        // Locked reads in the bright frost tone (not the low-contrast muted
        // grey) so it stays legible against both the chip and the town art.
        // When the lock is a Furnace-level gate, name the REQUIREMENT (e.g.
        // '용광로 Lv.2 필요') instead of a bare 'Locked' so a new player knows
        // exactly what unlocks it; otherwise fall back to the plain label.
        const req = unlockRequirement(marker.kind, level, this.state.buildings.furnaceLevel);
        const text = req.locked
          ? tr('town.lockedRequiresShort', { level: req.requiredFurnaceLevel })
          : tr('town.locked');
        marker.levelBadge.setText(text).setColor(PALETTE.FROST_CSS);
        marker.sprite.setAlpha(0.5);
      } else {
        marker.levelBadge.setText(tr('building.level', { level })).setColor(upgrading ? PALETTE.SUCCESS_CSS : PALETTE.ACCENT_CSS);
        marker.sprite.setAlpha(1);
      }
      // Grow the backing chip to hug the current label so the dark plate always
      // frames the text (level/locked strings differ in width).
      marker.badgeChip.setSize(Math.ceil(marker.levelBadge.width) + 8, Math.ceil(marker.levelBadge.height) + 4);
    }
    this.deoverlapBadges();
  }

  /**
   * Lift badges off each other where their chips collide.
   *
   * Badges hang over their own building, and the plots are packed closer than
   * an unlock label is wide, so neighbouring buildings' labels ran into each
   * other - four of them piled up mid-map and none could be read. Rather than
   * hand-tuning plot positions (which would break again the moment a string or
   * a building is added), walk the badges in reading order and push any one
   * that overlaps an already-placed badge up by a row until it is clear.
   */
  private deoverlapBadges(): void {
    const GAP = 2;
    const ROW = 14;
    const MAX_LIFT = 4;

    const placed: Phaser.Geom.Rectangle[] = [];
    const ordered = [...this.markers].sort(
      (a, b) => a.badgeChip.y - b.badgeChip.y || a.badgeChip.x - b.badgeChip.x,
    );

    for (const marker of ordered) {
      const chip = marker.badgeChip;
      // Reset to the anchor this badge was built at before re-solving, so the
      // lift never accumulates across refreshes.
      chip.y = marker.badgeAnchorY;
      const w = chip.width + GAP * 2;
      const h = chip.height + GAP * 2;
      for (let lift = 0; lift <= MAX_LIFT; lift += 1) {
        const y = marker.badgeAnchorY - lift * ROW;
        const rect = new Phaser.Geom.Rectangle(chip.x - w / 2, y - h / 2, w, h);
        const clear = !placed.some((other) => Phaser.Geom.Rectangle.Overlaps(rect, other));
        if (clear || lift === MAX_LIFT) {
          chip.y = y;
          marker.levelBadge.y = y;
          placed.push(rect);
          break;
        }
      }
    }
  }

  // ---- Top resource bar ----------------------------------------------------

  private buildTopBar(): void {
    const bar = this.add.rectangle(0, 0, CANVAS.WIDTH, 44, PALETTE.PANEL, 0.92).setOrigin(0, 0);
    bar.setStrokeStyle(2, PALETTE.STONE_DARK);

    // One explicit outer margin for the whole top HUD: the leftmost content
    // (first resource icon) starts at M and the rightmost content (last
    // resource's readout) ends at 960 - M, so the left and right margins match.
    // The five resources are DISTRIBUTED evenly across [M, 960-M] rather than
    // packed into the left ~810px, so there is no hollow band on the right.
    const M = TownScene.HUD_MARGIN;
    const innerW = CANVAS.WIDTH - M * 2;
    const slotW = innerW / RESOURCE_ORDER.length;
    const iconScale = 1.4;
    const iconHalf = (16 * iconScale) / 2; // 16px sheet frame at scale 1.4
    const readoutGap = 18; // icon centre -> amount/rate left edge
    let leftEdge = Number.POSITIVE_INFINITY;
    let rightEdge = Number.NEGATIVE_INFINITY;
    RESOURCE_ORDER.forEach((res, i) => {
      // Each resource owns one even slot across [M, 960-M]. Within its slot the
      // icon leads and the amount/rate sit `readoutGap` to its right. Slot 0's
      // icon left edge lands exactly at M; the final slot is nudged so its
      // readout right edge lands exactly at 960 - M, so left margin == right
      // margin and the row fills the width evenly (no hollow right band).
      const iconX = M + iconHalf + slotW * i;
      this.add.image(iconX, 22, TextureKeys.ResourceIcons, RESOURCE_ICON_FRAME[res]).setOrigin(0.5).setScale(iconScale);
      const amount = this.add.text(iconX + readoutGap, 10, '0', textStyle(18, { fontStyle: 'bold' })).setOrigin(0, 0);
      const rate = this.add.text(iconX + readoutGap, 28, '', textStyle(11, { color: PALETTE.SUCCESS_CSS })).setOrigin(0, 0);
      this.resourceWidgets.push({ res, amount, rate });
      leftEdge = Math.min(leftEdge, iconX - iconHalf);
      rightEdge = Math.max(rightEdge, amount.x + amount.width);
    });
    // Dev-only symmetry assertion: the leftmost content's left edge sits at M
    // and the rightmost content's right edge sits at 960 - M (within a couple
    // px of rounding), i.e. the top HUD's left and right margins match.
    if (import.meta.env?.DEV) {
      console.assert(
        Math.abs(leftEdge - M) <= 2,
        `TownScene top HUD: left edge ${leftEdge.toFixed(1)} != M ${M}`,
      );
      console.assert(
        Math.abs(rightEdge - (CANVAS.WIDTH - M)) <= 24,
        `TownScene top HUD: right edge ${rightEdge.toFixed(1)} far from ${CANVAS.WIDTH - M}`,
      );
    }

    // A semi-transparent dark backing strip sits behind the warmth-status band
    // (Output/FREEZING at y=84) and the gameplay hint (y=108) so both read at
    // high contrast against the bright/variable town backdrop instead of nearly
    // disappearing into it. It spans just those two lines and stays clear of the
    // warmth bar (y=60) so the three HUD bands remain visually distinct.
    this.add
      .rectangle(CANVAS.WIDTH / 2, 96, 460, 46, 0x0d1420, 0.62)
      .setOrigin(0.5)
      .setStrokeStyle(1, PALETTE.STONE_DARK, 0.6);

    // The gameplay hint sits in its own band well BELOW the warmth strip (bar
    // at y=60, efficiency readout at y=84) so the three HUD lines are clearly
    // separated into their own vertical bands and never overlap. It renders in
    // the bright frost tone with a hard dark shadow so it stays legible over the
    // backing strip and the town art beneath it.
    this.add
      .text(CANVAS.WIDTH / 2, 108, tr('town.hint'), textStyle(12, { color: PALETTE.FROST_CSS }))
      .setOrigin(0.5)
      .setShadow(0, 1, '#000000', 2, true, true);

    // Ember Sparks (premium) + survivor population readouts on a SECOND HUD row
    // (y=62) just under the resource bar. Both share the outer margin M: the
    // survivor readout is right-aligned to 960 - M so it lines up with the
    // resource row's right edge instead of sitting alone flush against the edge.
    this.add.image(M + 8, 62, TextureKeys.ResourceIcons, SPARK_ICON_FRAME).setOrigin(0.5).setScale(1.2);
    this.sparksText = this.add.text(M + 20, 62, '', textStyle(13, { fontStyle: 'bold', color: PALETTE.SPARK_CSS })).setOrigin(0, 0.5);
    // The survivor readout doubles as the entry point to the workforce panel
    // (assign / recruit / recall), so the population mechanic is playable.
    this.populationText = this.add
      .text(CANVAS.WIDTH - M, 62, '', textStyle(13, { color: PALETTE.FROST_CSS }))
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    this.populationText.on(Phaser.Input.Events.POINTER_OVER, () => this.populationText.setColor(PALETTE.ACCENT_CSS));
    this.populationText.on(Phaser.Input.Events.POINTER_OUT, () => this.populationText.setColor(PALETTE.FROST_CSS));
    this.populationText.on(Phaser.Input.Events.POINTER_DOWN, () => this.openPopulation());
    mirrorButton(this, tr('population.label'), () => this.openPopulation());
  }

  // ---- Warmth HUD ----------------------------------------------------------

  /**
   * A live warmth strip below the resource bar: an ember-coloured progress bar
   * fed each frame from GameState.warmth, its current/max readout, a production
   * -efficiency percentage, and a FREEZING warning when warmth runs low.
   */
  private buildWarmthBar(): void {
    const barW = 240;
    const barX = CANVAS.WIDTH / 2 - barW / 2;
    const barY = 60;

    const label = this.add
      .text(barX - 8, barY, tr('warmth.label'), textStyle(13, { fontStyle: 'bold', color: PALETTE.EMBER_CSS }))
      .setOrigin(1, 0.5);
    const bar = Menu.progressBar(this, barX, barY, barW, 12, PALETTE.EMBER);
    const value = this.add.text(barX + barW + 12, barY, '', textStyle(12, { color: PALETTE.FROST_CSS })).setOrigin(0, 0.5);
    // The efficiency / FREEZING readout sits in its OWN vertical band clearly
    // below the bar (barY=60 -> y=84) and clearly above the town.hint band
    // (y=108), so the three HUD lines never crowd or overlap each other.
    const status = this.add
      .text(CANVAS.WIDTH / 2, barY + 24, '', textStyle(12, { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setShadow(0, 1, '#000000', 2, true, true);

    this.warmthWidgets = { bar, label, value, status };
  }

  private refreshWarmthBar(): void {
    const furnaceLevel = this.state.buildings.furnaceLevel;
    const warmth = this.state.warmth;
    const current = warmth.warmth;
    const max = warmth.maxWarmth(furnaceLevel);
    const ratio = warmth.warmthRatio(furnaceLevel);
    const pct = Math.round(warmth.productionMultiplier(furnaceLevel) * 100);

    const w = this.warmthWidgets;
    w.bar.setProgress(ratio);
    // Fill drifts from warm ember to biting frost-blue as warmth drops.
    w.bar.setFillColor(ratio <= 0.25 ? PALETTE.DANGER : ratio <= 0.5 ? PALETTE.ICE : PALETTE.EMBER);
    w.value.setText(tr('warmth.value', { warmth: Math.floor(current), max: Math.floor(max) }));

    if (ratio <= 0.25) {
      w.status.setText(tr('warmth.freezing')).setColor(PALETTE.DANGER_CSS).setVisible(true);
    } else {
      w.status.setText(tr('warmth.output', { pct })).setColor(pct >= 100 ? PALETTE.SUCCESS_CSS : PALETTE.FROST_CSS).setVisible(true);
    }
  }

  private refreshResourceBar(): void {
    const rates = this.state.effectiveResourceRates();
    for (const w of this.resourceWidgets) {
      w.amount.setText(String(Math.floor(this.state.resources.get(w.res))));
      const rate = rates[w.res];
      w.rate.setText(Math.abs(rate) > 0.0001 ? tr('resource.perSecond', { amount: rate.toFixed(2) }) : '');
    }
    this.sparksText.setText(String(Math.floor(this.state.premium.sparks)));
    const pop = this.state.population;
    const cap = pop.housingCap(this.state.buildings.totalHousing());
    this.populationText.setText(`${tr('population.label')} ${tr('population.value', { total: Math.floor(pop.total), cap: Math.floor(cap) })}`);
  }

  // ---- Bottom action bar ---------------------------------------------------

  private buildBottomBar(): void {
    const y = CANVAS.HEIGHT - 30;
    // Bottom action bar shares the same outer margin M as the top HUD: the
    // leftmost button's left edge sits at M and the rightmost button's right
    // edge sits at 960 - M, so the bottom left/right margins match too.
    const M = TownScene.HUD_MARGIN;
    const leftW = 152;
    const rightW = 180;
    const leftX = M + leftW / 2; // War Camp: left edge == M
    const rightX = CANVAS.WIDTH - M - rightW / 2; // Settings: right edge == 960 - M
    Menu.button(this, leftX, y, tr('town.training'), () => this.openTraining(), { width: leftW });
    Menu.button(this, leftX + leftW + 10, y, tr('nav.menu'), () => this.toggleHubMenu(), { width: leftW, accent: PALETTE.ICE });
    Menu.button(this, CANVAS.WIDTH / 2, y, tr('town.battle'), () => this.goBattle(), { width: 160, accent: PALETTE.DANGER });
    Menu.button(this, rightX, y, tr('town.settings'), () => this.openSettings(), { width: rightW });
  }

  /**
   * The FEAT-006 hub menu: a dismissible overlay of the eight system screens
   * (Heroes, Summon, Expedition, Research, Chief Gear, Pact & Rally, Arena,
   * Duties) reached from the Town hub, each an icon + label routing to its
   * scene. Mirrors the existing Town->Battle/Settings navigation.
   */
  private toggleHubMenu(): void {
    if (this.hubMenu) {
      this.hubMenu.destroy();
      this.hubMenu = undefined;
      return;
    }
    this.closeUpgradePanel();
    // A near-opaque backdrop fully dims the persistent Town HUD (resource bar,
    // warmth strip, hint) so the menu's centered title never reads on top of
    // that text; without it the 0.55 scrim let the HUD bleed through and the
    // title collided with the warmth/hint band.
    const overlay = this.add.rectangle(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, 0x000000, 0.86).setOrigin(0, 0).setInteractive();
    const container = this.add.container(0, 0).setDepth(75);
    container.add(overlay);
    overlay.on(Phaser.Input.Events.POINTER_DOWN, () => this.toggleHubMenu());

    const cols = 4;
    const cellW = 200;
    const cellH = 120;
    const ox = CANVAS.WIDTH / 2 - ((cols - 1) * cellW) / 2;
    const oy = CANVAS.HEIGHT / 2 - 60;
    // Title sits well clear of the (now fully dimmed) HUD band above.
    Menu.title(this, CANVAS.WIDTH / 2, oy - 78, tr('nav.menu'), 30).setColor(PALETTE.ACCENT_CSS);
    HUB_LINKS.forEach((link, i) => {
      const gx = ox + (i % cols) * cellW;
      const gy = oy + Math.floor(i / cols) * cellH;
      const icon = this.add.image(gx, gy - 22, TextureKeys.MenuIcons, MENU_ICON_FRAME[link.key]).setScale(2.5);
      const btn = Menu.button(this, gx, gy + 22, tr(link.label), () => this.openHub(link.scene), { width: 176, fontSize: 15 });
      container.add([icon, btn.container]);
    });
    const close = Menu.button(this, CANVAS.WIDTH / 2, oy + 200, tr('nav.close'), () => this.toggleHubMenu(), { width: 200, fontSize: 15 });
    container.add(close.container);
    this.hubMenu = container;
  }

  private openHub(scene: SceneKey): void {
    this.saveNow();
    Menu.fadeTo(this, () => this.scene.start(scene));
  }

  // ---- Upgrade panel -------------------------------------------------------

  private buildUpgradePanel(): void {
    const w = 300;
    // 350, not 300: the progress bar sits at y + 66 and the two buttons below it
    // are each at least 44px tall (Menu.button's touch-target floor), which does
    // not fit in 300 - the close button used to hang outside the frame and
    // overlap the upgrade button by 10px.
    const h = 350;
    const x = CANVAS.WIDTH - w / 2 - 20;
    const y = CANVAS.HEIGHT / 2 - 10;
    this.upgradePanel = this.add.container(0, 0).setDepth(30).setVisible(false);

    const panel = Menu.panel(this, x, y, w, h);
    panel.setInteractive();
    this.upgradePanel.add(panel);

    const left = x - w / 2 + 20;
    this.upgradeTitle = this.add.text(x, y - h / 2 + 22, '', textStyle(22, { fontStyle: 'bold' })).setOrigin(0.5);
    this.upgradeLevel = this.add.text(x, y - h / 2 + 48, '', textStyle(15, { color: PALETTE.ACCENT_CSS })).setOrigin(0.5);
    this.upgradeDesc = this.add
      .text(left, y - h / 2 + 74, '', textStyle(12, { color: PALETTE.MUTED_CSS, wordWrap: { width: w - 40 } }))
      .setOrigin(0, 0);
    this.upgradeOutput = this.add.text(left, y - 30, '', textStyle(13, { color: PALETTE.SUCCESS_CSS })).setOrigin(0, 0);
    this.upgradeCostLabel = this.add
      .text(left, y - 8, '', textStyle(13, { color: PALETTE.TEXT_CSS, wordWrap: { width: w - 40 } }))
      .setOrigin(0, 0);
    this.upgradeStatus = this.add.text(x, y + 44, '', textStyle(12, { color: PALETTE.DANGER_CSS })).setOrigin(0.5);

    this.upgradeProgress = Menu.progressBar(this, left, y + 66, w - 44, 12, PALETTE.SUCCESS);
    this.upgradeProgress.container.setVisible(false);

    this.upgradeButton = Menu.button(this, x, y + h / 2 - 78, tr('building.upgrade'), () => this.doUpgrade(), {
      width: w - 60,
    });
    // 50px below the upgrade button, not 34: Menu.button enforces a 44px height
    // floor for touch targets, so anything tighter than that overlaps its
    // neighbour no matter what the coordinates say. The panel was grown to 350
    // to fit both buttons under the progress bar at y + 66.
    const close = Menu.button(this, x, y + h / 2 - 28, tr('common.close'), () => this.closeUpgradePanel(), {
      width: w - 60,
      fontSize: 15,
    });

    this.upgradePanel.add([
      this.upgradeTitle,
      this.upgradeLevel,
      this.upgradeDesc,
      this.upgradeOutput,
      this.upgradeCostLabel,
      this.upgradeStatus,
      this.upgradeProgress.container,
      this.upgradeButton.container,
      close.container,
    ]);
  }

  private selectBuilding(kind: BuildingKind): void {
    this.selected = kind;
    this.upgradePanel.setVisible(true);
    this.upgradeTitle.setText(tr(`building.${kind}`));
    this.upgradeDesc.setText(tr(`building.${kind}.desc`));
    this.refreshUpgradePanel(Date.now());
  }

  private closeUpgradePanel(): void {
    this.selected = null;
    this.upgradePanel.setVisible(false);
  }

  private refreshUpgradePanel(now: number): void {
    if (!this.selected || !this.upgradePanel.visible) return;
    const kind = this.selected;
    const buildings = this.state.buildings;
    const level = buildings.level(kind);
    const def = buildingDef(kind);

    if (level > 0) {
      this.upgradeLevel.setText(tr('building.level', { level }));
    } else {
      // A locked building names its Furnace requirement here too, so the panel
      // agrees with the on-map badge instead of a bare 'Locked'.
      const req = unlockRequirement(kind, level, buildings.furnaceLevel);
      this.upgradeLevel.setText(
        req.locked ? tr('town.lockedRequires', { level: req.requiredFurnaceLevel }) : tr('town.locked'),
      );
    }

    // Producer output at current level; the Furnace instead shows its warmth
    // reserve and per-second fuel burn (its defining role).
    if (isProducer(kind) && level > 0) {
      this.upgradeOutput.setText(tr('building.output', { amount: buildings.outputOf(def.produces!).toFixed(1) }));
    } else if (kind === 'furnace' && level > 0) {
      const warmth = this.state.warmth;
      const burn = warmth.fuelPerSecond(level);
      this.upgradeOutput.setColor(PALETTE.EMBER_CSS).setText(
        `${tr('warmth.furnaceInfo', {
          warmth: Math.floor(warmth.warmth),
          max: Math.floor(warmth.maxWarmth(level)),
        })}\n${tr('warmth.fuelBurn', { wood: burn.wood.toFixed(2), coal: burn.coal.toFixed(2) })}`,
      );
    } else {
      this.upgradeOutput.setColor(PALETTE.SUCCESS_CSS).setText('');
    }

    const upgrading = buildings.isUpgrading(kind);
    if (upgrading) {
      const endsAt = buildings.upgradeEndsAt(kind) ?? now;
      const total = buildings.nextUpgradeTimeMs(kind); // not exact if mid-build, but a stable denominator
      const remainingMs = Math.max(0, endsAt - now);
      const seconds = Math.ceil(remainingMs / 1000);
      this.upgradeProgress.container.setVisible(true);
      this.upgradeProgress.setProgress(total > 0 ? 1 - remainingMs / total : 1);
      this.upgradeStatus.setText(tr('building.upgrading', { seconds })).setColor(PALETTE.SUCCESS_CSS);
      this.upgradeCostLabel.setText('');
      this.upgradeButton.setText(tr('building.upgrading', { seconds }));
      this.upgradeButton.setDisabledReason(tr('building.upgrading', { seconds }));
      this.upgradeButton.setEnabled(false);
      return;
    }

    this.upgradeProgress.container.setVisible(false);

    if (level >= def.maxLevel) {
      this.upgradeCostLabel.setText('');
      this.upgradeStatus.setText(tr('building.maxLevel')).setColor(PALETTE.ACCENT_CSS);
      this.upgradeButton.setText(tr('building.maxLevel'));
      this.upgradeButton.setDisabledReason(tr('building.maxLevel'));
      this.upgradeButton.setEnabled(false);
      return;
    }

    // Next-level cost + time.
    const cost = buildings.nextUpgradeCost(kind);
    const timeSec = Math.round(buildings.nextUpgradeTimeMs(kind) / 1000);
    this.upgradeCostLabel.setText(`${this.costString(cost)}\n${tr('tooltip.time', { seconds: timeSec })}`);
    this.upgradeButton.setText(tr('building.upgradeTo', { level: level + 1 }));

    const check = buildings.canUpgrade(kind, this.state.resources);
    if (check.ok) {
      this.upgradeStatus.setText('');
      this.upgradeButton.setDisabledReason('');
      this.upgradeButton.setEnabled(true);
    } else {
      this.upgradeButton.setEnabled(false);
      if (check.reason === 'prereq') {
        this.upgradeStatus.setText(tr('building.lockedByFurnace', { level: def.requiresFurnaceLevel }));
      } else if (check.reason === 'cost') {
        this.upgradeStatus.setText(tr('building.insufficient'));
      } else {
        this.upgradeStatus.setText('');
      }
      this.upgradeButton.setDisabledReason(this.upgradeStatus.text);
    }
  }

  private doUpgrade(): void {
    if (!this.selected) return;
    const now = Date.now();
    const result = this.state.buildings.startUpgrade(
      this.selected,
      this.state.resources,
      now,
      this.state.modifiers().buildSpeed,
    );
    if (result.ok) {
      this.audio.playSfx(AudioKeys.UiClick, 0.7);
      this.state.save(now);
    }
    this.refreshUpgradePanel(now);
  }

  private costString(cost: Partial<Record<ResourceKind, number>>): string {
    return (RESOURCE_ORDER as readonly ResourceKind[])
      .filter((r) => (cost[r] ?? 0) > 0)
      .map((r) => `${cost[r]} ${tr(`resource.${r}`)}`)
      .join(', ');
  }

  // ---- Navigation ----------------------------------------------------------

  private openTraining(): void {
    this.closeUpgradePanel();
    this.trainingPanel.toggle();
  }

  private openPopulation(): void {
    this.closeUpgradePanel();
    this.populationPanel.toggle();
  }

  private goBattle(): void {
    this.saveNow();
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Battle));
  }

  private openSettings(): void {
    this.saveNow();
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Settings, { returnTo: SceneKeys.Town }));
  }

  private saveNow(): void {
    this.state.save(Date.now());
  }

  /**
   * First-run welcome: a SHORT, dismissible centred card (1-2 lines) that hands
   * off to the guided objective flow (the persistent banner + the pulsing
   * pointer at the next building) rather than explaining the whole loop in a
   * paragraph. Shown once for a genuine new player; dismissing it records
   * `introDismissed` in the versioned save so it never re-appears.
   */
  private showOnboarding(): void {
    const cx = CANVAS.WIDTH / 2;
    const cy = CANVAS.HEIGHT / 2;
    const w = 520;
    const h = 176;

    const overlay = this.add.rectangle(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, 0x000000, 0.5).setOrigin(0, 0).setDepth(70).setInteractive();
    const card = this.add.container(0, 0).setDepth(71);
    const modal = beginModal(this, tr('brand.name'));

    const panel = Menu.panel(this, cx, cy, w, h);
    const title = Menu.title(this, cx, cy - h / 2 + 30, tr('brand.name'), 28).setColor(PALETTE.ACCENT_CSS);
    const body = this.add
      .text(cx, cy - 2, tr('town.welcome'), textStyle(15, { align: 'center', color: PALETTE.TEXT_CSS, wordWrap: { width: w - 60 } }))
      .setOrigin(0.5)
      .setLineSpacing(6);

    const dismiss = (): void => {
      // Persist that the intro was seen so a returning player skips it.
      this.state.markIntroDismissed(Date.now());
      modal.close();
      if (prefersReducedMotion()) {
        overlay.destroy();
        card.destroy();
      } else {
        this.tweens.add({
          targets: [overlay, card],
          alpha: 0,
          duration: 250,
          onComplete: () => {
            overlay.destroy();
            card.destroy();
          },
        });
      }
    };
    // Centred at cy + h/2 - 30 = 328, so its 44px touch target spans 306..350 and
    // sits fully inside the card (which ends at 358). It used to be at -12 = 346,
    // centred so low that 10px of the button hung outside the frame.
    // The screenshot harness's dismiss click at logical (480, 346) still lands
    // inside that span; keep this in sync with tools/capture_screenshots.mjs.
    const ok = Menu.button(this, cx, cy + h / 2 - 30, tr('town.welcomeStart'), dismiss, { width: 200 });

    card.add([panel, title, body, ok.container]);
    modal.focusFirst();
    // A gentle entrance so it reads as an intentional, polished welcome.
    card.setAlpha(prefersReducedMotion() ? 1 : 0);
    overlay.setAlpha(prefersReducedMotion() ? 1 : 0);
    if (!prefersReducedMotion()) this.tweens.add({ targets: [overlay, card], alpha: 1, duration: 300, ease: 'Sine.easeOut' });
  }

  // ---- New-player objective guidance (FEAT-003) ----------------------------

  /**
   * Build a read-only {@link ObjectiveView} from the live simulation for the
   * pure {@link ObjectiveSystem}. `battleFought` is derived from the highest
   * wave cleared (a returning player who has fought reads > 0).
   */
  private buildObjectiveView(): ObjectiveView {
    const buildings = this.state.buildings;
    const levels: ObjectiveView['levels'] = {};
    for (const kind of BUILDING_ORDER) {
      levels[kind] = buildings.level(kind);
    }
    return {
      furnaceLevel: buildings.furnaceLevel,
      levels,
      warmthRatio: this.state.warmth.warmthRatio(buildings.furnaceLevel),
      armySize: this.state.armyCount,
      battleFought: this.state.onboarding.battleAttempted === true || this.state.waveCleared > 0,
    };
  }

  /**
   * Create the persistent objective banner (hidden until the first refresh) and
   * the reusable pulsing pointer/glow container (original Phaser-drawn art: a
   * pulsing ring + a bobbing downward arrow). Both start hidden; the per-frame
   * refresh shows/positions them from the ObjectiveSystem.
   *
   * The banner sits in the CLEAR band directly below the HUD (the resource row,
   * warmth strip y=60, output/FREEZING y=84, and hint y=108) and ABOVE the
   * town's building sprites - the topmost of which, the Furnace, begins at
   * y=186 (centre 250, 64px frame at scale 2.0). Placed at y=150 the ~44px
   * strip (y=128..172) clears the hint band beneath (y=108) and never collides
   * with the on-map building sprites or their overhead "Lv.N 필요" unlock
   * labels lower down (which previously overlapped it at y=458). A solid dark
   * backing keeps it legible above the town art. The banner now shows the
   * objective's short LABEL as a heading with the longer instruction beneath,
   * so a new player reads both "what" and "how" for the current step.
   */
  private buildObjectiveGuidance(): void {
    const M = TownScene.HUD_MARGIN;
    // Banner band: a compact two-line strip in the clear space just below the
    // HUD hint band (y=108) and above the Furnace sprite (top edge y=186).
    const bannerW = CANVAS.WIDTH - M * 2 - 320; // leave room for side panels
    const bannerH = 44;
    const bannerX = CANVAS.WIDTH / 2;
    const bannerY = 150;

    const banner = this.add.container(0, 0).setDepth(40).setVisible(false);
    const bg = this.add
      .rectangle(bannerX, bannerY, bannerW, bannerH, 0x0d1420, 0.9)
      .setOrigin(0.5)
      .setStrokeStyle(2, PALETTE.ACCENT, 0.9);
    // Two-line layout: the "다음 목표 · <step label>" heading on top, the
    // instruction below, both fitting the 44px strip. The heading surfaces the
    // objective LABEL (previously defined + tested but never rendered) so the
    // step's short title reads above its longer instruction.
    const heading = this.add
      .text(bannerX - bannerW / 2 + 14, bannerY - 11, tr('objective.title'), textStyle(12, { fontStyle: 'bold', color: PALETTE.ACCENT_CSS }))
      .setOrigin(0, 0.5)
      .setShadow(0, 1, '#000000', 2, true, true);
    const instruction = this.add
      .text(bannerX - bannerW / 2 + 14, bannerY + 10, '', textStyle(12, { color: PALETTE.FROST_CSS }))
      .setOrigin(0, 0.5)
      .setShadow(0, 1, '#000000', 2, true, true);
    const skip = Menu.button(this, bannerX + bannerW / 2 - 42, bannerY, tr('objective.skip'), () => this.state.markGuidedComplete(Date.now()), { width: 72, height: 36, fontSize: 11, padX: 4, padY: 4 });
    banner.add([bg, heading, instruction, skip.container]);
    this.objectiveBanner = banner;
    this.objectiveHeading = heading;
    this.objectiveLabel = instruction;

    // The pointer/glow: a pulsing ring + a bobbing arrow, all original graphics.
    const pointer = this.add.container(0, 0).setDepth(24).setVisible(false);
    const ring = this.add.circle(0, 0, 30, PALETTE.ACCENT, 0).setStrokeStyle(3, PALETTE.ACCENT, 0.9);
    const glow = this.add.circle(0, 0, 20, PALETTE.ACCENT, 0.14);
    // A downward-pointing arrow above the building (drawn as a triangle).
    const arrow = this.add.triangle(0, -48, 0, 0, 20, 0, 10, 14, PALETTE.ACCENT, 0.95).setOrigin(0.5, 0.5);
    arrow.setStrokeStyle(2, 0x0d1420, 0.8);
    pointer.add([glow, ring, arrow]);

    // A steady pulse on the ring/glow and a gentle bob on the arrow so it reads
    // as "tap here" without being noisy. Tweens target children directly.
    if (!prefersReducedMotion()) {
      this.tweens.add({ targets: [ring, glow], scale: { from: 0.85, to: 1.15 }, alpha: { from: 0.9, to: 0.4 }, duration: 780, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: arrow, y: { from: -52, to: -42 }, duration: 620, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.objectivePointer = pointer;
  }

  /**
   * Drive the objective banner + building pointer from the pure ObjectiveSystem
   * each frame. Hides everything when the guided flow is done (unless the
   * low-warmth advisory applies). A returning player whose guided flow is
   * already complete only ever sees the transient low-warmth advisory.
   */
  private refreshObjectiveGuidance(now: number): void {
    if (!this.objectiveBanner || !this.objectivePointer || !this.objectiveLabel || !this.objectiveHeading) return;

    const view = this.buildObjectiveView();
    const guidedDone = this.state.onboarding.guidedComplete;

    // Compute the current objective. For a returning player who finished the
    // guided flow, only the transient warmth advisory should ever show.
    let objective: Objective | null = currentObjective(view);
    if (guidedDone && objective && objective.id !== 'warmth') {
      objective = null;
    }

    // When the ordered flow first reaches "done" for a new player, record it
    // (persist) and play a subtle completion cue once.
    if (!guidedDone) {
      const orderedDone = currentObjective({ ...view, warmthRatio: 1 }) === null;
      if (orderedDone) {
        this.state.markGuidedComplete(now);
        if (!this.guidedFlowSignalled) {
          this.guidedFlowSignalled = true;
          this.audio.playSfx(AudioKeys.BuildComplete, 0.5);
        }
      }
    }

    if (!objective) {
      this.objectiveBanner.setVisible(false);
      this.objectivePointer.setVisible(false);
      this.currentObjectiveId = null;
      return;
    }

    // Play a subtle cue when the objective advances to a NEW step.
    if (this.currentObjectiveId !== null && this.currentObjectiveId !== objective.id) {
      this.audio.playSfx(AudioKeys.UiClick, 0.4);
    }
    this.currentObjectiveId = objective.id;

    this.objectiveBanner.setVisible(true);
    // Heading: the persistent title plus the current step's short LABEL, so the
    // banner reads "다음 목표 · 용광로 올리기" with the instruction beneath.
    this.objectiveHeading.setText(`${tr('objective.title')} · ${tr(objective.label)}`);
    this.objectiveLabel.setText(tr(objective.instruction));

    // Position the pointer over the target building's map slot (above its
    // sprite). Hide it for objectives with no building target.
    if (objective.target && BUILDING_LAYOUT[objective.target]) {
      const layout = BUILDING_LAYOUT[objective.target];
      this.objectivePointer.setPosition(layout.x, layout.y - 8).setVisible(true);
    } else {
      this.objectivePointer.setVisible(false);
    }
  }

  private maybeShowOfflineGains(): void {
    if (!this.state.loaded || this.state.offlineSeconds <= 1) return;
    const g = this.state.offlineGains;
    // offlineGains is a NET bundle: production minus furnace fuel burn, so
    // wood/coal can be negative. Suppress only a truly negligible window - use
    // the summed MAGNITUDE of the net change so a meaningful net loss (e.g. the
    // Furnace outburned production) still surfaces, not just net gains.
    const magnitude = Math.abs(g.food) + Math.abs(g.wood) + Math.abs(g.coal) + Math.abs(g.iron) + Math.abs(g.steel);
    if (magnitude < 1) return;
    const summary = tr('save.offlineGains', {
      food: signed(g.food),
      wood: signed(g.wood),
      coal: signed(g.coal),
      iron: signed(g.iron),
      steel: signed(g.steel),
    });
    announce(summary);
    const banner = this.add
      .text(
        CANVAS.WIDTH / 2,
        90,
        summary,
        textStyle(13, { color: PALETTE.ACCENT_CSS, backgroundColor: PALETTE.PANEL_CSS, padding: { x: 8, y: 6 }, wordWrap: { width: 600 }, align: 'center' }),
      )
      .setOrigin(0.5)
      .setDepth(60);
    this.tweens.add({ targets: banner, alpha: 0, delay: 4500, duration: 800, onComplete: () => banner.destroy() });
  }
}
