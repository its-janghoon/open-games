#!/usr/bin/env python3
"""Clear network emulation on a CDP browser.

    cdp_online.py <debug_port>

A probe killed before its restore step leaves the shared browser stuck offline, and
every later page load then looks broken for the wrong reason. This puts it back.
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


async def main() -> None:
    port = int(sys.argv[1])
    async with websockets.connect(ws_url(port), max_size=16 * 1024 * 1024) as ws:
        for i, (method, params) in enumerate(
            [
                ("Network.enable", {}),
                (
                    "Network.emulateNetworkConditions",
                    {
                        "offline": False,
                        "latency": 0,
                        "downloadThroughput": -1,
                        "uploadThroughput": -1,
                    },
                ),
                ("Network.setCacheDisabled", {"cacheDisabled": False}),
            ],
            start=1,
        ):
            await ws.send(json.dumps({"id": i, "method": method, "params": params}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == i:
                    break
    print("network emulation cleared")


asyncio.run(main())
