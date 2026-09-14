import Phaser from 'phaser';
import { SceneKeys, PALETTE, CANVAS, RESOURCE_ORDER, HUD } from '../config/GameConfig';
import { stackRows } from '../config/HudLayout';
import { TextureKeys, AudioKeys, BUILDING_TEXTURE_BY_KIND, RESOURCE_ICON_FRAME } from '../config/AssetKeys';
import { BUILDING_ORDER, buildingDef, isProducer } from '../config/BuildingConfig';
import type { BuildingKind, ResourceKind } from '../types';
import { AudioManager } from '../systems/AudioManager';
import { GameState } from '../systems/GameState';
import { Menu, type MenuButton, type ProgressBar } from '../ui/Menu';
import { TrainingPanel } from '../ui/TrainingPanel';
import { ResearchPanel } from '../ui/ResearchPanel';
import { HeroPanel } from '../ui/HeroPanel';
import { QuestPanel } from '../ui/QuestPanel';
import { textStyle } from '../ui/UiText';
import { tr } from '../i18n/i18n';
import { TutorialFlow, type TutorialAnchor, type TutorialProgress } from '../systems/TutorialFlow';
import { TutorialOverlay, type AnchorRect } from '../ui/TutorialOverlay';
import { announceStatus, closeAccessibleModal, openAccessibleModal, refreshAccessibleModalContext, removeAccessibleState, updateAccessibleState } from '../ui/Accessibility';
import { onViewportRefit, type VisibleWorldRect } from '@open-games/shared';
import { CombatSystem } from '../systems/CombatSystem';
import { TOTAL_WAVES, waveComposition } from '../config/WaveConfig';

/** Fixed layout position for each building sprite on the town map. */
const BUILDING_LAYOUT: Record<BuildingKind, { x: number; y: number; scale: number }> = {
  town_center: { x: 480, y: 250, scale: 2.0 },
  farm: { x: 250, y: 300, scale: 1.8 },
  lumber_mill: { x: 700, y: 300, scale: 1.8 },
  quarry: { x: 170, y: 400, scale: 1.8 },
  mine: { x: 790, y: 400, scale: 1.8 },
  barracks: { x: 380, y: 425, scale: 1.9 },
  research: { x: 560, y: 425, scale: 1.8 },
  wall: { x: 250, y: 470, scale: 1.7 },
  watchtower: { x: 700, y: 470, scale: 1.7 },
};

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
}

/**
 * TownScene - the main idle screen.
 *
 * Draws the town backdrop and each building sprite at its map position, a top
 * resource bar (food/wood/stone/gold with icons) that updates every frame from
 * the shared {@link GameState}'s ResourceStore, and ticks idle production live
 * through GameState.tick(delta). Clicking a building opens an upgrade panel
 * showing its current level, next-level cost, upgrade time and an Upgrade
 * button (disabled + greyed when unaffordable or the Town-Center prerequisite
 * is unmet) plus an in-progress timer/progress bar while an upgrade builds.
 * A Barracks button opens the {@link TrainingPanel}; a Battle button routes to
 * the BattleScene; a Settings button opens SettingsScene.
 *
 * All state lives in the single GameState instance, so the training panel, the
 * upgrade flow, and (later) the battle all read/write the same simulation.
 */
export class TownScene extends Phaser.Scene {
  private state!: GameState;
  private audio!: AudioManager;

  private resourceWidgets: ResourceWidget[] = [];
  private markers: BuildingMarker[] = [];
  private topLayer!: Phaser.GameObjects.Container;
  private bottomLayer!: Phaser.GameObjects.Container;
  private visibleRect: VisibleWorldRect = { x: 0, y: 0, width: CANVAS.WIDTH, height: CANVAS.HEIGHT };
  private bgSky!: Phaser.GameObjects.TileSprite;
  private bgTown!: Phaser.GameObjects.Image;
  /** Always-visible early hint under the Lumber Mill until it is built. */
  private woodHint!: Phaser.GameObjects.Text;
  private defenseLabel!: Phaser.GameObjects.Text;
  private warmthLabel!: Phaser.GameObjects.Text;
  private warmthBar!: ProgressBar;
  private warmthWarning!: Phaser.GameObjects.Text;
  private saveStatusLabel!: Phaser.GameObjects.Text;
  private lastWarmthLow: boolean | null = null;
  private lastSaveState: string | null = null;
  private battlePanel!: Phaser.GameObjects.Container;
  private battleDetails!: Phaser.GameObjects.Text;
  private battleStatus!: Phaser.GameObjects.Text;
  private battleConfirm!: MenuButton;
  private selectedReplayWave = 1;
  private battleLaunching = false;

  private trainingPanel!: TrainingPanel;
  private researchPanel!: ResearchPanel;
  private heroPanel!: HeroPanel;
  private questPanel!: QuestPanel;

  /**
   * Dismisses the first-run onboarding card when set (non-null only while the
   * card is on screen). Any panel/battle/settings action calls
   * {@link dismissOnboardingIfOpen} FIRST, so the card is torn down before a
   * panel can open — the two can never visibly overlap — while the requested
   * action still proceeds (so hotkeys keep working, not silently swallowed).
   */
  private onboardingDismiss: (() => void) | null = null;

