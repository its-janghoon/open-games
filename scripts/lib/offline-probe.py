#!/usr/bin/env python3
"""Measure whether a built game survives losing the network.

    offline_probe.py <debug_port> <url> [settle_ms]

Loads the URL, waits for it to be interactive, records what it fetched, then sets
Network.emulateNetworkConditions offline=true, reloads, and reports whether the
game still reaches a running state. Prints JSON.

Uses CDP directly because playwright is not installed on this host.
"""
import asyncio
import json
import sys
import urllib.request

import websockets


def ws_url(port: int) -> str:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=10) as fh:
        targets = json.load(fh)
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    if not pages:
        raise SystemExit("no page target with a debugger URL")
    return pages[0]["webSocketDebuggerUrl"]


READY_JS = """
(() => {
  const g = window.__GAME__;
  const canvas = document.querySelector('canvas');
  const scenes = g && g.scene ? g.scene.getScenes(true).map(s => s.scene.key) : [];
  return {
    hasGame: !!g,
    hasCanvas: !!canvas,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    activeScenes: scenes,
    running: !!(g && g.isRunning),
    domText: (document.body.innerText || '').slice(0, 120),
  };
})()
"""


async def main() -> None:
    port = int(sys.argv[1])
    url = sys.argv[2]
    settle = int(sys.argv[3]) if len(sys.argv) > 3 else 9000

    counter = 0
    async with websockets.connect(ws_url(port), max_size=64 * 1024 * 1024) as ws:

        async def send(method, params=None, wait=True):
            nonlocal counter
            counter += 1
            mid = counter
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            if not wait:
                return None
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == mid:
                    return msg

        async def evaluate(expr):
            res = await send(
                "Runtime.evaluate",
                {"expression": expr, "returnByValue": True, "awaitPromise": True},
            )
            return (res or {}).get("result", {}).get("result", {}).get("value")

        await send("Network.enable")
        await send("Page.enable")
        await send("Runtime.enable")

        report = {"url": url}

        # --- pass 1: online, warm the cache -------------------------------
        # Navigate away first. Re-navigating to the SAME url while the tab sits on
        # Chrome's network-error page for that url does not reliably refetch, which
        # made an earlier version of this probe report the error page during its
        # ONLINE pass and look like a broken game.
        await send("Page.navigate", {"url": "about:blank"})
        await asyncio.sleep(0.7)
        await send("Network.setCacheDisabled", {"cacheDisabled": False})
        await send("Page.navigate", {"url": url})
        await asyncio.sleep(settle / 1000)
        report["online"] = await evaluate(READY_JS)

        # Collect the requests the page made, so the static half of the gate can be
        # checked against what the browser really asks for.
        requests = await evaluate(
            "(performance.getEntriesByType('resource')||[]).map(e => e.name)"
        )
        report["requests"] = requests or []

        # --- pass 2: network denied, reload --------------------------------
        await send(
            "Network.emulateNetworkConditions",
            {
                "offline": True,
                "latency": 0,
                "downloadThroughput": 0,
                "uploadThroughput": 0,
            },
        )
        await send("Page.reload", {"ignoreCache": False})
        await asyncio.sleep(settle / 1000)
        report["offline"] = await evaluate(READY_JS)

        # Restore, so the shared browser is not left offline for the next user.
        await send(
            "Network.emulateNetworkConditions",
            {"offline": False, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1},
        )

        print(json.dumps(report, ensure_ascii=False, indent=2))


asyncio.run(main())
