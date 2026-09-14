import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageToggle from './components/LanguageToggle';
import SettingsPanel from './components/SettingsPanel';
import MainMenu from './screens/MainMenu';
import ModeSelect from './screens/ModeSelect';
import ChampionSelect, { CHAMPION_UNLOCK_COST } from './screens/ChampionSelect';
import BattleScreen from './screens/BattleScreen';
import ResultScreen from './screens/ResultScreen';
import type { BattleOutcome, GameMode } from './game/battleStore';
import { issueMatchRequest, type MatchRequest } from './game/matchRequest';
import type { Difficulty, MatchKind } from './game/tutorial/config';
import {
  accountLevelForXp,
  applyMatchOutcomeTransaction,
  loadProfile,
  saveProfile,
  setLastSetup,
  unlockChampion,
  type ChampsProfile,
  type LastMatchSetup,
  type MatchRewards,
} from './profile';
import { importGhostCode } from './profile/ghostStore';
import {
  clearTelemetryData,
  denyTelemetryConsent,
  exportTelemetryData,
  grantTelemetryConsent,
  matchDurationBucket,
  recordTelemetry,
  startConsentGatedTelemetryCapture,
  telemetryRuntimeStatus,
} from './telemetry/runtime';

export type { GameMode } from './game/battleStore';
export type Screen = 'menu' | 'mode' | 'select' | 'battle' | 'result';
export type MatchSetup = LastMatchSetup;

const defaultsForKind = (matchKind: MatchKind): Difficulty =>
  matchKind === 'standard' ? 'normal' : 'easy';

