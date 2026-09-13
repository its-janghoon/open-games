import Phaser from 'phaser';
import { PALETTE, RUN, SceneKeys, WALL, PHYSICS, CITIZEN, CANVAS, EnemyRole } from '../config/GameConfig';
import { AudioKeys, TextureKeys, type AudioKey } from '../config/AssetKeys';
import { HERO_THREAT } from '../config/EnemyConfig';
import { ARENA, CAMERA, GAS, HERO_COMBAT, INPUT } from '../config/PlayerConfig';
import { Player } from '../entities/Player';
import { RingId, Wall } from '../entities/Wall';
import { Citizen } from '../entities/Citizen';
import { GasSystem } from '../systems/GasSystem';
import { GrappleSystem, type GrappleSurface, type GrappleTarget } from '../systems/GrappleSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { aabbIntersects, isTraversing } from '../systems/SiegeGeometry';
import { WaveSystem } from '../systems/WaveSystem';
import { AudioManager } from '../systems/AudioManager';
import { Hud } from '../ui/Hud';
import { textStyle } from '../ui/UiText';
import { tr } from '../i18n/i18n';
import type { GameOverData } from './GameOverScene';
import type { LoseReason } from './GameOverReason';
import { SeededRng, createRunSeed } from '../systems/DeterministicRng';
import { prefersReducedMotion, saveRunRecord, saveSettings, type Difficulty, type GameSettings } from '../systems/Persistence';
import { AttackTarget, DebrisProjectile, type AttackEvent, type Enemy, type EnemyContext, type StructureTarget } from '../entities/enemies';
import { TouchControls, touchAvailable } from '../systems/TouchControls';

export interface GameSceneData { difficulty?: Difficulty; seed?: number }
type Outcome = LoseReason | 'victory';
interface SimulationInput { up: boolean; down: boolean; left: boolean; right: boolean; reelIn: boolean; reelOut: boolean; fireHeld: boolean; aimX: number; aimY: number }
type SimulationAction =
  | { readonly kind: 'dash' }
  | { readonly kind: 'tetherFire'; readonly aimX: number; readonly aimY: number }
  | { readonly kind: 'tetherRelease' }
  | { readonly kind: 'slash'; readonly aimX: number; readonly aimY: number };

