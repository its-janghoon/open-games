import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import App from './App';
// The maintainer thumbnail tool's recipe, tested from the game it describes.
import { CAPTURE_RECIPES, DOM_CHROME_JS } from '../../../scripts/lib/capture-chrome.mjs';

/**
 * champs' thumbnail was hand-maintained because its battle sits behind a React
 * menu flow that the display-list capture recipe could not reach. The recipe now
 * carries that flow, and this pins the two parts of it that can rot silently.
 *
 * The selectors are STRUCTURAL rather than textual because the capture context
 * runs in ko-KR; a text match would break on any copy edit. But a structural
 * selector breaks on any refactor instead, with no error a maintainer would see -
 * the tool just photographs the menu and the failure looks like a design choice.
 * Hence this test.
 *
 * What is NOT covered, stated plainly: the DOM sweep cannot be verified against
 * the real HUD here. That HUD mounts only when the Phaser scene reports ready,
 * which needs a browser with a GPU, and in this environment the battle screen
 * renders a loading placeholder instead. The sweep is therefore tested against a
 * SYNTHETIC tree of the same shape, which proves its logic - most importantly that
 * it never hides the canvas - but not that champs' real chrome disappears. The
 * capture script itself could not be executed in this environment at all.
 */
describe('champs capture recipe', () => {
  const recipe = (CAPTURE_RECIPES as Record<string, Record<string, unknown>>).champs;

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('walks its nav selectors from the menu to a mounted battle stage', () => {
    const { container } = render(<App />);
    const steps = (recipe.nav as { click: string }[]).map((s) => s.click);
    expect(steps.length).toBeGreaterThan(0);

    for (const selector of steps) {
      const el = container.querySelector(selector);
      expect(el, `capture recipe selector '${selector}' matched nothing`).not.toBeNull();
      fireEvent.click(el!);
    }

    // The flow has to END somewhere a screenshot is worth taking.
    expect(
      container.querySelector(recipe.domKeepCanvasChain as string),
      `flow did not reach '${recipe.domKeepCanvasChain}'`,
    ).not.toBeNull();
  });

  it('sweeps chrome beside the canvas and never the canvas itself', () => {
    document.body.innerHTML = `
      <section class="battle-screen">
        <header class="hud-top"><p>score</p></header>
        <div class="battle-stage-slot">
          <aside class="hud-side">abilities</aside>
          <div class="battle-stage"><canvas></canvas></div>
        </div>
        <footer class="hud-bottom"><button>quit</button></footer>
      </section>`;

    // eslint-disable-next-line no-eval
    const sweep = eval(DOM_CHROME_JS) as (root: string) => {
      hid: number;
      canvasVisible: boolean;
      error?: string;
    };
    const result = sweep('.battle-screen');

    expect(result.error).toBeUndefined();
    // Three chrome nodes sit beside the canvas's ancestor chain.
    expect(result.hid).toBe(3);
    expect(result.canvasVisible).toBe(true);

    const hidden = (sel: string) =>
      (document.querySelector(sel) as HTMLElement).style.display === 'none';
    expect(hidden('.hud-top')).toBe(true);
    expect(hidden('.hud-side')).toBe(true);
    expect(hidden('.hud-bottom')).toBe(true);
    // The chain itself survives, or the screenshot would be blank.
    expect(hidden('.battle-stage-slot')).toBe(false);
    expect(hidden('.battle-stage')).toBe(false);
  });

  it('reports an error instead of blanking the page when there is no canvas', () => {
    document.body.innerHTML = '<section class="battle-screen"><p>loading</p></section>';
    // eslint-disable-next-line no-eval
    const sweep = eval(DOM_CHROME_JS) as (root: string) => { error?: string };
    expect(sweep('.battle-screen').error).toMatch(/no canvas/);
    // Nothing was hidden, so a failed sweep degrades to shooting the page as-is.
    expect((document.querySelector('p') as HTMLElement).style.display).not.toBe('none');
  });
});
