/**
 * Live check for the warden SPEND path, driven over raw CDP.
 *
 * The gap this closes was stated in the extraction commit: `planWardenSpend` and `wardenTargetOrder` are unit-tested, but
 * a unit test cannot show the SCENE acquiring a charge and spending it. That needs a real conquest match past the herald
 * window (180s; midline has no herald at all, its window is 0/0), a herald kill attributed to a side, and the
 * `use-warden` player command going through the same funnel the HUD button uses.
 *
 * Every action here is a real BattleCommand. Nothing grants a charge directly: a probe that injected one would verify the
 * spend arithmetic while leaving the acquisition path — the half that decides WHICH side gets the charge — unobserved.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const URL_UNDER_TEST = process.argv[2] ?? 'http://127.0.0.1:8232/open-games/champs/';
/** Match seconds to wait for. The herald window opens at 180 and closes at 420. */
const HERALD_DEADLINE_SECONDS = Number(process.argv[3] ?? 300);
const CHROME = (() => {
  const root = join(process.env.HOME, '.cache/ms-playwright');
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  return join(root, dir, 'chrome-linux64/chrome');
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsUrl(port) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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
      const id = (next += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function main() {
  const port = 9232;
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--window-size=1280,800',
      URL_UNDER_TEST,
    ],
    { stdio: 'ignore' },
  );

  const log = [];
  try {
    const conn = client(await devtoolsUrl(port));
    await conn.ready;
    await conn.send('Runtime.enable');
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await conn.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(`${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`);
      }
      return result.value;
    };
    const clickWhenReady = async (selector, timeoutMs = 20000) => {
      const ok = await evaluate(`new Promise(r => {
        const started = Date.now();
        const t = setInterval(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el) { clearInterval(t); el.click(); r(true); }
          else if (Date.now() - started > ${timeoutMs}) { clearInterval(t); r(false); }
        }, 100);
      })`);
      if (!ok) throw new Error(`never saw ${selector}`);
      await sleep(500);
    };

    // --- reach a live CONQUEST match ---------------------------------------
    await evaluate(
      `new Promise(r => { const t = setInterval(() => { if (document.querySelector('.main-menu__play-arrow')) { clearInterval(t); r(true); } }, 100); setTimeout(() => { clearInterval(t); r(false); }, 20000); })`,
    );
    await clickWhenReady('.main-menu__play-arrow');
    // Conquest, not midline: midline's herald window is 0/0, so the charge can never be acquired there.
    await clickWhenReady('.mode-card--conquest');
    await clickWhenReady('.champion-select__find-match, .champion-select--random .btn--primary');
    const up = await evaluate(
      `new Promise(r => { const t = setInterval(() => { if (window.__CHAMPS__ && window.__CHAMPS__.warden) { clearInterval(t); r(true); } }, 150); setTimeout(() => { clearInterval(t); r(false); }, 30000); })`,
    );
    if (!up) throw new Error('never reached a battle with a warden-aware debug handle');

    const read = () =>
      evaluate(`(() => {
      const c = window.__CHAMPS__;
      const w = c.warden();
      return {
        tick: c.tick(),
        charges: w.charges,
        herald: w.objectives.find(o => o.id === 'herald') ?? null,
        structures: c.structureHp(),
        player: c.space().playerPos,
      };
    })()`);
    const command = (payload) =>
      evaluate(`(window.__CHAMPS__.command(${JSON.stringify(payload)}), true)`);

    // --- drive the player onto the herald ---------------------------------
    let state = await read();
    let heraldSeen = false;
    let charge = null;
    let chargeAt = null;

    while (state.tick < HERALD_DEADLINE_SECONDS && !charge) {
      state = await read();
      const herald = state.herald;
      if (herald?.alive && herald.pos) {
        if (!heraldSeen) {
          heraldSeen = true;
          log.push(`herald up at ${state.tick.toFixed(1)}s hp=${herald.hp}`);
        }
        // A real order pair: walk onto it, then attack it. `target-at` resolves the point to a unit in the scene.
        await command({ type: 'attack-move-to', point: herald.pos });
        await command({ type: 'target-at', point: herald.pos });
      }
      if (state.charges.ally || state.charges.enemy) {
        charge = state.charges.ally ? 'ally' : 'enemy';
        chargeAt = state.tick;
        log.push(`charge acquired by ${charge} at ${state.tick.toFixed(1)}s`);
      }
      await sleep(1500);
    }

    if (!charge) {
      log.push(`no charge acquired by ${state.tick.toFixed(1)}s (herald seen: ${heraldSeen})`);
      console.log(JSON.stringify({ verdict: 'INCONCLUSIVE', log, herald: state.herald }, null, 2));
      process.exitCode = 3;
      conn.close();
      return;
    }

    // --- spend it through the same command the HUD button sends ------------
    const before = await read();
    if (charge === 'ally') await command({ type: 'use-warden' });

    let after = before;
    for (let i = 0; i < 20 && (after.charges.ally || after.charges.enemy); i += 1) {
      await sleep(1000);
      after = await read();
    }

    const hits = after.structures
      .map((s) => {
        const was = before.structures.find((b) => b.id === s.id);
        return was ? { id: s.id, delta: was.hp - s.hp } : null;
      })
      .filter((s) => s && s.delta > 0)
      .sort((a, b) => b.delta - a.delta);

    const spent = !after.charges.ally && !after.charges.enemy;
    const bigHit = hits.find((h) => h.delta >= 300);
    log.push(`charge cleared: ${spent}; largest structure loss: ${hits[0] ? `${hits[0].id} -${hits[0].delta}` : 'none'}`);

    const verdict = spent && Boolean(bigHit);
    console.log(
      JSON.stringify(
        {
          verdict: verdict ? 'PASS' : 'FAIL',
          chargeSide: charge,
          chargeAcquiredAt: chargeAt,
          spentBy: charge === 'ally' ? 'use-warden command' : 'held-warden policy',
          structureLosses: hits.slice(0, 4),
          log,
        },
        null,
        2,
      ),
    );
    process.exitCode = verdict ? 0 : 1;
    conn.close();
  } catch (err) {
    console.log(JSON.stringify({ verdict: 'ERROR', error: err.message, log }, null, 2));
    process.exitCode = 2;
  } finally {
    chrome.kill('SIGTERM');
  }
}

main();
