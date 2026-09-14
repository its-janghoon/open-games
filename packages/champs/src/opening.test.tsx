import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import App from './App';
import i18n from './i18n';
import { CHAMPIONS } from './data/champions';
import { STARTER_CHAMPION_IDS, createDefaultProfile } from './profile';

/**
 * The opening has to be completable, the same gate Frosthold, Kingdom Rise and
 * LAST SQUAD now carry. Arena Champions has no idle economy, so there is no
 * stockpile to strand - its equivalent failure is a lobby you cannot start a
 * match from, and it has a real mechanism for that.
 *
 * ChampionSelect picks its initial champion as the first UNLOCKED one and falls
 * back to CHAMPIONS[0] when the profile unlocks none. But starting a match
 * re-checks the unlock and silently returns for a locked champion. So an empty
 * starter roster renders a lobby that looks complete, preselects a champion, and
 * has a Find Match button that does nothing at all when pressed - no error, no
 * explanation. That is this game's softlock, and the reason the starter roster is
 * asserted here rather than left to a data file nobody re-reads.
 */
describe('champs opening is completable', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reaches a battle from a fresh profile without spending anything', () => {
    render(<App />);

    // Menu -> mode select.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('menu.standard') }));
    // The default difficulty is already chosen, so no click is required here.
    expect(
      screen.getByRole('button', { name: i18n.t('difficulty.normal') }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Mode -> champion select. Take CONQUEST, not midline. This matters: the
    // midline branch of handleLockIn returns before the unlock re-check because a
    // match seed resolves its roster, so it starts no matter what the profile
    // owns. Conquest is the gated path, so it is the one worth asserting - a first
    // draft of this test clicked midline (copied from ModeSelect's own test) and
    // therefore passed even with the starter roster emptied.
    fireEvent.click(screen.getByText(i18n.t('mode.conquest')));

    // Champion select -> battle. Pressing Find Match must actually leave the lobby.
    const findMatch = screen.getByRole('button', { name: i18n.t('select.findMatch') });
    fireEvent.click(findMatch);
    expect(
      screen.queryByRole('button', { name: i18n.t('select.findMatch') }),
      'Find Match did nothing - the lobby never advanced',
    ).not.toBeInTheDocument();
  });

  it('gives a new profile a startable roster, or conquest cannot be started', () => {
    // Non-empty, because an empty list makes the fallback preselect a champion the
    // start handler then refuses.
    expect(STARTER_CHAMPION_IDS.length).toBeGreaterThan(0);

    // Every starter must be a real champion, for the same reason: an id that
    // matches no champion cannot satisfy the unlock re-check either.
    const known = new Set(CHAMPIONS.map((c) => c.id));
    for (const id of STARTER_CHAMPION_IDS) {
      expect(known.has(id), `starter '${id}' is not a champion in CHAMPIONS`).toBe(true);
    }

    // And the profile a first-time player actually gets must include them.
    const fresh = createDefaultProfile();
    for (const id of STARTER_CHAMPION_IDS) {
      expect(fresh.unlockedChampionIds).toContain(id);
    }
  });

  it('locks nothing behind real money: the starter roster costs no currency', () => {
    // The unlock currency is earned by playing. This pins that a first-time
    // player is not asked to spend it before they can play at all - the mission's
    // no-payment-pressure rule at the only place it could bite on turn one.
    const fresh = createDefaultProfile();
    const startable = CHAMPIONS.filter((c) => fresh.unlockedChampionIds.includes(c.id));
    expect(startable.length).toBeGreaterThan(0);
  });
});
