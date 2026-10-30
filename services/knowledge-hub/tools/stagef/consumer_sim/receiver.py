"""Webhook receiver for the consumer simulator (stdlib only).

It runs INSIDE the KH dev container (docker exec), listening on 127.0.0.1, because the KH SSRF guard allows
plain http only to 127.0.0.1 (KH_OUTBOX_ALLOW_LOCAL=1) and refuses private addresses such as the Docker host.
Every POST is appended as one JSON line {ts, path, headers, body_b64}; GET /quit stops it.

    python receiver.py <port> <out.jsonl>
"""
import base64
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18099
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sim_recv.jsonl"
LOCK = threading.Lock()


class H(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        rec = {"ts": time.time(), "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()},
               "body_b64": base64.b64encode(body).decode()}
        with LOCK, open(OUT, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")
        if self.path.startswith("/quit"):
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    def log_message(self, *a):
        pass


open(OUT, "w").close()
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
