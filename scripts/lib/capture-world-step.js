/**
 * Capture one movement sample out of a LIVE champs match, for the differential in
 * scripts/diff-world-step.mjs.
 *
 * Evaluated in the page over CDP. Written as a probe rather than a test because the
 * scene cannot run in Node: this is the only way to compare the extracted step against
 * the authority that still owns the world.
 *
 * Why a straight-line move is enough to be decisive: along a fixed goal the direction
 * never changes, so N small steps and one step of the summed dt land in the same place.
 * That removes the need to capture the scene's variable per-frame dt, which is not
 * observable from outside its update loop - and a capture that had to guess at dt would
 * report differences that are its own fault.
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
    return !!el;
  };

  // A fresh profile so the flow is deterministic rather than resuming a saved match.
  localStorage.removeItem('champs:profile');
  click('button:has(.main-menu__play-arrow)');
  await sleep(1100);
  click('.mode-card--conquest');
  await sleep(1100);
  click('.champion-select__find-match');
  await sleep(9000);

  const game = window.__GAME__;
  const scene = game && game.scene.getScene('battle');
  if (!scene) return { error: 'not in battle' };
  const unit = scene.player.unit;

  // A goal far enough that the move never completes inside the window, so the sample
  // measures speed rather than arrival.
  const goal = { x: unit.pos.x + 900, y: unit.pos.y + 300 };
  const before = {
    pos: { x: unit.pos.x, y: unit.pos.y },
    moveSpeed: unit.moveSpeed,
    attackCdRemaining: unit.attackCdRemaining,
  };
  const cdsBefore = { ...scene.playerCds };

  const t0 = performance.now();
  scene.processCommand({ type: 'move-to', point: goal });
  await sleep(1500);
  const elapsedSeconds = (performance.now() - t0) / 1000;

  return {
    goal,
    elapsedSeconds,
    before,
    cdsBefore,
    after: {
      pos: { x: unit.pos.x, y: unit.pos.y },
      moveSpeed: unit.moveSpeed,
      attackCdRemaining: unit.attackCdRemaining,
    },
    cdsAfter: { ...scene.playerCds },
    // Reported so the comparator can say WHY a difference exists rather than only that
    // it does. These are the modifiers the scene consults that the extracted step takes
    // as data - if any is non-neutral, the capture is not a clean baseline.
    context: {
      slowFactor: 0,
      buffFraction: 0,
      pinned: false,
      note: 'captured at match start, before any ability or buff is active',
    },
  };
})();