  /**
   * The first-run interactive tutorial. Non-null only while the guided tour is
   * running for a brand-new player (or a replay from Settings). The pure
   * {@link TutorialFlow} owns sequencing; {@link TutorialOverlay} renders the
   * active step's coach-mark, and {@link update} watches the shared GameState
   * each frame to advance gameplay steps.
   */
  private tutorialFlow: TutorialFlow | null = null;
  private tutorialOverlay: TutorialOverlay | null = null;

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

    // Phaser reuses the SAME scene instance across scene.start/restart, so any
    // per-create accumulator arrays survive the transition still holding the
    // PREVIOUS run's GameObjects. Those old objects were destroyed on SHUTDOWN
    // (their Text frame data is now null), so if buildBuildings()/buildTopBar()
    // merely push onto them, update() would iterate the stale, destroyed
    // widgets and crash (e.g. setColor -> updateText -> null frame.drawImage on
    // returning from Settings). Reset them to empty on every create so we only
    // ever hold freshly-built objects.
    this.resourceWidgets = [];
    this.markers = [];
    this.selected = null;
    this.onboardingDismiss = null;
    this.tutorialFlow = null;
    this.tutorialOverlay = null;
    this.lastWarmthLow = null;
    this.lastSaveState = null;

    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    Menu.fadeIn(this);

    // Backdrop. Cover the full visible world rect (taller than 540 on a portrait
    // phone) so there is no flat dead margin: a sky tile fills the whole rect and
    // the town image is anchored to the rect BOTTOM (ground reaches the bottom
    // edge). The building/bar UI stays authored in the unchanged 960x540 band.
    // Both layers re-fit on resize/orientationchange via the shared provider.
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
    this.buildBottomBar();
    this.layoutResponsiveTownUi();
    this.buildUpgradePanel();
    this.buildBattlePanel();

    this.trainingPanel = new TrainingPanel(this, this.state);
    this.researchPanel = new ResearchPanel(this, this.state);
    this.heroPanel = new HeroPanel(this, this.state);
    this.questPanel = new QuestPanel(this, this.state);

    // Keyboard shortcuts (non-conflicting single keys).
    this.input.keyboard?.on('keydown-B', () => this.goBattle());
    this.input.keyboard?.on('keydown-S', () => this.openSettings());
    this.input.keyboard?.on('keydown-R', () => this.openResearch());
    this.input.keyboard?.on('keydown-H', () => this.openHeroes());
    this.input.keyboard?.on('keydown-Q', () => this.openQuests());
    this.input.keyboard?.on('keydown-ESC', () => this.closeAllPanels());

    this.audio.playMusic(AudioKeys.MusicLoop);

