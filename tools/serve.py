#!/usr/bin/env python3
"""Taiao local server — http.server plus correct cache headers.

Plain `python3 -m http.server` sends no Cache-Control at all, so browsers
apply HEURISTIC freshness (~10% of a file's age since last-modified) and can
serve a stale dist/bundle.js for hours after a rebuild — edits "don't appear".
This wrapper keeps everything else identical but:

  * code & markup (js/css/html, /dist/, /assets/sheet-src/…) -> no-cache
    (always revalidate; If-Modified-Since still gets a cheap 304)
  * immutable assets -> long cache, SAME list as sw.js CACHE_FIRST
    (/assets/sheets/ is content-hashed; sfx/fonts/libs never change in place)

Run from the repo root (Start Our RPG.command does):  python3 tools/serve.py [port]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

IMMUTABLE_PREFIXES = ("/assets/sheets/", "/assets/sfx/", "/fonts/", "/libs/")


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split("?")[0]
        if path.startswith(IMMUTABLE_PREFIXES):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the launcher quiet, like `nohup http.server >/dev/null`


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    ThreadingHTTPServer(("", port), partial(Handler)).serve_forever()
