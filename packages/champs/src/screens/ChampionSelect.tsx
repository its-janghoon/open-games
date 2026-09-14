import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHAMPIONS,
  getAllAbilities,
  getChampionById,
  randomChampionId,
  type Champion,
  type ChampionStats,
} from '../data/champions';
import { abilitySvgFor } from '../game/render/abilityIcons';
import AbilityCard from '../components/AbilityCard';
import ChampionFigure from '../components/ChampionFigure';
import ClientNav from '../components/ClientNav';
import { masteryLevelForXp, type ChampsProfile } from '../profile';
import type { GameMode } from '../App';

export const CHAMPION_UNLOCK_COST = 250;

interface ChampionSelectProps {
  mode?: GameMode;
  profile: ChampsProfile;
  accountLevel: number;
  onUnlock: (championId: string) => void;
  onLockIn: (playerId: string, enemyId: string) => void;
  onBack?: () => void;
  /** Import a pasted ghost code; returns what happened so the UI can say so. */
  onImportGhost?: (code: string) => 'saved' | 'duplicate' | 'rejected';
  navControls?: ReactNode;
}

const STAT_ORDER: (keyof ChampionStats)[] = [
  'hp',
  'hpRegen',
  'moveSpeed',
  'attackDamage',
  'attackRange',
  'attackSpeed',
];

