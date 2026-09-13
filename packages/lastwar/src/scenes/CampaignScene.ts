import Phaser from 'phaser';
import { SceneKeys, PALETTE, CANVAS, RESOURCE_ORDER } from '../config/GameConfig';
import type { ResourceKind } from '../types';
import { TextureKeys, AudioKeys } from '../config/AssetKeys';
import { AudioManager } from '../systems/AudioManager';
import { GameStore } from '../systems/GameStore';
import {
  CAMPAIGN_ORDER,
  CAMPAIGN_STAGES,
  type RewardBundle,
  type StageDef,
} from '../config/Progression';
import {
  isStageUnlocked,
  stageDef,
  stageEnemyTeam,
  zombieWaveTeam,
} from '../systems/Campaign';
import type { StageBlockReason } from '../systems/Campaign';
import { tr } from '../i18n/i18n';
import type { TrKey } from '../i18n/strings';
import { Menu } from '../ui/Menu';
import { textStyle } from '../ui/UiText';
import { buildTopNav } from '../ui/TopNav';
import { teamPower } from '../systems/League';
import type { BattleSceneData } from './BattleScene';

/** Data passed when launching the Campaign scene, and back from Battle. */
export interface CampaignSceneData {
  /** Scene key to return to (the Home hub). */
  returnTo?: string;
  tab?: 'campaign' | 'horde';
  /**
   * Result echoed back by BattleScene when a replay finishes, so the scene can
   * surface the result overlay for the reward the store already applied.
   */
  battleResult?: {
    win: boolean;
    kind?: 'stage' | 'zombie';
    reward?: RewardBundle;
    firstClear?: boolean;
    waveIndex?: number;
    rounds?: number;
    survivors?: number;
    timedOut?: boolean;
  };
}

/** A tiny non-crypto hash of a stage id for deterministic-ish seeding. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * CampaignScene - PvE stage select + HORDE DEFENSE (FEAT-002).
 *
 * The scene renders {@link CAMPAIGN_STAGES} (iterating {@link CAMPAIGN_ORDER})
 * as a vertical list, reading the cleared/locked/resistance-gated state from the
 * store ({@link GameStore.clearedStages}/{@link GameStore.resistance}) via the
 * pure {@link isStageUnlocked} check - it never re-derives progression math.
 *
 * Tapping an unlocked stage guards a filled squad, then calls
 * {@link GameStore.attemptStage} (which resolves the battle AND applies+persists
 * any first-clear reward). The scene launches the presentation-only
 * {@link BattleScene} with the returned `outcome.battle` timeline; when the
 * animation completes BattleScene returns here and the scene shows a
 * victory/defeat + reward overlay. Every completed battle also advances the
 * daily 'combat' arms-race task via {@link GameStore.recordMissionProgress}.
 *
 * A HORDE DEFENSE section attempts {@link GameStore.attemptZombieWave} for the
 * next wave and loops so the player can keep pushing waves.
 */
