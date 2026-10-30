"""Feature migration: its own budget (total + per repository scan + the build run), resuming after the cap is
raised, the board's read routes and :resume, the board page, and the long-wait helper (dlc_flow.ps1 migwait /
migresume) against a stub line server. Dry: fake / stub models that report a cost per call."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
import urllib.request
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

from line import codes
from line.codes import LineError
from line.config import LINE_DIR, load_config
from line.contracts import E_ESCALATION, E_MIGRATION, E_RUN
from line.e2e.migrate_estate import make_estate
from line.e2e.migrate_pair import make_pair
from line.migrate import Migrator, details, report_text, summary
from line.migrate import budget as budget_mod
from line.migrate import scan as scan_mod
from line.server import LineServer
from line.statemachine import update_row
from line.store import SqliteStore


def _cfg(work, **kw):
    return load_config(env={}, line_json=None, rag_local_json=None, llm="fake", dry_pack="migrate-pair",
                       workroot=os.path.join(work, "work"), db=os.path.join(work, "line.db"), deploy_windows=[], **kw)


class Costly:
    """Any model port, with every answer costing ``usd``."""

    def __init__(self, inner, usd=1.0):
        self.inner, self.usd, self.calls = inner, usd, []

    def complete(self, role, prompt, schema=None, **kw):
        self.calls.append((role, kw.get("key", "")))
        res = self.inner.complete(role, prompt, schema, **kw)
        try:
            res.usd = self.usd
        except AttributeError:
            res = SimpleNamespace(data=getattr(res, "data", None), usd=self.usd)
        return res


class StubLlm:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.calls.append((role, key))
        return SimpleNamespace(data=self.answers.get(role), usd=0.5)


class Base(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="mig-budget-")
        self.cfg = _cfg(self.work)
        self.store = SqliteStore(self.cfg.db)

    def tearDown(self):
        self.store.close()
        shutil.rmtree(self.work, ignore_errors=True)

    def _kinds(self, mid, kind):
        return [e for e in self.store.events_after(0, run=mid, limit=10000) if e.kind == kind]


class BudgetUnitTests(Base):
    def _row(self, mid="M1"):
        self.store.put(E_MIGRATION, mid, {"id": mid, "state": "admitted", "spent_usd": 0.0, "repo_usd": {}}, run=mid)
        return mid

    def test_total_and_repo_caps_and_warn_once(self):
        mid = self._row()
        fired = []
        b = budget_mod.MigrationBudget(self.store, mid, limit=10.0, limit_repo=2.0, warn_ratio=0.8,
                                       emit=lambda k, body: fired.append((k, body["node"])))
        b.check("v1.a")
        b.charge(1.7, "v1.a")                       # repository crosses 80% of 2.0
        b.charge(0.2, "v1.a")                       # warned already: not again
        self.assertEqual(fired, [(codes.BUDGET_WARN, "M1:v1.a")])
        b.charge(0.5, "v1.a")
        with self.assertRaises(LineError) as cm:
            b.check("v1.a")
        self.assertEqual((cm.exception.code, cm.exception.detail["scope"]), (codes.MIGRATION_BUDGET, "repo"))
        b.check("v1.b")                             # another repository still has its share
        b.charge(8.0)                               # total 10.4 of 10.0
        self.assertIn((codes.BUDGET_WARN, "M1"), fired)
        with self.assertRaises(LineError) as cm:
            b.check()
        self.assertEqual(cm.exception.detail["scope"], "total")
        self.assertAlmostEqual(b.spent(), 10.4)
        self.assertAlmostEqual(b.repo_spent("v1.a"), 2.4)
        self.assertTrue(budget_mod.is_budget_text("LineError: " + str(cm.exception)))

    def test_budgeted_llm_gates_before_and_charges_after(self):
        mid = self._row()
        b = budget_mod.MigrationBudget(self.store, mid, limit=1.0)
        inner = StubLlm({"r": {"x": 1}})
        llm = budget_mod.BudgetedLlm(inner, lambda run: b if run == mid else None)
        llm.complete("r", "p", None, key="k", run=mid)
        llm.complete("r", "p", None, key="k", run="other-run")   # not a migration: not charged
        self.assertAlmostEqual(b.spent(), 0.5)
        llm.complete("r", "p", None, key="k", run=mid)
        with self.assertRaises(LineError):
            llm.complete("r", "p", None, key="k", run=mid)
        self.assertEqual(len(inner.calls), 3)                   # the refused call never reached the model


class RunnerBudgetTests(Base):
    def test_total_cap_stops_resumes_after_raise(self):
        pair = make_pair(os.path.join(self.work, "pair"))
        import dataclasses
        from line.llm import make_llm
        llm = Costly(make_llm(dataclasses.replace(self.cfg, max_usd_run=0.0), self.store), usd=1.0)
        m = Migrator(self.store, self.cfg, llm=llm)
        mid = m.admit(dict(pair, mode="decide", build=False, max_usd=2))
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("escalated", codes.MIGRATION_BUDGET))
        self.assertEqual(row["detail"]["resume_state"], "inventoried")     # both inventories done, match refused
        self.assertAlmostEqual(row["spent_usd"], 2.0)
        self.assertTrue(self._kinds(mid, codes.BUDGET_WARN))
        s = summary(self.store, row)
        self.assertEqual((s["budget"]["limit"], s["budget"]["spent"]), (2.0, 2.0))
        with self.assertRaises(LineError) as cm:                          # not raised yet: refused
            m.reopen(mid)
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        res = m.reopen(mid, max_usd=50)
        self.assertEqual(res, {"migration": mid, "state": "inventoried", "resuming": True})
        n_before = len(llm.calls)
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("analysed", ""))
        self.assertFalse(any(r == "migrate_inventory" for r, _ in llm.calls[n_before:]))   # not scanned again
        rep = report_text(self.store, mid)["report"]
        self.assertIn("| cost | $", rep)
        self.assertIn("of $50.00 (migration)", rep)

    def test_repo_cap_stops_the_scan_and_rescan_keeps_cached_repos(self):
        est = make_estate(os.path.join(self.work, "est"))
        llm = StubLlm({"migrate_inventory": {"features": []}, "migrate_match": {"pairs": []}})
        m = Migrator(self.store, self.cfg, llm=llm)
        mid = m.admit({"v1": est["v1"], "v2": est["v2"], "mode": "decide", "build": False, "max_usd_repo": 3})
        over = "v1." + scan_mod.slug("shop_srv_export")
        update_row(self.store, E_MIGRATION, mid, {"repo_usd": {over: 9.0}})
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("escalated", codes.MIGRATION_BUDGET))
        self.assertEqual((row["detail"]["scope"], row["detail"]["repos"]), ("repo", ["shop_srv_export"]))
        self.assertEqual(row["detail"]["resume_state"], "admitted")
        self.assertNotIn(over, [k for _, k in llm.calls])                # refused before the model was called
        with self.assertRaises(LineError):
            m.reopen(mid)                                                 # the per repository cap must go up
        self.assertEqual(m.reopen(mid, max_usd_repo=20)["state"], "admitted")
        row = m.drive(mid)
        self.assertEqual(row["state"], "analysed")
        keys = [k for _, k in llm.calls]
        self.assertEqual(keys.count("v1." + scan_mod.slug("shop_db_order")), 1)    # cached from the first pass
        self.assertEqual(keys.count(over), 1)
        d = details(self.store, mid)
        self.assertEqual(sorted(r["repo"] for r in d["repos"]["v1"]), sorted(["shop_db_order", "shop_srv_order",
                                                                           "shop_srv_export"]))
        self.assertIn("Cost USD", report_text(self.store, mid)["report"])

    def test_build_run_gets_what_is_left(self):
        seen = []
        m = Migrator(self.store, self.cfg, pipeline_factory=lambda c: seen.append(c.max_usd_run) or "p")
        self.assertEqual(m._pipeline(4.25), "p")
        self.assertEqual(seen, [4.25])
        m2 = Migrator(self.store, self.cfg, pipeline_factory=lambda: "old")           # factories without a cfg
        self.assertEqual(m2._pipeline(1.0), "old")

    def test_build_run_over_budget_resumes_at_decided(self):
        pair = make_pair(os.path.join(self.work, "pair"))
        m = Migrator(self.store, self.cfg, llm=StubLlm({"migrate_inventory": {"features": []},
                                                         "migrate_match": {"pairs": []}}))
        mid = m.admit(dict(pair, mode="decide"))
        self.store.put(E_RUN, "R-child", {"id": "R-child", "state": "escalated"}, run="R-child")
        self.store.put(E_ESCALATION, "R-child:1", {"run": "R-child", "code": codes.BUDGET_EXCEEDED}, run="R-child")
        update_row(self.store, E_MIGRATION, mid, {"state": "building", "run": "R-child", "run_ids": ["R-child"]})
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("escalated", codes.MIGRATION_BUDGET))
        self.assertEqual((row["detail"]["scope"], row["detail"]["resume_state"]), ("build", "decided"))


class RouteTests(Base):
    def test_details_report_and_resume_routes(self):
        pair = make_pair(os.path.join(self.work, "pair"))
        m = Migrator(self.store, self.cfg)
        mid = m.admit(dict(pair, mode="decide", build=False))
        m.drive(mid)
        calls = []

        def driver(action, payload):
            calls.append((action, payload))
            return {"migration": payload.get("migration"), "state": "admitted", "resuming": True}

        srv = LineServer(self.store, self.cfg, driver=driver, host="127.0.0.1", port=0).start()
        self.addCleanup(srv.stop)

        def get(path):
            with urllib.request.urlopen(srv.url + path, timeout=10) as r:
                return json.loads(r.read())

        d = get("/api/migrations/%s/details" % mid)
        self.assertTrue({"repos", "blast", "effort", "decisions", "evidence", "timeline", "baseline"} <= set(d))
        self.assertTrue(d["decisions"])                                  # decide mode logged its choice
        self.assertTrue(any(f["quotes"] for f in d["evidence"].values()))
        rep = get("/api/migrations/%s/report" % mid)
        self.assertTrue(rep["ready"] and rep["report"].startswith("# Feature migration"))
        lst = get("/api/migrations")["migrations"]
        self.assertIn("budget", lst[0])
        req = urllib.request.Request(srv.url + "/api/migrations/%s:resume" % mid, method="POST",
                                     data=json.dumps({"max_usd": 80, "rescan": True}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(calls, [("migrate_resume", {"migration": mid, "max_usd": 80, "max_usd_repo": None,
                                                     "rescan": True})])
        with self.assertRaises(urllib.error.HTTPError) as cm:
            get("/api/migrations/NOPE/details")
        self.assertEqual(cm.exception.code, 404)


class BoardTests(unittest.TestCase):
    def test_board_page_parses_and_uses_the_migration_routes(self):
        with open(os.path.join(LINE_DIR, "board.html"), encoding="utf-8") as fh:
            html = fh.read()

        class P(HTMLParser):
            ids, scripts = set(), []

            def handle_starttag(self, tag, attrs):
                a = dict(attrs)
                if a.get("id"):
                    self.ids.add(a["id"])

            def handle_data(self, data):
                if self.lasttag == "script":
                    self.scripts.append(data)

        p = P()
        p.feed(html)
        js = "".join(p.scripts)
        for route in ("/api/migrations", "/details", "/report", ":resume", "/answers", "/api/board"):
            self.assertIn(route, js)
        for el in ("migView", "runsView", "mMatrix", "mRepos", "mAsk", "mBudgetBox", "mReport", "tabMig"):
            self.assertIn(el, p.ids)
        self.assertNotRegex(html, r'<(script|link)[^>]+(src|href)="https?:')     # no external assets


# ------------------------------------------------------------------ dlc_flow.ps1 waits (stub line server)

PWSH = shutil.which("pwsh")
SCRIPT = os.path.join(LINE_DIR, "tools", "dlc_flow.ps1")


class _Stub(BaseHTTPRequestHandler):
    states: list = []
    posts: list = []

    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        st = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        self._send(200, st)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.posts.append((self.path, json.loads(self.rfile.read(n) or b"{}")))
        self._send(200, {"migration": "M1", "state": "admitted", "resuming": True})


def _mig(state, code="", questions=None, message=""):
    return {"migration": {"id": "M1", "state": state, "code": code, "message": message, "run": "",
                          "report": "", "budget": {"spent": 1.5}},
            "questions": questions or []}


@unittest.skipUnless(PWSH, "pwsh not installed")
class WaitHelperTests(unittest.TestCase):
    def setUp(self):
        _Stub.states, _Stub.posts = [], []
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.shutdown)
        self.url = "http://127.0.0.1:%d" % self.httpd.server_address[1]

    def run_mode(self, mode, **env):
        e = dict(os.environ, DLC_LINE_URL=self.url, DLC_MIGRATION="M1", DLC_POLL_S="0.05", DLC_POLL_MAX_S="0.1",
                 DLC_WAIT_HOURS="0.01")
        e.update(env)
        p = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", SCRIPT, "-Mode", mode], env=e,
                           capture_output=True, text=True, timeout=120)
        return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])

    def test_parked_ends_at_once_with_questions_and_board(self):
        q = [{"conflict": "C1", "feature": "Order total", "text": "differ",
              "options": [{"id": "v2"}, {"id": "v1"}]}]
        _Stub.states = [_mig("admitted"), _mig("matched"), _mig("parked", questions=q)]
        rc, out = self.run_mode("migwait")
        self.assertEqual(rc, 3)
        self.assertTrue(out["done"] and out["parked"])
        self.assertIn("C1 Order total: v2 | v1", out["summary"])
        self.assertTrue(out["board"].endswith("/?migration=M1"))
        self.assertIn("migration=M1", out["next"])

    def test_budget_stop_is_a_failure_with_how_to_continue(self):
        _Stub.states = [_mig("escalated", codes.MIGRATION_BUDGET, message="used its budget")]
        rc, out = self.run_mode("migwait")
        self.assertEqual(rc, 4)
        self.assertNotIn("done", out)                      # a workflow requiring 'done' ends as a failure
        self.assertEqual(out["code"], codes.MIGRATION_BUDGET)
        self.assertIn(":resume", out["next"])

    def test_migresume_posts_then_waits_to_green(self):
        _Stub.states = [_mig("inventoried"), _mig("green")]
        rc, out = self.run_mode("migresume", DLC_MAX_USD="80", DLC_RESCAN="true")
        self.assertEqual((rc, out["state"], out.get("done")), (0, "green", True))
        self.assertEqual(_Stub.posts, [("/api/migrations/M1:resume", {"max_usd": 80.0, "rescan": True})])

    def test_time_limit_is_exit_5_not_done(self):
        _Stub.states = [_mig("building")]
        rc, out = self.run_mode("migwait", DLC_WAIT_HOURS="0.0002")
        self.assertEqual(rc, 5)
        self.assertNotIn("done", out)
        self.assertIn("keep waiting", out["next"])


if __name__ == "__main__":
    unittest.main()
