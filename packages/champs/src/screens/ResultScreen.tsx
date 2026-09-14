import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { BattleOutcome } from '../game/battleStore';
import { getChampionById } from '../data/champions';
import ChampionFigure from '../components/ChampionFigure';
import {
  accountLevelForXp,
  masteryLevelForXp,
  type ChampsProfile,
  type MatchRewards,
} from '../profile';

interface ResultScreenProps {
  outcome: BattleOutcome;
  profile: ChampsProfile;
  rewards: MatchRewards;
  onRematch: () => void;
  onMenu: () => void;
}

/** Localized post-match summary backed by the authoritative scene outcome. */
export default function ResultScreen({ outcome, profile, rewards, onRematch, onMenu }: ResultScreenProps) {
  const { t, i18n } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const player = getChampionById(outcome.playerChampionId);
  const enemy = getChampionById(outcome.enemyChampionId);
  const playerName = player ? t(player.nameKey) : outcome.playerChampionId;
  const enemyName = enemy ? t(enemy.nameKey) : outcome.enemyChampionId;
  const formatNumber = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const mastery = profile.mastery[outcome.playerChampionId] ?? { xp: 0, matches: 0, wins: 0 };
  const masteryLevel = masteryLevelForXp(mastery.xp);
  const masteryProgress = masteryLevel >= 10 ? 200 : mastery.xp % 200;

  useEffect(() => { headingRef.current?.focus(); }, []);

  // The player's own code, if the match taught enough to learn one. Read-only here:
  // sharing is a copy, and an editable field would invite editing a code that only
  // means something as a whole.
  const myGhostCode = profile.myGhostCode;

  const resultKey = outcome.result === 'win' ? 'victory' : outcome.result === 'loss' ? 'defeat' : outcome.result;
  const subtitleKey = outcome.result === 'win' ? 'winSubtitle' : outcome.result === 'loss' ? 'loseSubtitle' : `${outcome.result}Subtitle`;

  return (
    <section className={`screen result-screen result-screen--${outcome.result}`} aria-labelledby="result-heading">
      <div className="result-screen__title-group">
        <p className="result-screen__eyebrow">
          {t('result.title')} · {t(`mode.${outcome.mode}`)} · {t(`matchKind.${outcome.matchKind}`)} · {t(`difficulty.${outcome.difficulty}`)}
        </p>
        <h1 ref={headingRef} id="result-heading" className="result-screen__banner" tabIndex={-1}>
          {t(`result.${resultKey}`)}
        </h1>
        <p className="result-screen__subtitle">{t(`result.${subtitleKey}`)}</p>
      </div>

      <div className="result-screen__matchup" aria-label={`${playerName} ${t('result.vs')} ${enemyName}`}>
        <span className="result-screen__champ" style={player ? { color: player.accentColor } : undefined}>
          {player && <ChampionFigure champion={player} team="ally" className="result-screen__figure" />}
          <span className="result-screen__champ-name">{playerName}</span>
        </span>
        <span className="result-screen__vs" aria-hidden="true">{t('result.vs')}</span>
        <span className="result-screen__champ" style={enemy ? { color: enemy.accentColor } : undefined}>
          {enemy && <ChampionFigure champion={enemy} team="enemy" className="result-screen__figure" />}
          <span className="result-screen__champ-name">{enemyName}</span>
        </span>
      </div>

      <dl className="result-screen__stats">
        <ResultStat label={t('result.duration')} value={formatTime(outcome.stats.durationSeconds)} />
        <ResultStat label={t('result.championKills')} value={formatNumber.format(outcome.stats.championKills)} />
        <ResultStat label={t('result.deaths')} value={formatNumber.format(outcome.deaths)} />
        <ResultStat label={t('result.minionKills')} value={formatNumber.format(outcome.stats.minionKills)} />
        <ResultStat label={t('result.objectives')} value={formatNumber.format(outcome.objectives)} />
        <ResultStat label={t('result.damageDealt')} value={formatNumber.format(outcome.stats.damageDealt)} />
        <ResultStat label={t('result.level')} value={formatNumber.format(outcome.stats.level)} />
        <ResultStat label={t('result.totalGoldEarned')} value={formatNumber.format(outcome.totalGoldEarned)} />
        <ResultStat label={t('result.gold')} value={formatNumber.format(outcome.stats.gold)} />
      </dl>
      <p className="result-screen__end-reason">{t('result.endReason')}: {t(`result.endReasons.${outcome.endReason}`)}</p>

      <div className="result-screen__progression">
        <section className="result-screen__rewards" aria-labelledby="rewards-heading">
          <h2 id="rewards-heading">{t('result.rewards')}</h2>
          <dl>
            <div><dt>{t('result.accountXp')}</dt><dd>+{formatNumber.format(rewards.accountXp)}</dd></div>
            <div><dt>{t('profile.currencyLabel')}</dt><dd>+{formatNumber.format(rewards.currency)}</dd></div>
            <div><dt>{t('result.masteryXp')}</dt><dd>+{formatNumber.format(rewards.masteryXp)}</dd></div>
          </dl>
        </section>
        <section className="result-screen__mastery" aria-labelledby="mastery-heading">
          <h2 id="mastery-heading">{t('result.masteryProgress', { champion: playerName })}</h2>
          <p>{t('profile.accountLevel', { value: accountLevelForXp(profile.accountXp) })} · {t('profile.currency', { value: profile.currency })}</p>
          <p>{t('profile.masteryLevel', { value: masteryLevel })} · {t('profile.matchesValue', { value: mastery.matches })}</p>
          <div className="result-screen__mastery-bar" role="progressbar" aria-label={t('result.masteryProgress', { champion: playerName })} aria-valuemin={0} aria-valuemax={200} aria-valuenow={masteryProgress}>
            <span style={{ width: `${(masteryProgress / 200) * 100}%` }} />
          </div>
          <p>{profile.tutorialCompleted ? t('profile.tutorialComplete') : t('profile.tutorialIncomplete')}</p>
        </section>
      </div>

      <div className="result-screen__actions">
{myGhostCode && (
  <section className="result__ghost">
    <h2>{t('result.yourGhost')}</h2>
    <p><code>{myGhostCode}</code></p>
    <p>{t('result.yourGhostHint')}</p>
  </section>
)}
        <button type="button" className="btn btn--primary" onClick={onRematch}>{t('result.rematch')} <span aria-hidden="true">↻</span></button>
        <button type="button" className="btn" onClick={onMenu}>{t('result.toMenu')}</button>
      </div>
    </section>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return <div className="result-screen__stat"><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, '0')}`;
}