export default function App() {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<ChampsProfile>(() => loadProfile());
  const [screen, setScreen] = useState<Screen>('menu');
  const [mode, setMode] = useState<GameMode>('conquest');
  const [matchKind, setMatchKind] = useState<MatchKind>('standard');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [match, setMatch] = useState<MatchRequest | null>(null);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const [rewards, setRewards] = useState<MatchRewards | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [matchNonce, setMatchNonce] = useState(0);
  const [storageHealthy, setStorageHealthy] = useState(true);
  const [telemetryStatus, setTelemetryStatus] = useState(telemetryRuntimeStatus);
  const claimedMatchIds = useRef(new Set(profile.appliedMatchIds));
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    document.title = t('app.title');
    document.documentElement.lang = i18n.resolvedLanguage ?? i18n.language;
  }, [i18n.language, i18n.resolvedLanguage, t]);

  useEffect(() => {
    if (!telemetryStatus.enabled) return undefined;
    return startConsentGatedTelemetryCapture();
  }, [telemetryStatus.enabled]);

  useEffect(() => {
    const refreshPrivacy = () => setTelemetryStatus(telemetryRuntimeStatus());
    document.addEventListener('visibilitychange', refreshPrivacy);
    window.addEventListener('focus', refreshPrivacy);
    window.addEventListener('online', refreshPrivacy);
    return () => {
      document.removeEventListener('visibilitychange', refreshPrivacy);
      window.removeEventListener('focus', refreshPrivacy);
      window.removeEventListener('online', refreshPrivacy);
    };
  }, []);

  const save = useCallback((next: ChampsProfile) => {
    const saved = saveProfile(next);
    if (!saved) setStorageHealthy(false);
    return saved;
  }, []);

  /**
   * Import a pasted ghost code. Returns the outcome rather than a boolean so the screen
   * can tell the player WHY a paste was refused - a truncated code and a duplicate are
   * different problems with different fixes.
   */
  const handleImportGhost = useCallback(
    (code: string) => {
      const result = importGhostCode(profile, code);
      if (result.outcome === 'saved') {
        setProfile(result.profile);
        save(result.profile);
      }
      return result.outcome;
    },
    [profile, save],
  );

  const grantDiagnostics = useCallback(() => setTelemetryStatus(grantTelemetryConsent()), []);
  const denyDiagnostics = useCallback(() => setTelemetryStatus(denyTelemetryConsent()), []);
  const clearDiagnostics = useCallback(() => clearTelemetryData(), []);
  const downloadDiagnostics = useCallback(async () => {
    const json = await exportTelemetryData();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `champs-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const enterBattle = useCallback((setup: MatchSetup, ghostCode?: string) => {
    const issued = issueMatchRequest(profile, setup);
    // Attached to the REQUEST, not to the setup: the setup is what gets persisted as
    // lastSetup, and putting the opponent choice there would both survive into matches
    // the player did not ask it for and need its own migration handling.
    const request = ghostCode ? { ...issued.request, ghostCode } : issued.request;
    const nextProfile = setLastSetup(issued.profile, setup);
    save(nextProfile);
    setProfile(nextProfile);
    recordTelemetry({
      type: 'session-started',
      sessionKind: setup.matchKind === 'practice' ? 'practice' : 'local',
    });
    setMode(setup.mode);
    setMatchKind(setup.matchKind);
    setDifficulty(setup.difficulty);
    setMatch(request);
    setOutcome(null);
    setRewards(null);
    setMatchNonce((nonce) => nonce + 1);
    setScreen('battle');
  }, [profile, save]);

  const beginFlow = (kind: MatchKind) => {
    setMatchKind(kind);
    setDifficulty(defaultsForKind(kind));
    setMode('conquest');
    setScreen('mode');
  };
  const handleModeSelect = (chosen: GameMode) => { setMode(chosen); setScreen('select'); };
  const handleLockIn = (playerChampionId: string, enemyChampionId: string) => {
    if (mode === 'conquest' && !profile.unlockedChampionIds.includes(playerChampionId)) return;
    // The most recently added ghost is the opponent, and only in conquest: midline
    // resolves its own roster from a match seed, so a ghost there would fight with a
    // team the player never chose. Undefined leaves the ordinary AI in place, which is
    // what every existing match keeps doing.
    const ghostCode = mode === 'conquest' ? profile.ghostCodes[0] : undefined;
    enterBattle({ playerChampionId, enemyChampionId, mode, matchKind, difficulty }, ghostCode);
  };
  const handleContinue = () => {
    const setup = profile.lastSetup;
    if (!setup) return;
    if (setup.mode === 'conquest' && !profile.unlockedChampionIds.includes(setup.playerChampionId)) {
      setMode(setup.mode);
      setMatchKind(setup.matchKind);
      setDifficulty(setup.difficulty);
      setScreen('select');
      return;
    }
    enterBattle(setup);
  };
  const handleUnlock = (championId: string) => {
    const next = unlockChampion(profile, championId, CHAMPION_UNLOCK_COST);
    if (next !== profile) save(next);
    setProfile(next);
  };

  const handleGameEnd = (result: BattleOutcome) => {
    if (claimedMatchIds.current.has(result.matchId)) return;
    claimedMatchIds.current.add(result.matchId);
    if (result.result === 'abandoned') {
      setOutcome(null);
      setRewards(null);
      setScreen('menu');
      return;
    }
    const applied = applyMatchOutcomeTransaction(profile, result);
    if (!applied.applied) return;
    save(applied.profile);
    setProfile(applied.profile);
    recordTelemetry({
      type: 'match-completed',
      mode: result.mode,
      result: result.result,
      durationBucket: matchDurationBucket(result.stats.durationSeconds),
    });
    setRewards(applied.rewards);
    setOutcome(result);
    setScreen('result');
  };
  const handleRematch = () => {
    if (!match) { setScreen('mode'); return; }
    const { matchId: _matchId, matchSeed: _matchSeed, ...setup } = match;
    enterBattle(setup);
  };

  const controls = (
    <>
      <LanguageToggle />
      <button type="button" className="app-controls__settings" aria-label={t('settings.openAria')} title={t('settings.open')} onClick={openSettings}>
        <svg className="app-controls__gear" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.25" />
          <path d="M12 2.5v3M12 18.5v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2.5 12h3M18.5 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
        </svg>
      </button>
    </>
  );
  const controlsInNav = screen === 'select';

  return (
    <div className="app-shell">
      {!controlsInNav && <div className="app-controls">{controls}</div>}
      {!storageHealthy && <p className="storage-warning" role="status">{t('profile.storageWarning')}</p>}
      <main className="app-main">
        {screen === 'menu' && <MainMenu profile={profile} accountLevel={accountLevelForXp(profile.accountXp)} onContinue={profile.lastSetup ? handleContinue : undefined} onStandard={() => beginFlow('standard')} onPractice={() => beginFlow('practice')} onTutorial={() => beginFlow('tutorial')} />}
        {screen === 'mode' && <ModeSelect selected={mode} matchKind={matchKind} difficulty={difficulty} onDifficultyChange={setDifficulty} onSelect={handleModeSelect} onBack={() => setScreen('menu')} />}
        {screen === 'select' && <ChampionSelect mode={mode} profile={profile} accountLevel={accountLevelForXp(profile.accountXp)} onUnlock={handleUnlock} onLockIn={handleLockIn} onBack={() => setScreen('mode')} onImportGhost={handleImportGhost} navControls={controls} />}
        {screen === 'battle' && match && <BattleScreen match={match} matchNonce={matchNonce} settingsOpen={settingsOpen} onGameEnd={handleGameEnd} onQuit={() => setScreen('select')} />}
        {screen === 'result' && outcome && rewards && <ResultScreen outcome={outcome} profile={profile} rewards={rewards} onRematch={handleRematch} onMenu={() => setScreen('menu')} />}
      </main>
      {settingsOpen && <SettingsPanel onClose={closeSettings} telemetryStatus={telemetryStatus} onTelemetryGrant={grantDiagnostics} onTelemetryDeny={denyDiagnostics} onTelemetryExport={downloadDiagnostics} onTelemetryClear={clearDiagnostics} />}
    </div>
  );
}