const ATTACK_AUDIO_BY_ROLE: Record<EnemyRole, AudioKey> = {
  [EnemyRole.Surveyor]: AudioKeys.AttackSurveyor,
  [EnemyRole.Skitter]: AudioKeys.AttackSkitter,
  [EnemyRole.Rammer]: AudioKeys.AttackRammer,
  [EnemyRole.Fluxborn]: AudioKeys.AttackFluxborn,
  [EnemyRole.Bastion]: AudioKeys.AttackBastion,
  [EnemyRole.Bombard]: AudioKeys.AttackBombard,
};

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private gas!: GasSystem;
  private grapple!: GrappleSystem;
  private combat!: CombatSystem;
  private waves!: WaveSystem;
  private wall!: Wall;
  private hud!: Hud;
  private audio!: AudioManager;
  private settings!: GameSettings;
  private surfaces: GrappleSurface[] = [];
  private enemies: Enemy[] = [];
  private projectiles: DebrisProjectile[] = [];
  private citizens: Citizen[] = [];
  private rng!: SeededRng;
  private difficulty: Difficulty = 'standard';
  private seed = 0;
  private score = 0;
  private citizensSaved = WALL.START_CITIZENS;
  private gameEnded = false;
  private pendingOutcome: Outcome | null = null;
  private accumulatorMs = 0;
  private simulationMs = 0;
  private activeMs = 0;
  private traversing = false;
  private traversalStart = new Phaser.Math.Vector2();
  private dashStart = new Phaser.Math.Vector2();
  private selectedGamepadIndex: number | null = null;
  private activeGamepad: Gamepad | null = null;
  private gamepadAim = new Phaser.Math.Vector2(0, -1);
  private gamepadTetherHeld = false;
  private gamepadSlashHeld = false;
  private gamepadDashHeld = false;
  private gamepadPauseHeld = false;
  private gamepadInputArmed = true;
  private simulationActions: SimulationAction[] = [];
  /** Touch scheme; null on a device with no touch support. */
  private touch: TouchControls | null = null;
  /** Tether onboarding stage; 'off' once completed or skipped. */
  private tutorialStage: 'off' | 'hold' | 'release' = 'off';
  private tutorialText: Phaser.GameObjects.Text | null = null;
  private tutorialSkipText: Phaser.GameObjects.Text | null = null;
  private lastInputMode: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private focusLossHandler = (): void => this.handleFocusLoss();
  private visibilityHandler = (): void => { if (document.hidden) this.handleFocusLoss(); };

  private keys!: {
    left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key; pause: Phaser.Input.Keyboard.Key;
    reelIn: Phaser.Input.Keyboard.Key; reelOut: Phaser.Input.Keyboard.Key;
    tether: Phaser.Input.Keyboard.Key | null; slash: Phaser.Input.Keyboard.Key | null;
  };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() { super({ key: SceneKeys.Game }); }

  create(data: GameSceneData = {}): void {
    this.cameras.main.setBackgroundColor(PALETTE.BG_SKY_CSS);
    this.physics.world.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    this.audio = AudioManager.get(this);
    this.settings = this.audio.getSettings();
    this.difficulty = data.difficulty ?? this.settings.difficulty;
    this.seed = data.seed ?? createRunSeed();
    this.rng = new SeededRng(this.seed);
    this.audio.setPaused(false);
    this.audio.playMusic(AudioKeys.MusicLoop);
    this.score = 0;
    this.citizensSaved = WALL.START_CITIZENS;
    this.gameEnded = false;
    this.pendingOutcome = null;
    this.accumulatorMs = 0;
    this.simulationMs = 0;
    this.activeMs = 0;
    this.simulationActions = [];
    this.gamepadTetherHeld = false;
    this.gamepadSlashHeld = false;
    this.gamepadDashHeld = false;
    this.gamepadPauseHeld = false;
    this.gamepadInputArmed = true;
    this.enemies = [];
    this.projectiles = [];
    this.citizens = [];
    this.buildArena();
    this.buildWall();
    this.buildPlayer();
    this.buildCitizens();
    this.buildSystems();
    this.buildCamera();
    this.buildInput();
    this.hud = new Hud(this);
    this.hud.showHint();
    this.combat.setEnemies(this.enemies);
    // Gate wave 1 behind the tether onboarding on a first run. The tether is
    // hold-to-use and is the whole game; letting machines spawn while the player
    // is still discovering that a click does nothing is how a first session ends
    // in a bounce. Returning players (flag persisted) start immediately.
    if (this.settings.tetherTutorialDone) {
      this.waves.start(this.simulationMs);
    } else {
      this.startTetherTutorial();
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());
  }

  /**
   * TETHER ONBOARDING.
   *
   * Three beats, no wall of text: prompt HOLD, detect the attach, prompt
   * RELEASE, detect the release, then start the waves. The aim preview added to
   * GrappleSystem is already live during this, so "hold" and "where it would
   * land" teach each other.
   *
   * Skippable with P at any time. Completing OR skipping persists the flag, so
   * this costs a returning player nothing. Driven from
   * {@link updateTetherTutorial} rather than timers so it follows the player's
   * actual actions, not a clock.
   */
  private startTetherTutorial(): void {
    this.tutorialStage = 'hold';
    this.tutorialText = this.add
      .text(CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.22, tr('tutorial.tetherHold'), textStyle(20, { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9500);
    this.tutorialSkipText = this.add
      .text(CANVAS.WIDTH / 2, CANVAS.HEIGHT * 0.22 + 26, tr('tutorial.skip'), textStyle(12))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(9500)
      .setAlpha(0.55);
  }

  /** Advance the onboarding from the grapple's real state. */
  private updateTetherTutorial(): void {
    if (this.tutorialStage === 'off') return;
    if (this.tutorialStage === 'hold' && this.grapple.isAttached) {
      this.tutorialStage = 'release';
      this.tutorialText?.setText(tr('tutorial.tetherRelease'));
      return;
    }
    if (this.tutorialStage === 'release' && !this.grapple.isAttached) {
      this.finishTetherTutorial(tr('tutorial.tetherDone'));
    }
  }

  /** Persist completion, clear the overlay, and release the waves. */
  private finishTetherTutorial(closingLine: string | null): void {
    if (this.tutorialStage === 'off') return;
    this.tutorialStage = 'off';
    this.tutorialSkipText?.destroy();
    this.tutorialSkipText = null;
    if (closingLine && this.tutorialText) {
      const reduced = prefersReducedMotion(this.settings);
      this.tutorialText.setText(closingLine);
      this.tweens.add({
        targets: this.tutorialText,
        alpha: 0,
        delay: reduced ? 0 : 900,
        duration: reduced ? 80 : 500,
        onComplete: () => { this.tutorialText?.destroy(); this.tutorialText = null; },
      });
    } else {
      this.tutorialText?.destroy();
      this.tutorialText = null;
    }
    const settings = { ...this.settings, tetherTutorialDone: true };
    saveSettings(settings);
    this.waves.start(this.simulationMs);
  }

  private buildArena(): void {
    this.add.tileSprite(0, 0, ARENA.WIDTH, ARENA.HEIGHT, TextureKeys.BgGround).setOrigin(0).setDepth(-30).setTileScale(0.5);
    const plaza = this.add.graphics().setDepth(-29);
    plaza.fillStyle(PALETTE.BG_NEAR, 0.35).fillCircle(ARENA.CENTER_X, ARENA.CENTER_Y, WALL.INNER_RADIUS);
    plaza.lineStyle(2, PALETTE.WALL_DARK, 0.5).strokeCircle(ARENA.CENTER_X, ARENA.CENTER_Y, WALL.OUTER_RADIUS);
    plaza.strokeCircle(ARENA.CENTER_X, ARENA.CENTER_Y, WALL.INNER_RADIUS);
  }

  private buildWall(): void { this.wall = new Wall(this); this.refreshGrappleSurfaces(); }
  private refreshGrappleSurfaces(): void { this.surfaces = this.wall.grappleSurfaces; this.grapple?.setSurfaces(this.surfaces); }

  private buildPlayer(): void {
    const radius = (WALL.OUTER_RADIUS + WALL.INNER_RADIUS) / 2;
    this.player = new Player(this, ARENA.CENTER_X, ARENA.CENTER_Y - radius).setDepth(6);
    this.traversalStart.set(this.player.x, this.player.y);
  }

  private buildCitizens(): void {
    const home = { centerX: ARENA.CENTER_X, centerY: ARENA.CENTER_Y, radius: CITIZEN.HOME_RADIUS };
    for (let index = 0; index < WALL.START_CITIZENS; index += 1) {
      const angle = this.rng.next() * Math.PI * 2;
      const radius = Math.sqrt(this.rng.next()) * CITIZEN.HOME_RADIUS;
      this.citizens.push(new Citizen(
        this,
        ARENA.CENTER_X + Math.cos(angle) * radius,
        ARENA.CENTER_Y + Math.sin(angle) * radius,
        home,
        this.rng,
      ));
    }
  }

  private buildSystems(): void {
    this.gas = new GasSystem(GAS.START, GAS.MAX);
    this.grapple = new GrappleSystem(this, this.player, this.gas);
    this.grapple.setSurfaces(this.surfaces);
    this.combat = new CombatSystem(this, this.player, {
      onDamage: () => undefined,
      onKill: (_enemy, value) => { this.score += value; },
    });
    this.waves = new WaveSystem(this, this.difficulty, this.rng, {
      spawnDebris: (projectile) => {
        this.projectiles.push(projectile);
        this.audio.playSfx(AudioKeys.AttackBombard, 0.45);
      },
      canSpawn: (x, y) => this.enemies.every((enemy) => Math.hypot(enemy.x - x, enemy.y - y) >= 64),
      onSpawn: (enemy) => { enemy.setDepth(5); this.enemies.push(enemy); },
      onWaveStart: (wave, size) => { this.hud?.announceWave(wave, this.waves.totalWaves, size); },
      onAllWavesCleared: () => this.requestOutcome('victory'),
    });
  }

  private buildCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    camera.startFollow(this.player, true, CAMERA.LERP_X, CAMERA.LERP_Y).setDeadzone(CAMERA.DEADZONE_W, CAMERA.DEADZONE_H);
  }

  private bindKey(action: keyof GameSettings['bindings']): Phaser.Input.Keyboard.Key | null {
    const binding = this.settings.bindings[action];
    return binding.startsWith('MOUSE_') ? null : this.input.keyboard?.addKey(binding) ?? null;
  }

  private buildInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');
    this.cursors = keyboard.createCursorKeys();
    this.bindActionKeys();
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Wirework action arena');
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      canvas.focus();
      this.audio.unlock();
      if (pointer.wasTouch) return;
      this.lastInputMode = 'keyboard';
      const aim = this.pointerWorld(pointer);
      const token = pointer.leftButtonDown() ? 'MOUSE_LEFT' : pointer.rightButtonDown() ? 'MOUSE_RIGHT' : null;
      if (token && this.settings.bindings.tether === token) {
        this.queueAction({ kind: 'tetherFire', aimX: aim.x, aimY: aim.y });
      } else if (token && this.settings.bindings.slash === token) {
        this.queueAction({ kind: 'slash', aimX: aim.x, aimY: aim.y });
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch) return;
      const released = pointer.button === 0 ? 'MOUSE_LEFT' : pointer.button === 2 ? 'MOUSE_RIGHT' : null;
      if (released && this.settings.bindings.tether === released) this.queueAction({ kind: 'tetherRelease' });
    });
    this.input.mouse?.disableContextMenu();
    keyboard.on('keydown-ESC', () => this.pauseGame(true));
    keyboard.on('keydown', (event: KeyboardEvent) => {
      this.audio.unlock();
      this.lastInputMode = 'keyboard';
      if (document.activeElement === canvas && !event.ctrlKey && !event.metaKey && !event.altKey && INPUT.BROWSER_BLOCKED_KEYS.includes(event.key)) {
        event.preventDefault();
      }
    });
    window.addEventListener('blur', this.focusLossHandler);
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // TOUCH: a real thumb scheme rather than the previous outright bail-out.
    // Left half is a floating movement stick, right half aims and holds the
    // tether, and DASH / CUT are on-screen buttons. The callbacks feed the SAME
    // action queue the keyboard and gamepad use, so the simulation is untouched.
    if (touchAvailable(this)) {
      this.touch = new TouchControls(this, {
        toWorld: (x, y) => this.cameras.main.getWorldPoint(x, y),
        onTetherStart: (aimX, aimY) => {
          this.audio.unlock();
          this.lastInputMode = 'touch';
          this.queueAction({ kind: 'tetherFire', aimX, aimY });
        },
        onTetherRelease: () => this.queueAction({ kind: 'tetherRelease' }),
        onDash: () => {
          this.lastInputMode = 'touch';
          this.queueAction({ kind: 'dash' });
        },
        onCut: (aimX, aimY) => {
          this.lastInputMode = 'touch';
          this.queueAction({ kind: 'slash', aimX, aimY });
        },
      });
    }
  }

  private bindActionKeys(): void {
    if (this.keys) {
      this.keys.dash.removeAllListeners();
      this.keys.pause.removeAllListeners();
      this.keys.tether?.removeAllListeners();
      this.keys.slash?.removeAllListeners();
    }
    const required = (action: keyof GameSettings['bindings']): Phaser.Input.Keyboard.Key => {
      const key = this.bindKey(action);
      if (!key) throw new Error(`Binding ${action} must be a keyboard key`);
      return key;
    };
    this.keys = {
      left: required('moveLeft'), right: required('moveRight'), up: required('moveUp'), down: required('moveDown'),
      dash: required('dash'), pause: required('pause'), reelIn: required('reelIn'), reelOut: required('reelOut'),
      tether: this.bindKey('tether'), slash: this.bindKey('slash'),
    };
    const ownKeyboard = (): void => { this.lastInputMode = 'keyboard'; };
    this.keys.dash.on('down', () => { ownKeyboard(); this.queueAction({ kind: 'dash' }); });
    this.keys.pause.on('down', () => { ownKeyboard(); this.pauseGame(); });
    this.keys.tether?.on('down', () => {
      ownKeyboard();
      const aim = this.currentAim();
      this.queueAction({ kind: 'tetherFire', aimX: aim.x, aimY: aim.y });
    });
    this.keys.tether?.on('up', () => this.queueAction({ kind: 'tetherRelease' }));
    this.keys.slash?.on('down', () => {
      ownKeyboard();
      const aim = this.currentAim();
      this.queueAction({ kind: 'slash', aimX: aim.x, aimY: aim.y });
    });
  }

  private queueAction(action: SimulationAction): void {
    if (!this.gameEnded && !this.scene.isPaused()) this.simulationActions.push(action);
  }

  private clearHeldInput(): void {
    this.input.keyboard?.resetKeys();
    this.simulationActions = [];
    this.grapple?.cancel();
    this.gamepadTetherHeld = false;
    this.gamepadSlashHeld = false;
    this.gamepadDashHeld = false;
    this.gamepadPauseHeld = false;
    this.gamepadInputArmed = false;
  }

  private handleFocusLoss(): void {
    if (this.gameEnded) return;
    this.clearHeldInput();
    // A touch that ends because the tab lost focus never fires POINTER_UP, so
    // without this the stick and tether would stay held after returning.
    this.touch?.reset();
    if (!this.scene.isPaused()) this.pauseGame();
  }

  private currentAim(): Phaser.Math.Vector2 {
    if (this.lastInputMode === 'gamepad') return new Phaser.Math.Vector2(
      this.player.x + this.gamepadAim.x * 100,
      this.player.y + this.gamepadAim.y * 100,
    );
    return this.pointerWorld(this.input.activePointer);
  }

  private pointerWorld(pointer: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(pointer.x, pointer.y);
  }

  private pauseGame(confirmAbandon = false): void {
    if (this.gameEnded || this.scene.isPaused()) return;
    // While the onboarding is up, the pause key SKIPS it rather than pausing:
    // the prompt is the only thing on screen, so pausing it would be a dead end,
    // and this is the advertised escape hatch ("P to skip").
    if (this.tutorialStage !== 'off') {
      this.finishTetherTutorial(null);
      return;
    }
    this.simulationActions = [];
    this.audio.setPaused(true);
    this.scene.pause();
    this.scene.launch(SceneKeys.Pause, { confirmAbandon });
  }

  public resumeFromPause(): void {
    const next = this.audio.getSettings();
    const bindingsChanged = JSON.stringify(next.bindings) !== JSON.stringify(this.settings.bindings);
    this.settings = next;
    if (bindingsChanged) this.bindActionKeys();
    this.hud.applySettings(next);
    this.audio.setPaused(false);
  }
  public abandonRun(): void { this.pendingOutcome = 'abandoned'; this.resolveOutcome(); }

  private tryDash(): void {
    if (!this.player.isDashReady(this.simulationMs) || !this.gas.spend(GAS.COST_DASH, this.simulationMs)) return;
    const direction = this.player.dashFacing;
    this.dashStart.set(this.player.x, this.player.y);
    this.player.startDash(direction.x, direction.y, this.simulationMs);
    this.audio.playSfx(AudioKeys.SwingWhoosh, 0.7);
  }

  update(_time: number, delta: number): void {
    this.applyCentreBias();
    if (this.gameEnded) return;
    this.pollGamepad();
    this.accumulatorMs += Math.min(delta, 250);
    const input = this.readSimulationInput();
    while (this.accumulatorMs >= PHYSICS.FIXED_STEP_MS) {
      this.simulate(input, PHYSICS.FIXED_STEP_MS);
      this.accumulatorMs -= PHYSICS.FIXED_STEP_MS;
    }
    // Read the onboarding off the grapple's REAL attach state after stepping, so
    // it advances on what actually happened rather than on a timer.
    this.updateTetherTutorial();
    this.updateHud();
  }

  private readSimulationInput(): SimulationInput {
    const aim = this.currentAim();
    const pad = this.activeGamepad;
    const deadzone = this.settings.gamepadDeadzone;
    const padX = pad && Math.abs(pad.axes[0] ?? 0) > deadzone ? pad.axes[0] : 0;
    const padY = pad && Math.abs(pad.axes[1] ?? 0) > deadzone ? pad.axes[1] : 0;
    // Touch is a THIRD input source OR-ed in beside keyboard and gamepad, so a
    // hybrid device (tablet with a keyboard) can use either without a mode flag.
    const t = this.touch?.moveState;
    const touchAim = this.touch?.aim ?? null;
    return {
      left: this.keys.left.isDown || this.cursors.left.isDown || padX < 0 || t?.left === true,
      right: this.keys.right.isDown || this.cursors.right.isDown || padX > 0 || t?.right === true,
      up: this.keys.up.isDown || this.cursors.up.isDown || padY < 0 || t?.up === true,
      down: this.keys.down.isDown || this.cursors.down.isDown || padY > 0 || t?.down === true,
      reelIn: this.keys.reelIn.isDown || Boolean(pad?.buttons[4]?.pressed),
      reelOut: this.keys.reelOut.isDown || Boolean(pad?.buttons[5]?.pressed),
      fireHeld: (
        (this.settings.bindings.tether === 'MOUSE_LEFT' && this.input.activePointer.leftButtonDown()) ||
        (this.settings.bindings.tether === 'MOUSE_RIGHT' && this.input.activePointer.rightButtonDown())
      ) || this.keys.tether?.isDown === true || this.gamepadTetherHeld
        || this.touch?.holdingTether === true,
      // An active touch aim wins: the thumb IS the cursor on a phone, and the
      // mouse pointer is stale there.
      aimX: touchAim?.x ?? aim.x,
      aimY: touchAim?.y ?? aim.y,
    };
  }

  private pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : null;
    let pad = this.selectedGamepadIndex === null ? null : pads?.[this.selectedGamepadIndex] ?? null;
    if (!pad?.connected || pad.mapping !== 'standard') {
      pad = Array.from(pads ?? []).find((candidate): candidate is Gamepad => Boolean(candidate?.connected && candidate.mapping === 'standard')) ?? null;
    }
    if (!pad) {
      if (this.activeGamepad) {
        this.grapple.cancel();
        this.gamepadTetherHeld = false;
        this.gamepadSlashHeld = false;
        this.gamepadDashHeld = false;
        this.gamepadPauseHeld = false;
        this.gamepadInputArmed = true;
        this.gamepadAim.set(0, -1);
        this.lastInputMode = 'keyboard';
      }
      this.activeGamepad = null;
      this.selectedGamepadIndex = null;
      return;
    }
    this.activeGamepad = pad;
    this.selectedGamepadIndex = pad.index;
    const deadzone = this.settings.gamepadDeadzone;
    const aimX = pad.axes[2] ?? 0;
    const aimY = pad.axes[3] ?? 0;
    const meaningful = pad.axes.some((axis) => Math.abs(axis) > deadzone) || pad.buttons.some((button) => button.pressed);
    if (meaningful) this.lastInputMode = 'gamepad';
    if (Math.hypot(aimX, aimY) > deadzone) {
      const length = Math.hypot(aimX, aimY);
      this.gamepadAim.set(aimX / length, aimY / length);
    }
    const tether = Boolean(pad.buttons[7]?.pressed);
    const slash = Boolean(pad.buttons[2]?.pressed);
    const dash = Boolean(pad.buttons[0]?.pressed);
    const pause = Boolean(pad.buttons[9]?.pressed);
    if (!this.gamepadInputArmed) {
      this.gamepadTetherHeld = tether;
      this.gamepadSlashHeld = slash;
      this.gamepadDashHeld = dash;
      this.gamepadPauseHeld = pause;
      if (!tether && !slash && !dash && !pause) this.gamepadInputArmed = true;
      return;
    }
    if (tether && !this.gamepadTetherHeld) {
      const aim = this.currentAim();
      this.queueAction({ kind: 'tetherFire', aimX: aim.x, aimY: aim.y });
    } else if (!tether && this.gamepadTetherHeld) this.queueAction({ kind: 'tetherRelease' });
    this.gamepadTetherHeld = tether;
    if (slash && !this.gamepadSlashHeld) {
      const aim = this.currentAim();
      this.queueAction({ kind: 'slash', aimX: aim.x, aimY: aim.y });
    }
    this.gamepadSlashHeld = slash;
    if (dash && !this.gamepadDashHeld) this.queueAction({ kind: 'dash' });
    this.gamepadDashHeld = dash;
    if (pause && !this.gamepadPauseHeld) this.pauseGame();
    this.gamepadPauseHeld = pause;
  }

  private simulate(input: SimulationInput, stepMs: number): void {
    if (this.combat.consumeHitStop(stepMs)) return;
    const actions = this.simulationActions.splice(0);
    const releases: SimulationAction[] = [];
    const stepStartX = this.player.x;
    const stepStartY = this.player.y;
    const wasDashing = this.player.isDashing(this.simulationMs);
    this.simulationMs += stepMs;
    this.activeMs += stepMs;
    this.grapple.setTargets(this.buildGrappleTargets());
    for (const action of actions) {
      if (action.kind === 'dash') this.tryDash();
      else if (action.kind === 'tetherFire') this.grapple.fire(action.aimX, action.aimY, this.simulationMs);
      else if (action.kind === 'slash') this.combat.slash(action.aimX, action.aimY, this.simulationMs);
      else releases.push(action);
    }
    const firedThisStep = actions.some((action) => action.kind === 'tetherFire');
    this.grapple.update(firedThisStep ? { ...input, fireHeld: true } : input, stepMs, this.simulationMs);
    for (const action of releases) if (action.kind === 'tetherRelease') this.grapple.release();
    const releaseSweep = this.player.consumeReleaseSweep();
    this.player.updatePlayer(input, stepMs, wasDashing ? this.simulationMs - stepMs : this.simulationMs);

    const flingOrWire = this.grapple.isAttached || this.player.isFlinging(this.simulationMs) || releaseSweep;
    const nowTraversing = isTraversing(wasDashing || this.player.isDashing(this.simulationMs), flingOrWire);
    if (nowTraversing && !this.traversing && !wasDashing) this.traversalStart.set(stepStartX, stepStartY);
    this.traversing = nowTraversing;

    this.gas.regen(!this.grapple.isAttached && !this.player.isFlinging(this.simulationMs), stepMs, this.simulationMs);
    this.updateEnemies(this.simulationMs, stepMs);
    this.updateCitizens(this.simulationMs, stepMs);
    this.physics.world.update(this.simulationMs, stepMs);
    this.physics.world.postUpdate();

    if (!nowTraversing && !wasDashing) this.resolveTraversal(stepStartX, stepStartY);
    if (wasDashing && !this.player.isDashing(this.simulationMs)) {
      this.resolveTraversal(this.dashStart.x, this.dashStart.y);
    }
    const afterStepTraversing = this.grapple.isAttached || this.player.isFlinging(this.simulationMs);
    if (!afterStepTraversing && nowTraversing && !wasDashing) {
      this.resolveTraversal(this.traversalStart.x, this.traversalStart.y);
    }
    this.traversing = afterStepTraversing;

    this.updateProjectiles(stepMs, this.simulationMs);
    this.combat.setEnemies(this.enemies);
    this.waves.update(this.simulationMs, this.enemies.length);
    this.resolveOutcome();
  }

  private resolveTraversal(startX: number, startY: number): void {
    const resolved = this.wall.resolveTraversalEndpoint(startX, startY, this.player.x, this.player.y);
    if (!resolved.blocked) return;
    this.player.setPosition(resolved.x, resolved.y);
    if (resolved.blockedX) this.player.body.setVelocityX(0);
    if (resolved.blockedY) this.player.body.setVelocityY(0);
  }

  private buildGrappleTargets(): GrappleTarget[] {
    return this.enemies.filter((enemy) => enemy.active && !enemy.isDying).map((enemy, insertionOrder) => ({
      insertionOrder,
      source: enemy,
      get x() { return enemy.x; },
      get y() { return enemy.y; },
      get bounds() { const box = enemy.getBodyAabb(); return new Phaser.Geom.Rectangle(box.left, box.top, box.right - box.left, box.bottom - box.top); },
      get isValid() { return enemy.active && !enemy.isDying; },
      getNode: () => { const node = enemy.getCoolingNodeWorld(); return { x: node.x, y: node.y }; },
    }));
  }

  private updateEnemies(nowMs: number, dtMs: number): void {
    const context: EnemyContext = {
      centerX: ARENA.CENTER_X, centerY: ARENA.CENTER_Y, heroX: this.player.x, heroY: this.player.y,
      nearestTarget: (x, y) => this.wall.nearestTarget(x, y),
      canEnterCitizens: (x, y) => this.wall.hasOpenPath(x, y) && this.wall.isInsideInner(x, y),
      nearestCitizen: (x, y) => {
        const citizen = this.nearestLivingCitizen(x, y);
        return citizen ? {
          get x() { return citizen.x; },
          get y() { return citizen.y; },
          reference: citizen,
        } : null;
      },
      isStructureValid: (target: StructureTarget) => {
        if (target.kind === 'wall') return this.wall.isSegmentStanding(target.ring as RingId, target.index);
        if (target.kind === 'citizen') {
          const citizen = target.reference as Citizen;
          return citizen.active && !citizen.isConsumed;
        }
        return true;
      },
      reducedMotion: prefersReducedMotion(this.settings),
      nowMs, dtMs,
    };
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      const attack = enemy.update(context);
      if (attack) this.resolveEnemyAttack(attack);
    }
    this.enemies = this.enemies.filter((enemy) => enemy.active);
  }

  private resolveEnemyAttack(attack: AttackEvent): void {
    if (attack.target === AttackTarget.Hero) {
      if (Phaser.Math.Distance.Between(attack.x, attack.y, this.player.x, this.player.y) <= HERO_THREAT.MELEE_HERO_RANGE) {
        this.audio.playSfx(ATTACK_AUDIO_BY_ROLE[attack.role], 0.5);
        this.damageHero(attack.damage, attack.x, attack.y);
      }
      return;
    }
    const structure = attack.structure;
    if (!structure) return;
    this.showMachineImpact(structure.x, structure.y, attack.role);
    if (structure.kind === 'citizen') {
      const citizen = structure.reference as Citizen;
      if (citizen.active && !citizen.isConsumed) this.consumeCitizen(citizen);
      return;
    }
    if (structure.kind === 'wall' && this.wall.damageSegment(structure.ring as RingId, structure.index, attack.damage)) {
      this.onSegmentBreached();
    }
  }

  private showMachineImpact(x: number, y: number, role: EnemyRole): void {
    this.audio.playSfx(ATTACK_AUDIO_BY_ROLE[role], 0.5);
    this.audio.playSfx(AudioKeys.Hit, 0.35);
    const effect = this.add.graphics().setDepth(9);
    effect.lineStyle(3, PALETTE.ACCENT, 1).strokeCircle(x, y, 13);
    effect.lineBetween(x - 9, y - 9, x + 9, y + 9);
    effect.lineBetween(x + 9, y - 9, x - 9, y + 9);
    this.time.delayedCall(prefersReducedMotion(this.settings) ? 50 : 130, () => effect.destroy());
  }

  private damageHero(amount: number, sourceX: number, sourceY: number): void {
    if (!this.player.hurt(amount, sourceX, sourceY, this.simulationMs)) return;
    this.audio.playSfx(AudioKeys.Hit, 0.8);
    this.hud.flashDamage();
    const outline = this.add.graphics().setDepth(9);
    const outlineWidth = HERO_COMBAT.DAMAGE_OUTLINE_WIDTH;
    outline.lineStyle(outlineWidth, PALETTE.TEXT, 1).strokeRect(
      this.player.body.left - outlineWidth,
      this.player.body.top - outlineWidth,
      this.player.body.width + outlineWidth * 2,
      this.player.body.height + outlineWidth * 2,
    );
    const feedbackMs = prefersReducedMotion(this.settings)
      ? Math.min(80, HERO_COMBAT.DAMAGE_FEEDBACK_MS)
      : HERO_COMBAT.DAMAGE_FEEDBACK_MS;
    this.time.delayedCall(feedbackMs, () => outline.destroy());
    if (!prefersReducedMotion(this.settings)) this.cameras.main.shake(200, 0.012);
    if (this.player.isDead) this.requestOutcome('hero_dead');
  }

  private onSegmentBreached(): void {
    this.refreshGrappleSurfaces();
    if (this.wall.isInnerBreached) this.requestOutcome('inner_breached');
  }

  private nearestLivingCitizen(x: number, y: number): Citizen | null {
    let nearest: Citizen | null = null;
    let distance = Infinity;
    for (const citizen of this.citizens) {
      if (citizen.isConsumed) continue;
      const candidate = Phaser.Math.Distance.Between(citizen.x, citizen.y, x, y);
      if (candidate < distance) { distance = candidate; nearest = citizen; }
    }
    return nearest;
  }

  private consumeCitizen(citizen: Citizen): void {
    if (citizen.isConsumed) return;
    citizen.devour();
    this.citizensSaved -= 1;
    this.audio.playSfx(AudioKeys.CitizenAlarm, 0.6);
    if (this.citizensSaved === 0) this.requestOutcome('citizens_lost');
  }

  private updateProjectiles(dtMs: number, nowMs: number): void {
    const alive: DebrisProjectile[] = [];
    for (const projectile of this.projectiles) {
      if (!projectile.active || projectile.isSpent) continue;
      projectile.updateProjectile(dtMs);
      const body = projectile.body;
      if (aabbIntersects(
        { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
        { left: this.player.body.left, top: this.player.body.top, right: this.player.body.right, bottom: this.player.body.bottom },
      )) {
        this.damageHero(projectile.heroDamage, projectile.x, projectile.y);
        projectile.onImpact();
        continue;
      }
      let citizenHit = false;
      for (const citizen of this.citizens) {
        if (!citizen.active || citizen.isConsumed) continue;
        const citizenBody = citizen.body;
        if (!aabbIntersects(
          { left: body.left, top: body.top, right: body.right, bottom: body.bottom },
          { left: citizenBody.left, top: citizenBody.top, right: citizenBody.right, bottom: citizenBody.bottom },
        )) continue;
        this.consumeCitizen(citizen);
        projectile.onImpact();
        citizenHit = true;
        break;
      }
      if (citizenHit) continue;
      if (!this.wall.isInsideInner(projectile.x, projectile.y)) {
        const contact = this.wall.hitNearestIfClose(projectile.x, projectile.y, projectile.wallDamage);
        if (contact.hit) {
          if (contact.breached) this.onSegmentBreached();
          projectile.onImpact();
          continue;
        }
      }
      if (projectile.expired(nowMs) || projectile.x < 0 || projectile.x > ARENA.WIDTH || projectile.y < 0 || projectile.y > ARENA.HEIGHT) {
        projectile.onImpact();
        continue;
      }
      alive.push(projectile);
    }
    this.projectiles = alive;
  }

  private updateCitizens(nowMs: number, dtMs: number): void {
    let threat: { x: number; y: number } | null = null;
    let best = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.isDying || !this.wall.hasOpenPath(enemy.x, enemy.y) || !this.wall.isInsideInner(enemy.x, enemy.y)) continue;
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, ARENA.CENTER_X, ARENA.CENTER_Y);
      if (distance < best) { best = distance; threat = { x: enemy.x, y: enemy.y }; }
    }
    for (const citizen of this.citizens) if (citizen.active && !citizen.isConsumed) citizen.updateCitizen(nowMs, dtMs, threat);
    this.citizens = this.citizens.filter((citizen) => citizen.active);
  }

  private requestOutcome(outcome: Outcome): void {
    if (this.gameEnded) return;
    if (!this.pendingOutcome || RUN.OUTCOME_PRIORITY[outcome] > RUN.OUTCOME_PRIORITY[this.pendingOutcome]) this.pendingOutcome = outcome;
  }

  private resolveOutcome(): void {
    if (!this.pendingOutcome || this.gameEnded) return;
    const outcome = this.pendingOutcome;
    this.pendingOutcome = null;
    this.gameEnded = true;
    this.audio.setPaused(false);
    this.physics.world.timeScale = 1;
    const activeMs = Math.max(0, Math.round(this.activeMs));
    const record = saveRunRecord(this.difficulty, {
      score: this.score,
      wavesCompleted: this.waves.wavesCompleted,
      citizensRemaining: this.citizensSaved,
      activeMs,
      endedAt: new Date().toISOString(),
    });
    const data: GameOverData = {
      victory: outcome === 'victory',
      reason: outcome === 'victory' ? undefined : outcome,
      wavesCompleted: this.waves.wavesCompleted,
      citizensSaved: this.citizensSaved,
      score: this.score,
      activeMs,
      difficulty: this.difficulty,
      seed: this.seed,
      bestScore: record.best.score,
      isNewRecord: record.isNew,
      storageAvailable: record.persisted,
    };
    this.combat.destroy();
    this.time.delayedCall(RUN.GAME_OVER_DELAY_MS, () => this.scene.start(SceneKeys.GameOver, data));
  }

  private updateHud(): void {
    this.hud.update({
      hpRatio: this.player.hp / this.player.maxHp, gasRatio: this.gas.ratio, gasEmpty: this.gas.isEmpty,
      outerRatio: this.wall.outerRatio, innerRatio: this.wall.innerRatio,
      outerBreaches: this.wall.outerBreaches, innerBreaches: this.wall.innerBreaches,
      citizensSaved: this.citizensSaved, citizensTotal: WALL.START_CITIZENS,
      wave: this.waves.currentWave, totalWaves: this.waves.totalWaves, score: this.score,
      activeMs: Math.round(this.activeMs), wavePhase: this.waves.phase,
      countdownMs: this.waves.countdownMs(this.simulationMs), inputMode: this.lastInputMode,
      edgeThreats: this.edgeThreatMarkers(),
    });
    this.updateWeakPointCue();
  }

  private edgeThreatMarkers(): { screenX: number; screenY: number }[] {
    const camera = this.cameras.main;
    return this.enemies
      .filter((enemy) => enemy.active && !enemy.isDying && this.wall.hasOpenPath(enemy.x, enemy.y) && this.wall.isInsideInner(enemy.x, enemy.y))
      .map((enemy) => ({
        screenX: (enemy.x - camera.scrollX) * camera.zoom,
        screenY: (enemy.y - camera.scrollY) * camera.zoom,
      }))
      .filter((point) => point.screenX < 0 || point.screenX > CANVAS.WIDTH || point.screenY < 0 || point.screenY > CANVAS.HEIGHT);
  }

  private updateWeakPointCue(): void {
    const aim = this.currentAim();
    let best: Enemy | null = null;
    let bestDistance = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.isDying) continue;
      const node = enemy.getCoolingNodeWorld();
      const camera = this.cameras.main;
      const screenX = (node.x - camera.scrollX) * camera.zoom;
      const screenY = (node.y - camera.scrollY) * camera.zoom;
      if (screenX < 0 || screenX > CANVAS.WIDTH || screenY < 0 || screenY > CANVAS.HEIGHT) continue;
      const distance = Phaser.Math.Distance.Between(aim.x, aim.y, node.x, node.y);
      if (distance < bestDistance) { bestDistance = distance; best = enemy; }
    }
    if (!best) { this.hud.drawWeakPointCue(null); return; }
    const node = best.getCoolingNodeWorld();
    const camera = this.cameras.main;
    const screenX = (node.x - camera.scrollX) * camera.zoom;
    const screenY = (node.y - camera.scrollY) * camera.zoom;
    const critical = this.combat.canCritical(best, aim.x, aim.y);
    const candidate = this.grapple.resolveCandidate(this.player.x, this.player.y, aim.x, aim.y);
    const tether = !critical && candidate?.target?.source === best && candidate.nodeHooked;
    this.hud.drawWeakPointCue({ screenX, screenY, radius: best.getNodeRadius() + 3, state: critical ? 'critical' : tether ? 'tether' : 'visible' });
  }

  private applyCentreBias(): void {
    if (!this.player) return;
    const clamp = (value: number): number => Phaser.Math.Clamp(value * CAMERA.CENTER_BIAS, -CAMERA.CENTER_BIAS_MAX, CAMERA.CENTER_BIAS_MAX);
    this.cameras.main.setFollowOffset(clamp(this.player.x - ARENA.CENTER_X), clamp(this.player.y - ARENA.CENTER_Y));
  }

  private shutdown(): void {
    window.removeEventListener('blur', this.focusLossHandler);
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.touch?.destroy();
    this.touch = null;
    this.grapple?.destroy();
  }
}
