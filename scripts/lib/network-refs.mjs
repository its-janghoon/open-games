/**
 * Rules for finding code in a BUILT bundle that would reach a third party at
 * runtime.
 *
 * Why the built output and not the source: a dependency can emit a request the
 * source never shows. Reading `src/` proves nothing about what ships.
 *
 * Why these rules are SYNTACTIC and not "does a URL appear": measured on this
 * repo's own output, a bare-URL rule finds 7,795 hits for opensource.org alone -
 * Apache-2.0 licence headers the minifier preserves - plus phaser.io from the
 * engine's console banner and reactjs.org from a React error message. None of
 * them is a request. What makes a request is the CONTEXT a URL sits in, so that
 * is what is matched.
 *
 * Two exclusions are deliberate and load-bearing:
 *
 *   - `<a href>` is NOT a third-party request. An anchor fetches nothing until
 *     the user clicks it, and clicking it means the user chose to leave. This
 *     matters here because every remote reference in the current output is an
 *     anchor to the project's own GitHub repo; a rule without this exclusion
 *     would report 13 violations and the honest count is zero.
 *   - `xmlns` and `xmlns:xlink` are namespace IDENTIFIERS, never fetched. The
 *     w3.org strings in the output are all SVG namespaces.
 *
 * `<use href>` IS flagged despite looking like an anchor: SVG <use> does fetch a
 * remote document.
 */

/** Attributes that cause a fetch, by tag. A tag not listed here is ignored. */
const FETCHING = {
  script: ['src'],
  link: ['href'], // stylesheet, preload, preconnect, dns-prefetch, icon, manifest
  img: ['src', 'srcset'],
  image: ['href'], // SVG <image>
  iframe: ['src'],
  frame: ['src'],
  embed: ['src'],
  object: ['data'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  use: ['href', 'xlink:href'], // SVG <use> fetches
  input: ['src'],
};

/** A remote target: absolute http(s) or protocol-relative. */
const REMOTE = String.raw`(?:https?:)?//`;

/**
 * JS call shapes that issue a request with a literal remote target. Each entry
 * is a description plus a regex over minified JS.
 */
const JS_SHAPES = [
  ['fetch()', new RegExp(String.raw`\bfetch\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['new WebSocket()', new RegExp(String.raw`\bWebSocket\s*\(\s*["'\`]wss?://`, 'g')],
  ['new EventSource()', new RegExp(String.raw`\bEventSource\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['sendBeacon()', new RegExp(String.raw`\bsendBeacon\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['importScripts()', new RegExp(String.raw`\bimportScripts\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['new Worker()', new RegExp(String.raw`\bWorker\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['dynamic import()', new RegExp(String.raw`\bimport\s*\(\s*["'\`]${REMOTE}`, 'g')],
  ['XHR .open()', new RegExp(String.raw`\.open\s*\(\s*["'\`][A-Z]+["'\`]\s*,\s*["'\`]${REMOTE}`, 'g')],
  ['.src = remote', new RegExp(String.raw`\.src\s*=\s*["'\`]${REMOTE}`, 'g')],
  ['import from remote', new RegExp(String.raw`\bfrom\s*["'\`]${REMOTE}`, 'g')],
  /**
   * A STUN or TURN server is a third-party request per match, and it is invisible to every other rule here because
   * `stun:` is not an http(s) URL.
   *
   * Added when the WebRTC transport landed. That transport works with an EMPTY iceServers list -- host candidates
   * only, which is exactly what reaches another machine on the same local network and is the whole of what the games
   * claim. Adding a public STUN server is the obvious way to make connections succeed more often, and it would
   * quietly turn a zero-third-party game into one that pings someone else's infrastructure every time two people
   * play. This makes that a build failure rather than a decision nobody notices.
   */
  ['ICE server (stun:/turn:)', /["'`](?:stuns?|turns?):[^"'`\s]+/g],
];

/** CSS shapes that fetch. */
const CSS_SHAPES = [
  ['url() remote', new RegExp(String.raw`url\(\s*["']?${REMOTE}`, 'g')],
  ['@import remote', new RegExp(String.raw`@import\s+(?:url\(\s*)?["']?${REMOTE}`, 'g')],
];

/** Host of a remote target, for reporting. */
function hostOf(text) {
  const m = text.match(new RegExp(String.raw`(?:https?:)?//([^/"'\`)\s]+)`));
  return m ? m[1] : '(unknown)';
}

/** Line number of an index, 1-based. */
function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** Scan built HTML for fetching tags with a remote target. */
export function scanHtml(text, file) {
  const findings = [];
  const tagRe = /<\s*([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const wanted = FETCHING[tag];
    if (!wanted) continue;
    for (const attr of wanted) {
      const attrRe = new RegExp(
        String.raw`\b${attr.replace(':', '\\:')}\s*=\s*["']\s*(${REMOTE}[^"']*)["']`,
        'i',
      );
      const hit = attrs.match(attrRe);
      if (!hit) continue;
      findings.push({
        file,
        line: lineAt(text, m.index),
        kind: `<${tag} ${attr}>`,
        host: hostOf(hit[1]),
        target: hit[1].slice(0, 90),
      });
    }
  }

  // A meta refresh can navigate to a third party without any tag above.
  const metaRe = new RegExp(
    String.raw`<\s*meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*url\s*=\s*(${REMOTE}[^"'\s>]*)`,
    'gi',
  );
  while ((m = metaRe.exec(text)) !== null) {
    findings.push({
      file,
      line: lineAt(text, m.index),
      kind: '<meta http-equiv=refresh>',
      host: hostOf(m[1]),
      target: m[1].slice(0, 90),
    });
  }
  return findings;
}

/** Scan built JS or CSS for request-issuing shapes. */
export function scanCode(text, file, shapes) {
  const findings = [];
  for (const [kind, re] of shapes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Read the target out of the MATCH, then finish the literal from the text
      // that follows. A wide context slice was the first attempt and the built-in
      // selftest caught it: the slice ran past the end of the statement into the
      // next line, so a local url(./local.png) showed up inside the report of a
      // remote one and looked like a false positive.
      const rest = text.slice(m.index + m[0].length);
      const tail = rest.match(/^[^"'`)\s]*/);
      const started = m[0].match(/(?:https?:)?\/\/[^\s"'`)]*$|wss?:\/\/[^\s"'`)]*$/);
      const target = `${started ? started[0] : m[0]}${tail ? tail[0] : ''}`;
      findings.push({
        file,
        line: lineAt(text, m.index),
        kind,
        host: hostOf(target),
        target: target.slice(0, 90),
      });
    }
  }
  return findings;
}

export { JS_SHAPES, CSS_SHAPES };
