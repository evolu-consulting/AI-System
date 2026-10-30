"""The published route table (line.api_spec) is the served API: every route answers, nothing else under /api
does, every server route pattern is listed, the OpenAPI document covers every route, CORS follows the allowlist."""

from __future__ import annotations

import json
import os
import re
import unittest
import urllib.error
import urllib.request

from line import api_spec, server
from line.config import load_config
from line.server import LineServer
from line.tests.fakes import make_fakes

SAMPLE = {"run": "R1", "migration": "M1", "subject": "R1:U1%231", "node": "build", "report": "gen-implement", "project": "p1",
          "entry": "1", "tool": "search_knowledge", "hook": "1", "event": "after_plan", "gate": "spec",
          "process": "gated-change", "form": "F1"}


def fill(template: str) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: SAMPLE[m.group(1)], template)


def call(url: str, method: str = "GET", body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=dict(headers or {}, **(
        {"Content-Type": "application/json"} if data is not None else {})))
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


class ApiSpecTest(unittest.TestCase):
    def start(self, origins=""):
        old = os.environ.get("LINE_CORS_ORIGINS")
        os.environ["LINE_CORS_ORIGINS"] = origins
        try:
            self.srv = LineServer(make_fakes().store, load_config(env={}, line_json=None, rag_local_json=None),
                                  host="127.0.0.1", port=0).start()
        finally:
            if old is None:
                os.environ.pop("LINE_CORS_ORIGINS", None)
            else:
                os.environ["LINE_CORS_ORIGINS"] = old
        self.addCleanup(self.srv.stop)
        return self.srv.url

    def test_every_listed_route_is_served(self):
        url = self.start()
        for r in api_spec.ROUTES:
            st, _, raw = call(url + fill(r.template), r.method, {} if r.method == "POST" else None)
            text = raw.decode("utf-8", "replace")
            self.assertFalse(st == 404 and "no route" in text, "%s %s not served: %s" % (r.method, r.template, text))

    def test_unlisted_api_path_is_404(self):
        url = self.start()
        st, _, raw = call(url + "/api/nope")
        self.assertEqual(st, 404)
        self.assertIn("no route", raw.decode())
        st, _, raw = call(url + "/api/runs/R1:explode", "POST", {})
        self.assertEqual(st, 404)

    def test_every_server_pattern_is_in_the_table(self):
        with open(server.__file__, encoding="utf-8") as fh:
            src = fh.read()
        literals = set(re.findall(r'path == "(/api/[^"]+)"', src))
        templates = {r.template for r in api_spec.ROUTES}
        self.assertTrue(literals <= templates, literals - templates)
        for name in [n for n in dir(server) if n.startswith("_RE_")]:
            rx = getattr(server, name)
            self.assertTrue(any(rx.match(fill(r.template)) for r in api_spec.ROUTES), name)

    def test_openapi_covers_every_route(self):
        url = self.start()
        st, _, raw = call(url + "/api/openapi.json")
        self.assertEqual(st, 200)
        doc = json.loads(raw)
        self.assertTrue(doc["openapi"].startswith("3."))
        for r in api_spec.ROUTES:
            self.assertIn(r.method.lower(), doc["paths"][r.template], r.template)
            op = doc["paths"][r.template][r.method.lower()]
            self.assertIn(str(r.status), op["responses"])
            if r.body is not None:
                self.assertIn("requestBody", op)
        self.assertEqual(len({(m, p) for p, ops in doc["paths"].items() for m in ops}), len(api_spec.ROUTES))

    def test_cors_allowlist(self):
        url = self.start("https://fe.example.com")
        _, h, _ = call(url + "/api/health", headers={"Origin": "https://fe.example.com"})
        self.assertEqual(h.get("Access-Control-Allow-Origin"), "https://fe.example.com")
        _, h, _ = call(url + "/api/health", headers={"Origin": "https://evil.example.com"})
        self.assertIsNone(h.get("Access-Control-Allow-Origin"))
        st, h, _ = call(url + "/api/runs", "OPTIONS", headers={"Origin": "https://fe.example.com"})
        self.assertEqual(st, 204)
        st, _, _ = call(url + "/api/runs", "OPTIONS", headers={"Origin": "https://evil.example.com"})
        self.assertEqual(st, 403)

    def test_no_cors_by_default(self):
        url = self.start("")
        _, h, _ = call(url + "/api/health", headers={"Origin": "https://fe.example.com"})
        self.assertIsNone(h.get("Access-Control-Allow-Origin"))

    def test_create_pack(self):
        import tempfile
        home = tempfile.mkdtemp(prefix="dlc-packs-")
        old = os.environ.get("DLC_HOME")
        os.environ["DLC_HOME"] = home
        try:
            url = self.start()
            st, _, raw = call(url + "/api/packs", "POST", {"kind": "new", "name": "Demo App",
                                                          "spec": "# Demo\n\n## F1 x"})
            self.assertEqual(st, 201, raw)
            pack = json.loads(raw)["pack"]
            self.assertTrue(pack.startswith(home))
            with open(os.path.join(pack, "spec.md"), encoding="utf-8") as fh:
                self.assertIn("## F1 x", fh.read())
            st, _, raw = call(url + "/api/packs", "POST", {"kind": "bug", "title": "t", "repro": "r", "expected": "e",
                                                          "actual": "a"})
            self.assertEqual(st, 201, raw)
            with open(os.path.join(json.loads(raw)["pack"], "spec.md"), encoding="utf-8") as fh:
                self.assertIn("## F1 t", fh.read())
            st, _, raw = call(url + "/api/packs", "POST", {"kind": "bug", "title": "t"})
            self.assertEqual(st, 400)
            # free text: what happened, a ticket link, attached notes; the agents work out the rest
            st, _, raw = call(url + "/api/packs", "POST", {"kind": "bug", "report": "List crashes on empty filter\n"
                                                                                     "https://jira.example.com/browse/CS-1"})
            self.assertEqual(st, 201, raw)
            out = json.loads(raw)
            self.assertEqual((out["kind"], out["name"]), ("bug", "List crashes on empty filter"))
            with open(os.path.join(out["pack"], "spec.md"), encoding="utf-8") as fh:
                text = fh.read()
            self.assertIn("browse/CS-1", text)
            self.assertIn("## F1", text)
            st, _, raw = call(url + "/api/packs", "POST", {"kind": "bug", "report": "  "})
            self.assertEqual(st, 400)
            st, _, _ = call(url + "/api/packs", "POST", {"kind": "new", "name": "x"})
            self.assertEqual(st, 400)
        finally:
            if old is None:
                os.environ.pop("DLC_HOME", None)
            else:
                os.environ["DLC_HOME"] = old


if __name__ == "__main__":
    unittest.main()