/** Profile-aware champion selection with explicit, currency-backed unlocks. */
export default function ChampionSelect({
  mode = 'conquest',
  profile,
  accountLevel,
  onUnlock,
  onLockIn,
  onBack,
  onImportGhost,
  navControls,
}: ChampionSelectProps) {
  const { t } = useTranslation();
  /**
   * Ghost paste state. A refusal is SHOWN rather than swallowed: a code arrives by
   * being copied out of a chat message, so the common failure is a partial paste, and
   * a field that quietly does nothing reads as the feature being broken.
   */
  const [ghostInput, setGhostInput] = useState('');
  const [ghostNotice, setGhostNotice] = useState<string | null>(null);
  const firstUnlocked = CHAMPIONS.find((champion) =>
    profile.unlockedChampionIds.includes(champion.id),
  ) ?? CHAMPIONS[0];
  const [selectedId, setSelectedId] = useState<string>(firstUnlocked.id);
  const [enemyId, setEnemyId] = useState<string>(() => randomChampionId(firstUnlocked.id));
  const [detailOpen, setDetailOpen] = useState(false);

  const selected: Champion | undefined = useMemo(
    () => getChampionById(selectedId),
    [selectedId],
  );
  const selectedMastery = profile.mastery[selectedId];

  const handleSelect = (id: string) => {
    if (!profile.unlockedChampionIds.includes(id)) return;
    setSelectedId(id);
    if (id === enemyId) setEnemyId(randomChampionId(id));
  };

  const handleRandomizeOpponent = () => setEnemyId(randomChampionId(selectedId));

  const handleRosterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const available = CHAMPIONS.filter((champion) => profile.unlockedChampionIds.includes(champion.id));
    const current = Math.max(0, available.findIndex((champion) => champion.id === selectedId));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? available.length - 1
        : (current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
    const next = available[nextIndex];
    if (!next) return;
    handleSelect(next.id);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-champion-id="${next.id}"]`)?.focus());
  };

  const handleLockIn = () => {
    if (mode === 'midline') {
      // Values are request placeholders only; the issued match seed resolves the
      // actual disjoint roster before Phaser starts.
      onLockIn(CHAMPIONS[0].id, CHAMPIONS[1].id);
      return;
    }
    if (!profile.unlockedChampionIds.includes(selectedId)) return;
    onLockIn(selectedId, enemyId === selectedId ? randomChampionId(selectedId) : enemyId);
  };

  if (mode === 'midline') {
    return (
      <section className="champion-select champion-select--random" aria-labelledby="random-roster-heading">
        <ClientNav controls={navControls} />
        <div className="random-roster">
          <p className="mode-select__eyebrow">{t('mode.midline')}</p>
          <h2 id="random-roster-heading" className="screen__heading">{t('select.randomRoster')}</h2>
          <p>{t('select.randomRosterDescription')}</p>
          <div className="random-roster__slots" aria-label={t('select.randomRoster')}>
            {Array.from({ length: 10 }, (_, index) => (
              <span key={index} className="random-roster__slot" aria-hidden="true">?</span>
            ))}
          </div>
          <p className="random-roster__note">{t('select.randomRosterRule')}</p>
          <div className="random-roster__actions">
            <button type="button" className="btn btn--primary" onClick={handleLockIn}>{t('select.findMatch')}</button>
            {onBack && <button type="button" className="btn" onClick={onBack}>{t('common.back')}</button>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="champion-select" aria-label={t('select.heading')}>
      <ClientNav controls={navControls} />

      <div className="champion-select__stage">
        <div className="champion-select__main">
          <header className="champion-select__topbar">
            <h2 className="screen__heading champion-select__heading">{t('select.heading')}</h2>
            <p className="champion-select__hint">
              {t('select.pickHint')} · {t(`mode.${mode}`)}
            </p>
            <div className="profile-summary profile-summary--select" aria-label={t('profile.summary')}>
              <span>{t('profile.accountLevel', { value: accountLevel })}</span>
              <span>{t('profile.currency', { value: profile.currency })}</span>
              <span>{profile.tutorialCompleted ? t('profile.tutorialComplete') : t('profile.tutorialIncomplete')}</span>
            </div>
          </header>

          <div className="champion-select__cards" role="listbox" aria-label={t('select.rosterLabel')} onKeyDown={handleRosterKeyDown}>
            {CHAMPIONS.map((champion) => {
              const unlocked = profile.unlockedChampionIds.includes(champion.id);
              const isSelf = champion.id === selectedId;
              const isEnemy = champion.id === enemyId;
              const name = t(champion.nameKey);
              const portraitStyle = {
                background: `radial-gradient(circle at 30% 22%, ${champion.accentColor}, transparent 72%), linear-gradient(160deg, ${champion.accentColor}33, #010a13 88%)`,
                borderColor: champion.accentColor,
              };
              return (
                <div key={champion.id} className={`lobby-card-slot${unlocked ? '' : ' is-locked'}`}>
                  <button
                    type="button"
                    role="option"
                    data-champion-id={champion.id}
                    tabIndex={unlocked && isSelf ? 0 : -1}
                    aria-selected={isSelf}
                    aria-disabled={!unlocked}
                    aria-label={`${name} - ${t(champion.titleKey)}${unlocked ? '' : ` - ${t('select.locked')}`}`}
                    className={`lobby-card${isSelf ? ' is-self' : ''}${unlocked ? '' : ' is-locked'}`}
                    onClick={() => handleSelect(champion.id)}
                  >
                    <span className="lobby-card__slotlabel">
                      {!unlocked ? t('select.locked') : isSelf ? t('select.you') : isEnemy ? t('select.opponent') : t(`laneRole.${champion.laneRole}`)}
                    </span>
                    <span className="lobby-card__portrait" style={portraitStyle} aria-hidden="true">
                      <ChampionFigure champion={champion} className="lobby-card__figure" />
                    </span>
                    <span className="lobby-card__name">{name}</span>
                    <span className="lobby-card__role" style={{ color: champion.accentColor }}>{t(`role.${champion.role}`)}</span>
                    <span className="lobby-card__spells" aria-hidden="true">
                      {getAllAbilities(champion).filter((ability) => ability.slot !== 'P').map((ability) => (
                        <span
                          key={ability.slot}
                          className="lobby-card__spell"
                          style={{ borderColor: champion.accentColor }}
                          dangerouslySetInnerHTML={{ __html: abilitySvgFor(champion.id, ability.slot, ability.behavior) }}
                        />
                      ))}
                    </span>
                  </button>
                  {!unlocked && (
                    <button
                      type="button"
                      className="btn lobby-card__unlock"
                      disabled={profile.currency < CHAMPION_UNLOCK_COST}
                      aria-label={t('select.unlockAria', { champion: name, cost: CHAMPION_UNLOCK_COST })}
                      onClick={() => onUnlock(champion.id)}
                    >
                      {t('select.unlock', { cost: CHAMPION_UNLOCK_COST })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {selected && (
            <section className="champion-select__detail">
              <button type="button" className="champion-select__detail-toggle" aria-expanded={detailOpen} onClick={() => setDetailOpen((open) => !open)}>
                <span className="champion-select__detail-name">{t(selected.nameKey)}</span>
                <span className="champion-select__detail-title">{t(selected.titleKey)}</span>
                <span className="champion-select__detail-caret" aria-hidden="true">{detailOpen ? '\u25B2' : '\u25BC'}</span>
              </button>

              {detailOpen && (
                <div className="champion-select__detail-body">
                  <section className="champion-detail__stats">
                    <h4 className="champion-detail__subheading">{t('select.statsHeading')}</h4>
                    <dl className="stat-grid">
                      {STAT_ORDER.map((key) => (
                        <div className="stat-grid__item" key={key}><dt>{t(`stat.${key}`)}</dt><dd>{selected.stats[key]}</dd></div>
                      ))}
                    </dl>
                  </section>
                  <section className="champion-detail__abilities">
                    <h4 className="champion-detail__subheading">{t('select.abilitiesHeading')}</h4>
                    <div className="ability-list">
                      {getAllAbilities(selected).map((ability) => (
                        <AbilityCard key={ability.slot} ability={ability} accentColor={selected.accentColor} championId={selected.id} />
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </section>
          )}

          <footer className="champion-select__footer">
            <div className="champion-select__opponent">
              <span className="champion-select__opponent-label">{t('select.opponentHeading')}</span>
              <select
                className="champion-select__opponent-picker"
                aria-label={t('select.opponentHeading')}
                value={enemyId}
                onChange={(event) => setEnemyId(event.target.value === selectedId ? randomChampionId(selectedId) : event.target.value)}
              >
                {CHAMPIONS.filter((champion) => champion.id !== selectedId).map((champion) => (
                  <option key={champion.id} value={champion.id}>{t(champion.nameKey)}</option>
                ))}
              </select>
              <button type="button" className="btn champion-select__randomize" onClick={handleRandomizeOpponent}>{t('select.randomize')}</button>
            </div>

            {onImportGhost && (
              <div className="champion-select__ghost">
                <label htmlFor="ghost-code">{t('select.ghostLabel')}</label>
                <input
                  id="ghost-code"
                  type="text"
                  value={ghostInput}
                  onChange={(event) => { setGhostInput(event.target.value); setGhostNotice(null); }}
                  placeholder="0609-S040-G207-4B2G-NA0G"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const outcome = onImportGhost(ghostInput);
                    setGhostNotice(t(`select.ghost.${outcome}`));
                    if (outcome === 'saved') setGhostInput('');
                  }}
                  disabled={ghostInput.trim().length === 0}
                >
                  {t('select.ghostImport')}
                </button>
                {ghostNotice && <p role="status" aria-live="polite">{ghostNotice}</p>}
              </div>
            )}
            <button type="button" className="champion-select__find-match" onClick={handleLockIn}>{t('select.findMatch')}</button>
            {onBack && <button type="button" className="btn champion-select__back" onClick={onBack}>{t('common.back')}</button>}
          </footer>
        </div>

        <aside className="social-panel profile-panel" aria-label={t('profile.summary')}>
          <h3 className="social-panel__title">{t('profile.summary')}</h3>
          <dl className="profile-panel__list">
            <div><dt>{t('profile.mastery')}</dt><dd>{t('profile.masteryLevel', { value: masteryLevelForXp(selectedMastery?.xp ?? 0) })}</dd></div>
            <div><dt>{t('profile.matches')}</dt><dd>{selectedMastery?.matches ?? 0}</dd></div>
            <div><dt>{t('profile.practice')}</dt><dd>{profile.practiceCompleted ? t('profile.complete') : t('profile.incomplete')}</dd></div>
            <div><dt>{t('profile.tutorial')}</dt><dd>{profile.tutorialCompleted ? t('profile.complete') : t('profile.incomplete')}</dd></div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