export class CampaignScene extends Phaser.Scene {
  private returnTo: string = SceneKeys.Home;
  private tab: 'campaign' | 'horde' = 'campaign';
  private toast: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: SceneKeys.Campaign });
  }

  create(data: CampaignSceneData): void {
    this.returnTo = data?.returnTo ?? SceneKeys.Home;
    this.tab = data?.tab ?? (data?.battleResult?.kind === 'zombie' ? 'horde' : 'campaign');
    const cx = CANVAS.WIDTH / 2;

    this.cameras.main.resetFX();
    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    Menu.fadeIn(this);
    AudioManager.get(this).playMusic();

    this.add.image(cx, 0, TextureKeys.BgBattle).setOrigin(0.5, 0).setAlpha(0.3);

    Menu.title(this, cx, CANVAS.HEIGHT * 0.06, tr('campaign.title'), 30).setColor(PALETTE.SQUAD_CSS);
    Menu.label(this, cx, CANVAS.HEIGHT * 0.1, tr('season.resistance', { level: GameStore.get().resistance() }), 12, 0.75, true);

    Menu.button(this, cx - 105, CANVAS.HEIGHT * 0.135, tr('campaign.title'), () => this.scene.restart({ returnTo: this.returnTo, tab: 'campaign' }), { width: 180, fontSize: 13, allowSmall: true });
    Menu.button(this, cx + 105, CANVAS.HEIGHT * 0.135, tr('zombie.title'), () => this.scene.restart({ returnTo: this.returnTo, tab: 'horde' }), { width: 180, fontSize: 13, accent: PALETTE.BOSS, allowSmall: true });
    if (this.tab === 'campaign') this.buildStageList();
    else this.buildHordeSection();

    buildTopNav(this, SceneKeys.Campaign);
    Menu.button(this, cx, CANVAS.HEIGHT * 0.875, tr('heroes.formation'), () => this.scene.start(SceneKeys.Formation, { returnTo: SceneKeys.Campaign }), { width: 180, fontSize: 13, allowSmall: true });
    this.input.keyboard?.on('keydown-ESC', () => this.close());

    // If we returned from a battle, surface the result overlay.
    if (data?.battleResult) this.showResultOverlay(data.battleResult);
  }

  /** Render the campaign stages as a vertical list of tappable rows. */
  private buildStageList(): void {
    const store = GameStore.get();
    const cleared = store.clearedStages();
    const resistance = store.resistance();
    const startY = CANVAS.HEIGHT * 0.21;
    const rowH = 62;
    const rowW = CANVAS.WIDTH - 48;
    const cx = CANVAS.WIDTH / 2;

    CAMPAIGN_ORDER.forEach((stageId, i) => {
      const stage = CAMPAIGN_STAGES[i];
      const y = startY + i * rowH;
      const isCleared = cleared.includes(stageId);
      const unlocked = isStageUnlocked(stageId, cleared, resistance);

      const panel = Menu.panel(this, cx, y, rowW, rowH - 10, unlocked ? 0.9 : 0.55);
      panel.setStrokeStyle(2, isCleared ? PALETTE.SUCCESS : unlocked ? PALETTE.ACCENT : PALETTE.LANE_LINE);

      this.add
        .text(cx - rowW / 2 + 16, y - 10, tr(stage.nameKey as TrKey), textStyle(14, { fontStyle: 'bold', allowSmall: true }))
        .setOrigin(0, 0.5);
      const enemy = stageEnemyTeam(stage);
      const types = [...new Set(enemy.members.map((member) => tr(`herotype.${member.type}` as TrKey)))].join('/');
      this.add.text(cx - rowW / 2 + 16, y + 12, `${types} · ${tr('hero.power', { power: teamPower(enemy) })}`, textStyle(9, { color: PALETTE.MUTED_CSS, allowSmall: true })).setOrigin(0, 0.5);

      const status = this.stageStatusText(stage, isCleared, unlocked, resistance);
      this.add
        .text(cx + rowW / 2 - 16, y, status.text, textStyle(11, { align: 'right', color: status.color, allowSmall: true }))
        .setOrigin(1, 0.5);

      if (unlocked) {
        const zone = this.add
          .zone(cx, y, rowW, rowH - 10)
          .setInteractive({ useHandCursor: true });
        zone.on(Phaser.Input.Events.POINTER_DOWN, () => this.attemptStage(stageId));
      }
    });
  }

  /** The right-aligned status label + colour for a stage row. */
  private stageStatusText(
    stage: StageDef,
    isCleared: boolean,
    unlocked: boolean,
    resistance: number,
  ): { text: string; color: string } {
    if (isCleared) return { text: tr('campaign.clear'), color: PALETTE.SUCCESS_CSS };
    if (unlocked) return { text: tr('title.play'), color: PALETTE.ACCENT_CSS };
    if (resistance < stage.requiredResistance) {
      return { text: tr('campaign.lockedResistance', { level: stage.requiredResistance }), color: PALETTE.MUTED_CSS };
    }
    return { text: tr('campaign.locked'), color: PALETTE.MUTED_CSS };
  }

  /** The HORDE DEFENSE (endless zombie waves) section. */
  private buildHordeSection(): void {
    const store = GameStore.get();
    const cx = CANVAS.WIDTH / 2;
    const y = CANVAS.HEIGHT * 0.34;
    // Height 140, not 96: the action row at y + 52 is at least 44px tall
    // (Menu.button's touch-target floor), so a 96-tall panel left 20px of both
    // buttons hanging below the frame.
    Menu.panel(this, cx, y + 6, CANVAS.WIDTH - 48, 140, 0.9).setStrokeStyle(2, PALETTE.BOSS);

    Menu.title(this, cx, y - 24, tr('zombie.title'), 20).setColor(PALETTE.BOSS_CSS);
    const nextWave = store.highestZombieWave() + 1;
    // Waves are 0-indexed internally; show them 1-indexed to the player.
    this.add
      .text(cx, y + 2, tr('zombie.best', { wave: store.highestZombieWave() + 1 }), textStyle(12, { align: 'center', allowSmall: true }))
      .setOrigin(0.5);

    Menu.button(
      this,
      cx + 105,
      y + 52,
      `${tr('zombie.next')} (${tr('zombie.wave', { wave: nextWave + 1 })})`,
      () => this.attemptZombieWave(nextWave),
      { width: 200, fontSize: 13, allowSmall: true },
    );
    if (store.highestZombieWave() >= 0) {
      Menu.button(this, cx - 105, y + 52, tr('zombie.replay', { wave: store.highestZombieWave() + 1 }), () => this.attemptZombieWave(store.highestZombieWave()), { width: 200, fontSize: 13, accent: PALETTE.SQUAD, allowSmall: true });
    }
  }

  /** Guard a filled squad, resolve the stage via the store, launch Battle. */
  private attemptStage(stageId: string): void {
    const store = GameStore.get();
    if (store.battleTeam().members.length === 0) {
      this.showToast(tr('formation.needFive'));
      return;
    }
    const seed = (Date.now() ^ hashString(stageId)) >>> 0;
    const result = store.attemptStage(stageId, seed);
    if (!result.ok) {
      this.showToast(this.reasonText(result.reason));
      return;
    }
    // A completed battle advances the daily 'combat' arms-race task.
    store.recordMissionProgress('combat', 1, Date.now());

    const stage = stageDef(stageId);
    const battleData: BattleSceneData = {
      timeline: result.outcome.battle.timeline,
      win: result.outcome.win,
      playerTeam: store.battleTeam(),
      enemyTeam: stage ? stageEnemyTeam(stage) : { members: [], sameTypeBuff: false },
      title: stage ? tr(stage.nameKey as TrKey) : tr('campaign.title'),
      returnTo: SceneKeys.Campaign,
      returnData: {
        kind: 'stage',
        reward: result.outcome.reward,
        firstClear: Object.keys(result.outcome.reward).length > 0,
        rounds: result.outcome.battle.rounds,
        survivors: result.outcome.battle.attackerSurvivors.length,
        timedOut: result.outcome.battle.timedOut,
      },
    };
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Battle, battleData));
  }

  /** Guard a filled squad, resolve the next wave via the store, launch Battle. */
  private attemptZombieWave(waveIndex: number): void {
    const store = GameStore.get();
    if (store.battleTeam().members.length === 0) {
      this.showToast(tr('formation.needFive'));
      return;
    }
    const seed = (Date.now() ^ hashString(`wave_${waveIndex}`)) >>> 0;
    const result = store.attemptZombieWave(waveIndex, seed);
    if (!result.ok) {
      this.showToast(this.reasonText(result.reason));
      return;
    }
    store.recordMissionProgress('combat', 1, Date.now());

    const battleData: BattleSceneData = {
      timeline: result.outcome.battle.timeline,
      win: result.outcome.win,
      playerTeam: store.battleTeam(),
      enemyTeam: zombieWaveTeam(waveIndex),
      title: `${tr('zombie.title')} · ${tr('zombie.wave', { wave: waveIndex + 1 })}`,
      returnTo: SceneKeys.Campaign,
      returnData: {
        kind: 'zombie',
        reward: result.outcome.reward,
        firstClear: Object.keys(result.outcome.reward).length > 0,
        rounds: result.outcome.battle.rounds,
        survivors: result.outcome.battle.attackerSurvivors.length,
        timedOut: result.outcome.battle.timedOut,
        waveIndex,
      },
    };
    Menu.fadeTo(this, () => this.scene.start(SceneKeys.Battle, battleData));
  }

  /** Map a store block reason to a user-facing toast. */
  private reasonText(reason: StageBlockReason): string {
    switch (reason) {
      case 'no_squad':
        return tr('formation.needFive');
      case 'locked':
        return tr('campaign.locked');
      default:
        return tr('campaign.locked');
    }
  }

  /**
   * A result overlay shown after returning from a battle: victory/defeat headline
   * plus, on a first-clear win, the reward summary the store already applied.
   */
  private showResultOverlay(res: NonNullable<CampaignSceneData['battleResult']>): void {
    const cx = CANVAS.WIDTH / 2;
    const cy = CANVAS.HEIGHT / 2;
    const isZombie = res.kind === 'zombie';
    const win = res.win;

    const dim = this.add.rectangle(cx, cy, CANVAS.WIDTH, CANVAS.HEIGHT, 0x000000, 0.6).setDepth(100);
    const panel = Menu.panel(this, cx, cy, CANVAS.WIDTH - 80, 260, 0.98);
    panel.setDepth(101);

    const headline = !win && res.timedOut
      ? tr('battle.timeoutDefeat')
      : win
      ? isZombie
        ? tr('zombie.cleared')
        : tr('campaign.victory')
      : isZombie
        ? tr('zombie.overrun')
        : tr('campaign.defeat');
    this.add
      .text(cx, cy - 90, headline, textStyle(24, { fontStyle: 'bold', color: win ? PALETTE.SUCCESS_CSS : PALETTE.DANGER_CSS }))
      .setOrigin(0.5)
      .setDepth(102);

    this.add.text(cx, cy - 60, tr('battle.summary', { rounds: res.rounds ?? 0, survivors: res.survivors ?? 0 }), textStyle(11, { color: PALETTE.MUTED_CSS, allowSmall: true })).setOrigin(0.5).setDepth(102);

    if (win && res.reward && Object.keys(res.reward).length > 0) {
      this.add
        .text(cx, cy - 52, tr('campaign.reward'), textStyle(14, { color: PALETTE.ACCENT_CSS, allowSmall: true }))
        .setOrigin(0.5)
        .setDepth(102);
      const lines = this.rewardLines(res.reward);
      this.add
        .text(cx, cy - 4, lines.join('\n'), textStyle(13, { align: 'center', lineSpacing: 6, allowSmall: true }))
        .setOrigin(0.5)
        .setDepth(102);
      AudioManager.get(this).playSfx(AudioKeys.Reward, 0.7);
    }

    const btn = Menu.button(this, cx, cy + 96, tr('common.confirm'), () => {
      dim.destroy();
      panel.destroy();
      // Rebuild the scene so cleared/best states refresh.
      this.scene.restart({ returnTo: this.returnTo });
    }, { width: 160 });
    btn.container.setDepth(102);
  }

  /** Build human-readable reward lines from a RewardBundle. */
  private rewardLines(reward: RewardBundle): string[] {
    const lines: string[] = [];
    if (reward.resources) {
      for (const kind of RESOURCE_ORDER as readonly ResourceKind[]) {
        const amount = reward.resources[kind];
        if (amount) lines.push(`${tr(`resource.${kind}` as TrKey)} +${amount}`);
      }
    }
    if (reward.shards) lines.push(`${tr('recruit.shards', { shards: reward.shards })}`);
    if (reward.seasonXp) lines.push(tr('season.xp', { xp: reward.seasonXp }));
    if (reward.coins) lines.push(tr('result.coinsEarned', { coins: reward.coins }));
    return lines.length > 0 ? lines : [tr('campaign.reward')];
  }

  /** A short auto-dismissing toast. */
  private showToast(message: string): void {
    if (this.toast) {
      this.toast.destroy(true);
      this.toast = null;
    }
    const cx = CANVAS.WIDTH / 2;
    const y = CANVAS.HEIGHT * 0.88;
    const text = this.add.text(0, 0, message, textStyle(13, { align: 'center' })).setOrigin(0.5);
    const bg = Menu.panel(this, 0, 0, Math.ceil(text.width) + 40, 40, 0.96);
    const toast = this.add.container(cx, y, [bg, text]).setDepth(60);
    this.toast = toast;
    this.tweens.add({
      targets: toast,
      alpha: { from: 1, to: 0 },
      delay: 1200,
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
