#!/usr/bin/env python3
# Dev server for the visualizer — SharedArrayBuffer (wasm threads) requires
# cross-origin isolation headers. Same story on Vercel via vercel.json.
#   python3 web/serve.py  →  http://localhost:8469
import http.server, functools, os

PORT = 8469
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("", PORT), H).serve_forever()
