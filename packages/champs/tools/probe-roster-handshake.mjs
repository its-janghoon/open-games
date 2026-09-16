/**
 * Live check for the roster handshake over a REAL RTCDataChannel.
 *
 * `RTCPeerConnection` does not exist in Node, so the handshake's unit suite runs it over an in-memory wire — which is how
 * the announce race, the reply ping-pong and a temporal-dead-zone crash were found. What that suite cannot say is that the
 * protocol survives a real data channel: an unordered, unreliable one (`ordered: false, maxRetransmits: 0`), where the
 * two sides genuinely become ready at different moments.
 *
 * Both peers live in ONE page, which is how packages/shared's own rtcTransport comment says to verify it. That is not a
 * shortcut: the offer/answer exchange, ICE, and the channel are all real, and being in one page only removes the need for
 * a second machine to copy a code to.
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

/**
 * Runs inside the page.
 *
 * Deliberately does NOT await the offerer's handshake before starting the answerer's: the whole point is that the two
 * sides become ready at different moments, which is the condition the announce race hid in.
 */
const IN_PAGE = `(async () => {
  const lobby = window.__CHAMPS_LOBBY__;
  if (!lobby) return { error: 'no __CHAMPS_LOBBY__ on the page' };
  if (!lobby.available()) return { error: 'this browser reports no WebRTC' };

  const offer = await lobby.createOffer();
  const answer = await lobby.createAnswer(offer.code);
  await offer.accept(answer.code);
  await Promise.all([offer.transport.ready, answer.transport.ready]);

  const common = { mode: 'conquest', timeoutMs: 8000, announceIntervalMs: 200 };
  const both = await Promise.all([
    lobby.handshake({
      link: offer.transport.link,
      participantId: 'peer-offerer',
      championId: 'ashborne',
      seedContribution: 'offer1234',
      ...common,
    }),
    lobby.handshake({
      link: answer.transport.link,
      participantId: 'peer-answerer',
      championId: 'frostquill',
      seedContribution: 'answer5678',
      ...common,
    }),
  ]);

  offer.transport.close();
  answer.transport.close();

  return {
    iceServersUsed: lobby.iceServersUsed(),
    digest: lobby.digest(),
    offerer: both[0],
    answerer: both[1],
  };
})()`;

async function main() {
  const port = 9233;
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

  try {
    const conn = client(await devtoolsUrl(port));
    await conn.ready;
    await conn.send('Runtime.enable');

    // Wait for the app to have registered the handle.
    const present = await conn.send('Runtime.evaluate', {
      expression: `new Promise(r => { const t = setInterval(() => { if (window.__CHAMPS_LOBBY__) { clearInterval(t); r(true); } }, 100); setTimeout(() => { clearInterval(t); r(false); }, 20000); })`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (!present.result.value) throw new Error('the lobby handle never appeared');

    const { result, exceptionDetails } = await conn.send('Runtime.evaluate', {
      expression: IN_PAGE,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);

    const out = result.value;
    const agreedBoth = out?.offerer?.kind === 'agreed' && out?.answerer?.kind === 'agreed';
    const sameAgreement =
      agreedBoth && JSON.stringify(out.offerer.agreement) === JSON.stringify(out.answerer.agreement);
    const noThirdParty = Array.isArray(out?.iceServersUsed) && out.iceServersUsed.length === 0;

    console.log(
      JSON.stringify(
        {
          verdict: sameAgreement && noThirdParty ? 'PASS' : 'FAIL',
          bothAgreed: agreedBoth,
          identicalAgreement: sameAgreement,
          iceServersUsed: out?.iceServersUsed,
          rosterDigest: out?.digest,
          agreement: out?.offerer?.agreement ?? out?.offerer ?? null,
          answererResult: out?.answerer?.kind ?? null,
          error: out?.error ?? null,
        },
        null,
        2,
      ),
    );
    process.exitCode = sameAgreement && noThirdParty ? 0 : 1;
    conn.close();
  } catch (err) {
    console.log(JSON.stringify({ verdict: 'ERROR', error: err.message }, null, 2));
    process.exitCode = 2;
  } finally {
    chrome.kill('SIGTERM');
  }
}

main();