    // First-run experience: a brand-new player (or a Settings replay) runs the
    // guided interactive tutorial, which ABSORBS the old single welcome card.
    // Everyone else surfaces any offline gains once. We still mark the old
    // onboarding flag seen so its once-only invariant (and its tests) hold, but
    // the tutorial — not the static popup — is what a new player actually sees.
    if (this.state.shouldRunTutorial()) {
      this.state.markOnboardingSeen();
      this.startTutorial();
    } else {
      this.maybeShowOfflineGains();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      removeAccessibleState('town');
      this.saveNow();
    });
  }

  /**
   * Re-fit the sky tile + town skyline to the live visible-world rect. Runs at
   * create() and on every resize/orientationchange so a mid-scene rotate never
   * leaves a dead margin behind the town.
   */
  private refitBackdrop(rect: VisibleWorldRect): void {
    this.visibleRect = rect;
    this.bgSky.setPosition(rect.x, rect.y).setSize(rect.width, rect.height);
    this.bgTown
      .setPosition(CANVAS.WIDTH / 2, rect.y + rect.height)
      .setDisplaySize(rect.width, CANVAS.HEIGHT);
    this.layoutResponsiveTownUi();
  }

  /** Anchor HUD/actions to portrait safe edges instead of a shrunken center band. */
  private layoutResponsiveTownUi(): void {
    if (!this.topLayer || !this.bottomLayer) return;
    const portrait = this.visibleRect.height > CANVAS.HEIGHT * 1.25;
    this.topLayer.y = portrait ? this.visibleRect.y + 12 : 0;
    this.bottomLayer.y = portrait ? this.visibleRect.y + this.visibleRect.height - CANVAS.HEIGHT - 12 : 0;
  }

  update(_time: number, _delta: number): void {
    const now = Date.now();
    // The global RuntimeCoordinator advances simulation in every scene. Town is
    // a subscriber/view only, preventing duplicate ticks across transitions.
    this.refreshResourceBar();
    this.refreshBuildingBadges();
    this.refreshUpgradePanel(now);
    if (this.upgradePanel.visible) refreshAccessibleModalContext(this.upgradePanel);
    if (this.battlePanel.visible) refreshAccessibleModalContext(this.battlePanel);
    this.trainingPanel.update();
    this.researchPanel.update();
    this.heroPanel.update();
    this.questPanel.update();
    this.tutorialTick();
  }

  // ---- Buildings -----------------------------------------------------------

  private buildBuildings(): void {
    for (const kind of BUILDING_ORDER) {
      const layout = BUILDING_LAYOUT[kind];
      const tex = BUILDING_TEXTURE_BY_KIND[kind];
      const sprite = this.add
        .image(layout.x, layout.y, tex, 0)
        .setScale(layout.scale)
        .setInteractive({ useHandCursor: true });
      sprite.on(Phaser.Input.Events.POINTER_OVER, () => sprite.setTint(0xfff0c0));
      sprite.on(Phaser.Input.Events.POINTER_OUT, () => sprite.clearTint());
      sprite.on(Phaser.Input.Events.POINTER_DOWN, () => this.selectBuilding(kind));

      const levelBadge = this.add
        .text(layout.x, layout.y - 34 * layout.scale * 0.5 - 10, '', textStyle(13, { color: PALETTE.ACCENT_CSS, fontStyle: 'bold' }))
        .setOrigin(0.5);

      this.markers.push({ kind, sprite, levelBadge });
    }

    // A persistent early nudge toward WOOD: a small caption under the Lumber
    // Mill telling a new player to build it first. Hidden the moment the mill
    // is standing (see refreshBuildingBadges). Kept off to the side/below the
    // sprite so it never overlaps the overhead level badge.
    const mill = BUILDING_LAYOUT.lumber_mill;
    this.woodHint = this.add
      .text(mill.x, mill.y + 46, tr('town.woodHint'), textStyle(11, {
        color: PALETTE.SUCCESS_CSS,
        fontStyle: 'bold',
        backgroundColor: PALETTE.PANEL_CSS,
        padding: { x: 5, y: 3 },
        align: 'center',
        wordWrap: { width: 150 },
      }))
      .setOrigin(0.5, 0)
      .setDepth(6)
      .setVisible(false);
  }

  private refreshBuildingBadges(): void {
    // Show the wood nudge only while the Lumber Mill is unbuilt.
    this.woodHint.setVisible(this.state.buildings.level('lumber_mill') < 1);
    for (const marker of this.markers) {
      const level = this.state.buildings.level(marker.kind);
      const upgrading = this.state.buildings.isUpgrading(marker.kind);
      // Building sprites show their upgraded-tier frame once past level 1.
      const frame = level >= 2 ? 1 : 0;
      if (marker.sprite.frame.name !== String(frame)) marker.sprite.setFrame(frame);
      if (level <= 0) {
        // Distinguish "buildable now" from "truly locked" so a building the
        // player can raise this instant (e.g. the Lumber Mill on a fresh game)
        // no longer looks like a dead-end 'Locked' tile. Only a building gated
        // behind a higher Town Center shows the muted locked-reason label.
        const badge = this.state.buildings.badgeState(marker.kind, this.state.resources);
        if (badge.state === 'buildable') {
          marker.levelBadge.setText(tr('town.buildable')).setColor(PALETTE.SUCCESS_CSS);
          // Keep it inviting — only lightly dimmed so it still reads as "go here".
          marker.sprite.setAlpha(0.85);
        } else {
          marker.levelBadge
            .setText(tr('town.lockedReason', { level: badge.requiredTownCenterLevel }))
            .setColor(PALETTE.MUTED_CSS);
          marker.sprite.setAlpha(0.5);
        }
      } else {
        marker.levelBadge.setText(tr('building.level', { level })).setColor(upgrading ? PALETTE.SUCCESS_CSS : PALETTE.ACCENT_CSS);
        marker.sprite.setAlpha(1);
      }
    }
  }

  // ---- Top resource bar ----------------------------------------------------

  private buildTopBar(): void {
    this.topLayer = this.add.container(0, 0).setDepth(5);
    const bar = this.add.rectangle(0, 0, CANVAS.WIDTH, HUD.BAR_MIN_HEIGHT, PALETTE.PANEL, 0.92).setOrigin(0, 0);
    bar.setStrokeStyle(2, PALETTE.STONE_DARK);
    this.topLayer.add(bar);

    const slotW = CANVAS.WIDTH / RESOURCE_ORDER.length;
    // The amount and its rate line are stacked from their MEASURED heights, not from
    // hand-picked y values: an 18px bold amount renders about 24px tall, so the old
    // 18px step put the rate line 7px inside it.
    // Annotated: HUD is `as const`, so an inferred type would be the literal 44 and
    // could not accumulate.
    let contentBottom: number = HUD.BAR_MIN_HEIGHT;
    RESOURCE_ORDER.forEach((res, i) => {
      const x = slotW * i + 20;
      const amount = this.add.text(x + 20, 0, '0', textStyle(18, { fontStyle: 'bold' })).setOrigin(0, 0);
      const rate = this.add.text(x + 20, 0, '', textStyle(11, { color: PALETTE.SUCCESS_CSS })).setOrigin(0, 0);
      // A deferred (empty) rate measures 0, so give the stack a floor.
      const rows = stackRows([amount.height, Math.max(rate.height, 13)], {
        top: HUD.BAR_PAD,
        gap: HUD.ROW_GAP_TIGHT,
      });
      amount.setY(rows[0].top);
      rate.setY(rows[1].top);
      contentBottom = Math.max(contentBottom, rows[1].bottom + HUD.BAR_PAD);

      const icon = this.add
        .image(x, rows[0].centre, TextureKeys.ResourceIcons, RESOURCE_ICON_FRAME[res])
        .setOrigin(0.5)
        .setScale(1.4);
      this.topLayer.add([icon, amount, rate]);
      this.resourceWidgets.push({ res, amount, rate });
    });
    // Grow the bar to whatever its content actually needs rather than trusting a
    // fixed 44px to be enough in every language.
    bar.height = contentBottom;

    // Everything below the bar is one stack too. Three rows previously sat at y 52,
    // 60 and 70 - 18px of space for three rows of 11-13px text - which is where the
    // remaining collisions came from.
    const probe = this.add.text(0, -999, 'Ag', textStyle(13, { fontStyle: 'bold' })).setOrigin(0, 0);
    const rowH = Math.max(probe.height, 16);
    const warnProbe = this.add.text(0, -999, 'Ag', textStyle(11, { fontStyle: 'bold' })).setOrigin(0, 0);
    const warnH = Math.max(warnProbe.height, 14);
    probe.destroy();
    warnProbe.destroy();
    const below = stackRows([rowH, rowH, warnH], {
      top: contentBottom + HUD.ROW_GAP,
      gap: HUD.ROW_GAP,
    });

    const hint = Menu.label(this, CANVAS.WIDTH / 2, below[1].centre, tr('town.hint'), 12, 0.55).setColor(PALETTE.MUTED_CSS);
    this.topLayer.add(hint);

    // Town-defense readout: the aggregate wall/watchtower defense the combat
    // resolver factors into every raid. Sits top-right, updated each frame.
    this.defenseLabel = this.add
      .text(CANVAS.WIDTH - 12, below[0].centre, '', textStyle(13, { color: PALETTE.ACCENT_CSS, fontStyle: 'bold' }))
      .setOrigin(1, 0.5)
      .setDepth(5);

    // Hearth WARMTH (온기) meter: the keep's central hearth must stay lit or
    // production is throttled. A labelled bar sits top-left just under the
    // resource bar, with a prominent low-warmth warning when the fire dies.
    this.warmthLabel = this.add
      .text(20, below[0].centre, '', textStyle(13, { color: PALETTE.ACCENT_CSS, fontStyle: 'bold' }))
      .setOrigin(0, 0.5)
      .setDepth(5);
    this.warmthBar = Menu.progressBar(this, 150, below[0].centre, 120, 10, PALETTE.ACCENT);
    this.warmthBar.container.setDepth(5);
    this.warmthWarning = this.add
      .text(150, below[2].centre, '', textStyle(11, { color: PALETTE.DANGER_CSS, fontStyle: 'bold' }))
      .setOrigin(0, 0.5)
      .setDepth(5)
      .setVisible(false);
    this.saveStatusLabel = this.add
      .text(CANVAS.WIDTH - 12, below[2].centre, '', textStyle(11, { color: PALETTE.DANGER_CSS, fontStyle: 'bold' }))
      .setOrigin(1, 0.5)
      .setDepth(6)
      .setInteractive({ useHandCursor: true });
    this.saveStatusLabel.on(Phaser.Input.Events.POINTER_DOWN, () => this.state.retrySave());
    this.topLayer.add([
      this.defenseLabel,
      this.warmthLabel,
      this.warmthBar.container,
      this.warmthWarning,
      this.saveStatusLabel,
    ]);
  }

  private refreshResourceBar(): void {
    const rates = this.state.economyRates();
    for (const w of this.resourceWidgets) {
      w.amount.setText(`${Math.floor(this.state.resources.get(w.res))}/${Math.floor(rates.cap)}`);
      const gross = rates.gross[w.res];
      const net = rates.net[w.res];
      w.rate.setText(
        gross !== 0 || net !== 0
          ? tr('resource.rateGrossNet', { gross: gross.toFixed(1), net: net.toFixed(1) })
          : '',
      );
      w.rate.setColor(net < 0 ? PALETTE.DANGER_CSS : PALETTE.SUCCESS_CSS);
    }
    this.defenseLabel.setText(tr('town.defenseWave', {
      value: Math.round(this.state.townDefense()),
      wave: this.state.nextCampaignWave ?? TOTAL_WAVES,
      total: TOTAL_WAVES,
    }));
    this.saveStatusLabel
      .setText(this.state.saveState === 'error' ? tr('save.failedRetry') : this.state.saveState === 'dirty' ? tr('save.dirty') : tr('save.saved'))
      .setColor(this.state.saveState === 'error' ? PALETTE.DANGER_CSS : PALETTE.MUTED_CSS);
    this.refreshWarmth();
    const resourceState = RESOURCE_ORDER.map((resource) => tr('a11y.resourceState', {
      resource: tr(`resource.${resource}`),
      amount: Math.floor(this.state.resources.get(resource)),
      cap: Math.floor(rates.cap),
      gross: rates.gross[resource].toFixed(1),
      net: rates.net[resource].toFixed(1),
    })).join(' ');
    updateAccessibleState('town', tr('town.title'), [
      resourceState,
      this.warmthLabel.text,
      this.warmthWarning.visible ? this.warmthWarning.text : '',
      this.defenseLabel.text,
      this.saveStatusLabel.text,
    ].filter(Boolean).join(' '));
    if (this.lastSaveState !== this.state.saveState && this.state.saveState === 'error') {
      announceStatus(tr('save.failedRetry'));
    }
    this.lastSaveState = this.state.saveState;
  }

  /**
   * Update the Hearth warmth meter. The bar fills with the current warmth ratio
   * and its colour shifts from warm accent -> danger as the fire dies; below a
   * quarter warmth a legible warning tells the player to stock wood (the same
   * "explain the state" care used for the Barracks / research locks).
   */
  private refreshWarmth(): void {
    const ratio = this.state.warmthRatio();
    const pct = Math.round(ratio * 100);
    const current = this.state.warmth.warmth;
    const max = this.state.warmth.maxWarmth(this.state.buildings.townCenterLevel);
    const economy = this.state.economyRates();
    const fuelSeconds = economy.fuelPerSecond > 0 ? this.state.resources.get('wood') / economy.fuelPerSecond : 0;
    this.warmthLabel.setText(tr('town.warmthDetails', {
      current: Math.round(current),
      max: Math.round(max),
      pct,
      mult: this.state.warmthMultiplier().toFixed(2),
      fuel: economy.fuelPerSecond.toFixed(2),
      seconds: Math.floor(fuelSeconds),
    }));
    this.warmthBar.setProgress(ratio);
    const low = ratio < 0.35;
    this.warmthBar.setFillColor(low ? PALETTE.DANGER : PALETTE.ACCENT);
    this.warmthLabel.setColor(low ? PALETTE.DANGER_CSS : PALETTE.ACCENT_CSS);
    if (low) {
      this.warmthWarning.setText(tr('town.warmthLow')).setVisible(true);
      if (this.lastWarmthLow === false) announceStatus(tr('town.warmthLowHint'));
    } else {
      this.warmthWarning.setVisible(false);
    }
    this.lastWarmthLow = low;
  }

  // ---- Bottom action bar ---------------------------------------------------

  private buildBottomBar(): void {
    this.bottomLayer = this.add.container(0, 0).setDepth(10);
    // Six actions now share the bottom bar (Barracks / Research / Heroes /
    // Quests / Battle / Settings). Lay them out as one evenly-spaced compact
    // row across the 960px canvas so nothing overlaps or runs off the edge.
    // Battle is accented (danger) as the primary action.
    const y = CANVAS.HEIGHT - 28;
    const entries: { label: string; action: () => void; accent?: number }[] = [
      { label: tr('town.training'), action: () => this.openTraining() },
      { label: tr('town.research'), action: () => this.openResearch() },
      { label: tr('town.heroes'), action: () => this.openHeroes() },
      { label: tr('town.quests'), action: () => this.openQuests() },
      { label: tr('town.battle'), action: () => this.goBattle(), accent: PALETTE.DANGER },
      { label: tr('town.settings'), action: () => this.openSettings() },
    ];
    const slotW = CANVAS.WIDTH / entries.length;
    const btnW = slotW - 14;
    entries.forEach((e, i) => {
      const x = slotW * i + slotW / 2;
      const button = Menu.button(this, x, y, e.label, e.action, { width: btnW, height: 40, fontSize: 15, accent: e.accent });
      this.bottomLayer.add(button.container);
    });
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
    openAccessibleModal(this.upgradePanel, () => this.closeUpgradePanel());
    this.upgradeTitle.setText(tr(`building.${kind}`));
    this.upgradeDesc.setText(tr(`building.${kind}.desc`));
    this.refreshUpgradePanel(Date.now());
  }

  private closeAllPanels(): void {
    this.closeUpgradePanel();
    this.closeBattlePanel();
    if (this.trainingPanel?.visible) this.trainingPanel.setVisible(false);
    if (this.researchPanel?.visible) this.researchPanel.setVisible(false);
    if (this.heroPanel?.visible) this.heroPanel.setVisible(false);
    if (this.questPanel?.visible) this.questPanel.setVisible(false);
  }

  private closeUpgradePanel(): void {
    this.selected = null;
    closeAccessibleModal(this.upgradePanel);
    this.upgradePanel.setVisible(false);
  }

  private refreshUpgradePanel(now: number): void {
    if (!this.selected || !this.upgradePanel.visible) return;
    const kind = this.selected;
    const buildings = this.state.buildings;
    const level = buildings.level(kind);
    const def = buildingDef(kind);

    // Level line: a standing building shows its level; an unbuilt one shows an
    // inviting "buildable" affordance rather than a bare '잠김' — the locked
    // string is reserved for buildings still gated behind a higher Town Center.
    const badge = buildings.badgeState(kind, this.state.resources);
    if (level > 0) {
      this.upgradeLevel.setText(tr('building.level', { level })).setColor(PALETTE.ACCENT_CSS);
    } else if (badge.state === 'buildable') {
      this.upgradeLevel.setText(tr('town.buildable')).setColor(PALETTE.SUCCESS_CSS);
    } else {
      this.upgradeLevel
        .setText(tr('town.lockedReason', { level: badge.requiredTownCenterLevel }))
        .setColor(PALETTE.MUTED_CSS);
    }

    // Producer output at current level.
    if (isProducer(kind) && level > 0) {
      this.upgradeOutput.setText(tr('building.output', { amount: buildings.outputOf(def.produces!).toFixed(1) }));
    } else {
      this.upgradeOutput.setText('');
    }

    const upgrading = buildings.isUpgrading(kind);
    if (upgrading) {
      const endsAt = buildings.upgradeEndsAt(kind) ?? now;
      const total = buildings.nextUpgradeTimeMs(kind) * this.state.research.buildSpeedMultiplier();
      const remainingMs = Math.max(0, endsAt - now);
      const seconds = Math.ceil(remainingMs / 1000);
      this.upgradeProgress.container.setVisible(true);
      this.upgradeProgress.setProgress(total > 0 ? 1 - remainingMs / total : 1);
      this.upgradeStatus.setText(tr('building.upgrading', { seconds })).setColor(PALETTE.SUCCESS_CSS);
      this.upgradeCostLabel.setText('');
      this.upgradeButton.setText(tr('building.upgrading', { seconds }));
      this.upgradeButton.setEnabled(false);
      return;
    }

    this.upgradeProgress.container.setVisible(false);

    if (level >= def.maxLevel) {
      this.upgradeCostLabel.setText('');
      this.upgradeStatus.setText(tr('building.maxLevel')).setColor(PALETTE.ACCENT_CSS);
      this.upgradeButton.setText(tr('building.maxLevel'));
      this.upgradeButton.setEnabled(false);
      return;
    }

    // Next-level cost + time.
    const cost = buildings.nextUpgradeCost(kind);
    const timeSec = Math.round(buildings.nextUpgradeTimeMs(kind) * this.state.research.buildSpeedMultiplier() / 1000);
    this.upgradeCostLabel.setText(`${this.costString(cost)}\n${tr('tooltip.time', { seconds: timeSec })}`);
    // Level 0 is the initial BUILD, not an "upgrade to Lv.1" — say so plainly.
    this.upgradeButton.setText(level > 0 ? tr('building.upgradeTo', { level: level + 1 }) : tr('building.build'));

    const check = buildings.canUpgrade(kind, this.state.resources);
    if (check.ok) {
      this.upgradeStatus.setText('');
      this.upgradeButton.setEnabled(true);
    } else {
      this.upgradeButton.setEnabled(false);
      if (check.reason === 'prereq') {
        this.upgradeStatus.setText(tr('building.lockedByTownCenter', { level: def.requiresTownCenterLevel }));
      } else if (check.reason === 'cost') {
        this.upgradeStatus.setText(tr('building.insufficient'));
      } else {
        this.upgradeStatus.setText('');
      }
    }
  }

  private doUpgrade(): void {
    if (!this.selected) return;
    const now = Date.now();
    let result: ReturnType<typeof this.state.buildings.startUpgrade> = { ok: false, reason: 'cost' };
    const committed = this.state.commitDurableAction(() => {
      result = this.state.buildings.startUpgrade(
        this.selected!,
        this.state.resources,
        now,
        this.state.research.buildSpeedMultiplier(),
      );
      return result.ok;
    }, now);
    if (committed) {
      this.audio.playSfx(AudioKeys.UiClick, 0.7);
    }
    this.refreshUpgradePanel(now);
  }

  private costString(cost: Partial<Record<ResourceKind, number>>): string {
    return (RESOURCE_ORDER as readonly ResourceKind[])
      .filter((r) => (cost[r] ?? 0) > 0)
      .map((r) => `${cost[r]} ${tr(`resource.${r}`)}`)
      .join(', ');
  }

  // ---- Battle preflight ----------------------------------------------------

  private buildBattlePanel(): void {
    const cx = CANVAS.WIDTH / 2;
    this.battlePanel = this.add.container(0, 0).setDepth(70).setVisible(false);
    const dim = this.add.rectangle(0, 0, CANVAS.WIDTH, CANVAS.HEIGHT, 0x000000, 0.6).setOrigin(0, 0).setInteractive();
    dim.on(Phaser.Input.Events.POINTER_DOWN, () => this.closeBattlePanel());
    // Height 460, not 410: the action row sits at y=425 and the close button
    // below it needs a full 44px (Menu.button's touch-target floor) plus a gap,
    // which a 410-tall panel (y 65..475) could not give - the close button was
    // centred exactly on the panel's bottom edge and hung 22px outside it.
    const panel = Menu.panel(this, cx, CANVAS.HEIGHT / 2, 620, 460);
    panel.setInteractive();
    const title = Menu.title(this, cx, 88, tr('battle.preflightTitle'), 28);
    this.battleDetails = this.add.text(cx, 130, '', textStyle(14, { align: 'left', wordWrap: { width: 550 } })).setOrigin(0.5, 0);
    this.battleStatus = this.add.text(cx, 382, '', textStyle(13, { color: PALETTE.DANGER_CSS, align: 'center' })).setOrigin(0.5);
    const previous = Menu.button(this, cx - 240, 330, '◀', () => this.changeReplayWave(-1), { width: 48, height: 44 });
    const next = Menu.button(this, cx + 240, 330, '▶', () => this.changeReplayWave(1), { width: 48, height: 44 });
    const trainShortcut = Menu.button(this, cx - 170, 425, tr('town.training'), () => {
      this.closeBattlePanel();
      this.openTraining();
    }, { width: 180, height: 44 });
    this.battleConfirm = Menu.button(this, cx + 110, 425, tr('battle.confirmDeploy'), () => this.confirmBattle(), { width: 240, height: 44, accent: PALETTE.DANGER });
    const close = Menu.button(this, cx, 470, tr('common.close'), () => this.closeBattlePanel(), { width: 180, height: 44 });
    this.battlePanel.add([dim, panel, title, this.battleDetails, this.battleStatus, previous.container, next.container, trainShortcut.container, this.battleConfirm.container, close.container]);
  }

  private openBattlePanel(): void {
    this.closeAllPanels();
    this.battleLaunching = false;
    this.selectedReplayWave = this.state.nextCampaignWave ?? Math.max(1, this.state.waveCleared);
    this.battlePanel.setVisible(true);
    openAccessibleModal(this.battlePanel, () => this.closeBattlePanel());
    this.refreshBattlePreflight();
  }

  private closeBattlePanel(): void {
    if (!this.battlePanel) return;
    closeAccessibleModal(this.battlePanel);
    this.battlePanel.setVisible(false);
  }

  private changeReplayWave(delta: number): void {
    if (this.state.nextCampaignWave !== null) return;
    this.selectedReplayWave = Phaser.Math.Clamp(this.selectedReplayWave + delta, 1, TOTAL_WAVES);
    this.refreshBattlePreflight();
  }

  private refreshBattlePreflight(): void {
    if (!this.battlePanel.visible) return;
    const wave = this.selectedReplayWave;
    const replay = this.state.nextCampaignWave === null;
    const composition = waveComposition(wave)
      .map((entry) => `${tr(`enemy.${entry.kind}`)} ×${entry.count}`)
      .join(', ');
    const armyPower = CombatSystem.effectiveArmyPower(
      this.state.army,
      wave,
      this.state.combatAttackMultiplier(),
      this.state.townDefense(),
    );
    const wavePower = CombatSystem.wavePower(wave);
    const warning = armyPower < wavePower ? tr('battle.matchupWarning') : tr('battle.ready');
    this.battleDetails.setText([
      tr('battle.preflightWave', { wave, total: TOTAL_WAVES }),
      tr('battle.preflightArmy', { count: this.state.armyCount, power: armyPower.toFixed(1) }),
      tr('battle.preflightEnemy', { power: wavePower.toFixed(1), composition }),
      tr('battle.preflightDefense', { defense: Math.round(this.state.townDefense()) }),
      warning,
      replay ? tr('battle.replayNotice') : '',
    ].filter(Boolean).join('\n\n'));
    if (this.state.armyCount <= 0) {
      this.battleStatus.setText(tr('battle.noTroopsWithShortcut'));
      this.battleConfirm.setEnabled(false);
    } else {
      this.battleStatus.setText(this.state.saveState === 'error' ? tr('save.failed') : '');
      this.battleConfirm.setEnabled(true);
    }
  }

  private confirmBattle(): void {
    if (this.battleLaunching) return;
    if (this.state.armyCount <= 0) {
      this.closeBattlePanel();
      this.openTraining();
      return;
    }
    this.battleLaunching = true;
    const mode = this.state.nextCampaignWave === null ? 'replay' : 'campaign';
    const committed = this.state.commitBattle(mode, this.selectedReplayWave, Date.now());
    if (!committed.ok || !committed.receipt) {
      this.battleLaunching = false;
      this.battleStatus.setText(committed.reason === 'saveFailed' ? tr('battle.saveFailed') : tr('battle.cannotStart'));
      this.battleConfirm.setEnabled(true);
      return;
    }
    this.scene.start(SceneKeys.Battle, { receipt: committed.receipt });
  }

  // ---- Navigation ----------------------------------------------------------

  /** Close every overlay panel except the one being opened. */
  private closeOtherPanels(except: 'training' | 'research' | 'heroes' | 'quests'): void {
    this.closeBattlePanel();
    if (except !== 'training' && this.trainingPanel.visible) this.trainingPanel.setVisible(false);
    if (except !== 'research' && this.researchPanel.visible) this.researchPanel.setVisible(false);
    if (except !== 'heroes' && this.heroPanel.visible) this.heroPanel.setVisible(false);
    if (except !== 'quests' && this.questPanel.visible) this.questPanel.setVisible(false);
  }

  private openTraining(): void {
    this.dismissOnboardingIfOpen();
    this.closeUpgradePanel();
    this.closeOtherPanels('training');
    this.trainingPanel.toggle();
  }

  private openResearch(): void {
    this.dismissOnboardingIfOpen();
    this.closeUpgradePanel();
    this.closeOtherPanels('research');
    this.researchPanel.toggle();
  }

  private openHeroes(): void {
    this.dismissOnboardingIfOpen();
    this.closeUpgradePanel();
    this.closeOtherPanels('heroes');
    this.heroPanel.toggle();
  }

  private openQuests(): void {
    this.dismissOnboardingIfOpen();
    this.closeUpgradePanel();
    this.closeOtherPanels('quests');
    this.questPanel.toggle();
  }

  private goBattle(): void {
    this.dismissOnboardingIfOpen();
    this.openBattlePanel();
  }

  private openSettings(): void {
    this.dismissOnboardingIfOpen();
    this.saveNow();
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Settings, { returnTo: SceneKeys.Town }));
  }

  /**
   * Tear down the first-run onboarding card immediately if it is on screen.
   * Called at the top of every panel/battle/settings action so a panel never
   * opens underneath the onboarding overlay. A no-op once the card is gone.
   */
  private dismissOnboardingIfOpen(): void {
    const dismiss = this.onboardingDismiss;
    if (dismiss) dismiss();
  }

  private saveNow(): void {
    this.state.save(Date.now());
  }

  // ---- First-run interactive tutorial --------------------------------------

  /**
   * Begin the guided tutorial for a brand-new player: create the pure flow and
   * its overlay renderer, and draw the first (welcome) step. The overlay's Skip
   * ends it from any step; Next advances informational steps; gameplay steps
   * advance from {@link tutorialTick} as the shared GameState changes.
   */
  private startTutorial(): void {
    const flow = new TutorialFlow();
    this.tutorialFlow = flow;
    this.tutorialOverlay = new TutorialOverlay(
      this,
      flow,
      (anchor) => this.resolveTutorialAnchor(anchor),
      {
        onNext: () => {
          if (!this.tutorialFlow) return;
          this.tutorialFlow.advance('next');
          this.afterTutorialAdvance();
        },
        onSkip: () => this.endTutorial(),
      },
    );
    this.tutorialOverlay.render();
  }

  /**
   * Watch the shared GameState each frame and advance the active GAMEPLAY step
   * when the player performs the expected action (its predicate over a plain
   * progress snapshot is satisfied). Informational steps advance via Next, so
   * they are ignored here. Re-renders the overlay on any advance; ends the
   * tutorial when the flow completes.
   */
  private tutorialTick(): void {
    const flow = this.tutorialFlow;
    if (!flow || flow.isComplete) return;
    // A gameplay overlay panel (Training/Research/Hero/Quest) renders at depth
    // 50 — BELOW the tutorial overlay (depth 80). While one is open, suspend the
    // tutorial's dim frame so the panel's own build/train buttons receive
    // clicks; without this the `build_and_train` step is unwinnable because the
    // dim would occlude the TrainingPanel it asks the player to operate.
    this.tutorialOverlay?.setDimSuspended(this.anyGameplayPanelOpen());
    if (flow.advance(this.tutorialProgress())) {
      this.afterTutorialAdvance();
    }
  }

  /** Whether any depth-50 gameplay overlay panel is currently open. */
  private anyGameplayPanelOpen(): boolean {
    return (
      this.trainingPanel.visible ||
      this.researchPanel.visible ||
      this.heroPanel.visible ||
      this.questPanel.visible
    );
  }

  /** Re-render after an advance, or tear down + persist once complete. */
  private afterTutorialAdvance(): void {
    const flow = this.tutorialFlow;
    if (!flow) return;
    if (flow.isComplete) {
      this.endTutorial();
    } else {
      this.tutorialOverlay?.render();
    }
  }

  /** Tear down the tutorial overlay and mark it done (persists the flag). */
  private endTutorial(): void {
    this.tutorialFlow = null;
    if (this.tutorialOverlay) {
      this.tutorialOverlay.destroy();
      this.tutorialOverlay = null;
    }
    this.state.markTutorialDone();
  }

  /** A plain progress snapshot the tutorial's gameplay predicates read. */
  private tutorialProgress(): TutorialProgress {
    return {
      townCenterPanelOpen: this.upgradePanel.visible && this.selected === 'town_center',
      townCenterUpgrading: this.state.buildings.isUpgrading('town_center'),
      townCenterLevel: this.state.buildings.townCenterLevel,
      lumberMillBuilt: this.state.buildings.level('lumber_mill') >= 1,
      barracksBuilt: this.state.buildings.hasBarracks,
      troopsTrained: this.state.troopsTrained,
      questPanelOpen: this.questPanel.visible,
      battlesWon: this.state.battlesWon,
    };
  }

  /**
   * Map a tutorial step's anchor descriptor to a concrete on-screen rect so the
   * overlay can frame/highlight it. Bottom-bar slots mirror the layout in
   * {@link buildBottomBar} (six evenly-spaced slots across the 960px canvas).
   */
  private resolveTutorialAnchor(anchor: TutorialAnchor): AnchorRect {
    const slots = 6;
    const slotW = CANVAS.WIDTH / slots;
    const barY = CANVAS.HEIGHT - 28;
    // Bottom-bar slot centres by action index (see buildBottomBar order).
    const slotRect = (index: number): AnchorRect => ({
      x: slotW * index + slotW / 2,
      y: barY,
      width: slotW - 14,
      height: 40,
    });
    switch (anchor) {
      case 'town_center': {
        const layout = BUILDING_LAYOUT.town_center;
        return { x: layout.x, y: layout.y, width: 96, height: 96 };
      }
      case 'lumber_mill': {
        const layout = BUILDING_LAYOUT.lumber_mill;
        return { x: layout.x, y: layout.y, width: 96, height: 96 };
      }
      case 'upgrade_button':
        // The Upgrade button inside the open upgrade panel (right side).
        return { x: this.upgradeButton.container.x, y: this.upgradeButton.container.y, width: 240, height: 44 };
      case 'training':
        return slotRect(0);
      case 'battle':
        return slotRect(4);
      case 'quests':
        return slotRect(3);
      case 'center':
      default:
        return { x: CANVAS.WIDTH / 2, y: CANVAS.HEIGHT / 2, width: 0, height: 0 };
    }
  }

  private maybeShowOfflineGains(): void {
    const receipt = this.state.consumeOfflineSummary();
    if (!receipt) return;
    const g = receipt.gains;
    const summary = tr('save.offlineSummary', {
      seconds: receipt.simulatedSeconds,
      food: Math.floor(g.food),
      wood: Math.floor(g.wood),
      stone: Math.floor(g.stone),
      gold: Math.floor(g.gold),
      warmth: Math.round(receipt.warmthAfter - receipt.warmthBefore),
      buildings: receipt.buildingsDone.length,
      research: receipt.researchDone.length,
      trained: receipt.trainedCount,
    });
    announceStatus(summary);
    const banner = this.add
      .text(
        CANVAS.WIDTH / 2,
        100,
        summary,
        textStyle(13, { color: PALETTE.ACCENT_CSS, backgroundColor: PALETTE.PANEL_CSS, padding: { x: 8, y: 6 }, wordWrap: { width: 680 }, align: 'center' }),
      )
      .setOrigin(0.5)
      .setDepth(60);
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) this.tweens.add({ targets: banner, alpha: 0, delay: 6500, duration: 800, onComplete: () => banner.destroy() });
  }
}
