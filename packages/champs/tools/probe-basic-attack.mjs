/**
 * Live check for the champs basic-attack and warden paths, driven over raw CDP.
 *
 * Why a browser at all: `tryBasicAttackUnit` is called by the player, by bot champions, by MINIONS and by camp monsters,
 * and those four only meet in a running match. A green unit suite proves the extracted rule is right; it cannot prove the
 * scene still calls it. This measures the thing that would be silently dead: damage landing.
 *
 * Not a test-suite file on purpose — it needs a built bundle and a browser, so it lives with the other probe scripts and
 * is run by hand.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const URL_UNDER_TEST = process.argv[2] ?? 'http://127.0.0.1:8232/open-games/champs/';
const CHROME = (() => {
  const root = join(process.env.HOME, '.cache/ms-playwright');
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  return join(root, dir, 'chrome-linux64/chrome');
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(port) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('devtools never came up');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const id = next += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function main() {
  const port = 9231;
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--disable-gpu',
    '--use-gl=swiftshader',
    '--window-size=1280,800',
    URL_UNDER_TEST,
  ], { stdio: 'ignore' });

  try {
    const conn = client(await cdp(port));
    await conn.ready;
    await conn.send('Runtime.enable');
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await conn.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + JSON.stringify(exceptionDetails.exception?.description ?? ''));
      return result.value;
    };

    // --- reach a live match -------------------------------------------------
    /**
     * Poll, then click. A fixed sleep is not enough: an in-page click on a React node that has not mounted yet silently
     * does nothing, so each step waits for its own selector and reports which one it never saw.
     */
    const clickWhenReady = async (selector, timeoutMs = 20000) => {
      const ok = await evaluate(`new Promise(r => {
        const started = Date.now();
        const t = setInterval(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) { clearInterval(t); el.click(); r(true); }
          else if (Date.now() - started > ${timeoutMs}) { clearInterval(t); r(false); }
        }, 100);
      })`);
      if (!ok) {
        const seen = await evaluate(`[...document.querySelectorAll('[class*="mode-card"], [class*="main-menu"], [class*="champion-select"]')].map(e => e.className).slice(0, 12)`);
        throw new Error(`never saw ${selector}; visible candidates: ${JSON.stringify(seen)}`);
      }
      await sleep(500);
    };

    await clickWhenReady('.main-menu__play-arrow');
    // Midline is the unconditionally startable mode: conquest gates on champion unlocks.
    await clickWhenReady('.mode-card--midline');
    /**
     * Two champion-select variants exist and midline serves the RANDOM-roster one, whose lock-in is a
     * `.btn--primary` inside `.champion-select--random`. The full-roster screen uses
     * `.champion-select__find-match` instead. Accept either, so this probe does not silently depend on which
     * screen a mode happens to route to.
     */
    await clickWhenReady('.champion-select__find-match, .champion-select--random .btn--primary');

    const handleUp = await evaluate(`new Promise(r => { const t = setInterval(() => { if (window.__CHAMPS__) { clearInterval(t); r(true); } }, 150); setTimeout(() => { clearInterval(t); r(false); }, 30000); })`);
    if (!handleUp) throw new Error('never reached a battle: __CHAMPS__ absent');

    // --- measure ------------------------------------------------------------
    const sample = () => evaluate(`(() => {
      const c = window.__CHAMPS__;
      const bodies = c.bodies();
      return {
        tick: c.tick(),
        structures: c.structureHp(),
        minions: bodies.filter(b => b.kind === 'minion').map(b => ({ id: b.id, hp: b.hp, cd: b.attackCdRemaining })),
        champions: bodies.filter(b => b.kind === 'champion').map(b => ({ id: b.id, hp: b.hp, maxHp: b.maxHp, cd: b.attackCdRemaining })),
        counts: bodies.reduce((a, b) => ({ ...a, [b.kind]: (a[b.kind] ?? 0) + 1 }), {}),
        // Sampled so "a trap was armed during this run" is a measurement rather than a hope.
        trapsLive: c.traps().length,
      };
    })()`);

    const first = await sample();
    await sleep(45000);
    const last = await sample();

    const hurtStructures = last.structures.filter((s) => {
      const before = first.structures.find((b) => b.id === s.id);
      return before && s.hp < before.hp;
    });
    const minionDamage = last.minions.some((m) => {
      const before = first.minions.find((b) => b.id === m.id);
      return before && m.hp < before.hp;
    });
    const swingTimersMoving = last.minions.some((m) => m.cd > 0) || last.champions.some((c) => c.cd > 0);

    console.log(JSON.stringify({
      elapsedSeconds: Number((last.tick - first.tick).toFixed(2)),
      counts: last.counts,
      trapsLive: { first: first.trapsLive, last: last.trapsLive },
      structuresDamaged: hurtStructures.map((s) => s.id),
      minionTookDamage: minionDamage,
      swingTimersMoving,
      championHp: last.champions.map((c) => `${c.id}:${c.hp}/${c.maxHp}`),
    }, null, 2));

    const verdict = (last.tick > first.tick) && (minionDamage || hurtStructures.length > 0) && swingTimersMoving;
    console.log(verdict ? 'PASS: basic attacks land in a live match' : 'FAIL: no damage observed through the extracted path');
    process.exitCode = verdict ? 0 : 1;
    conn.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('probe error:', err.message);
  process.exitCode = 2;
});
