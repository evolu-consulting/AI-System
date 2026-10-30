"""Wave 4 integration: central registration of the slices' kinds / codes / entities / settings, the
pipeline hooks, the server routes, and the regressions of the W4-A findings:

  (a) the builder fences before its state change and takes the change back when the fenced event is
      refused (no unit stuck "submitted" with nothing in flight)
  (b) a lost run lease (clock jumped past the TTL) pauses the run (run.paused, not terminal); resume goes on
      (test_chaos_clock.test_skew_forward)
  (c) Sandbox._registered compares real paths (Windows 8.3 short names)
  (d) merged units' worktrees are removed after the merge; failed units keep theirs (every dry e2e variant
      checks it: run_line_e2e.check_common)
  (e) the model-error path emits unit.state with unit.requeued
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.request
from unittest import mock

from line import agents_dir, codes, config, contracts, observe, rag_state, reconciler
from line import understand_plus as uplus
from line.codes import LineError
from line.contracts import E_RUN, E_UNIT, RunState, UnitState, unit_lease_name
from line.learn import SETTINGS as LEARN_SETTINGS
from line.review import _common as review_common
from line.store import SqliteStore
from line.tests.test_build_verify import GitCase, git, write


class RegistrationTests(unittest.TestCase):
    def test_kinds_codes_entities_registered(self) -> None:
        from line.learn import LEARN_KINDS
        from line.understand_plus._common import NEW_ENTITIES, NEW_EVENT_KINDS as UPLUS_KINDS
        for kinds in (reconciler.NEW_EVENT_KINDS, rag_state.NEW_EVENT_KINDS, UPLUS_KINDS,
                      review_common.NEW_EVENT_KINDS, LEARN_KINDS, agents_dir.AGENT_KINDS, (codes.RUN_PAUSED,)):
            self.assertTrue(set(kinds) <= codes.EVENT_KINDS, kinds)
        self.assertTrue(set(review_common.NEW_GATE_CODES) <= codes.ALL_CODES)
        self.assertTrue(set(NEW_ENTITIES) | {review_common.E_DECISION} <= contracts.ENTITIES)
        LineError(codes.REVIEW_BLOCK, "x")               # a code LineError accepts
        self.assertFalse(set(codes.W4_GATE_CODES) & set(codes.GATE_CODES))   # the plan's list is unchanged

    def test_settings_are_config_fields_with_the_slice_defaults(self) -> None:
        cfg = config.Config()
        from line.understand_plus._common import CONFIG_DEFAULTS
        want = {k: v for k, (v, _) in CONFIG_DEFAULTS.items()}
        want.update(review_common.DEFAULTS)
        want.update(LEARN_SETTINGS)
        want.update(agents_dir.AGENT_SETTINGS)
        want.update(observe.OBS_SETTINGS)
        want.update({"reconcile": False, "rag_leases": False, "rag_records": False})
        for k, v in want.items():
            self.assertTrue(hasattr(cfg, k), k)
            self.assertEqual(getattr(cfg, k), v, k)
        for flag in config.W4_FLAGS:                       # every feature off by default
            self.assertFalse(getattr(cfg, flag), flag)

    def test_env_names(self) -> None:
        from line.understand_plus._common import CONFIG_DEFAULTS
        for name, (_, var) in CONFIG_DEFAULTS.items():
            self.assertEqual(config.ENV_MAP.get(var), name, var)
        for var, name in review_common.ENV_NAMES.items():
            self.assertEqual(config.ENV_MAP.get(var), name, var)
        for name in list(LEARN_SETTINGS) + list(agents_dir.AGENT_SETTINGS) + list(observe.OBS_SETTINGS):
            self.assertEqual(config.ENV_MAP.get("LINE_" + name.upper()), name, name)
        for var in ("LINE_RECONCILE", "LINE_RAG_LEASES", "LINE_RAG_RECORDS", "LINE_LEARN", "LINE_AGENTS", "LINE_OBS"):
            self.assertIn(var, config.ENV_MAP)
        c = config.load_config(env={"LINE_UPLUS": "1", "LINE_REVIEW": "1", "LINE_LEARN": "1", "LINE_DRY_HUMAN": "auto",
                                    "LINE_RAG_RECORDS": "1"}, line_json=None, rag_local_json=None)
        self.assertEqual((c.uplus_enabled, c.review_enabled, c.learn_enabled, c.dry_human, c.rag_records),
                         (True, True, True, "auto", True))

    def test_manifest_has_the_new_kinds_and_series(self) -> None:
        from line.rag import manifest
        doc = manifest.build()
        types = {t["type"]: t["kind_of"] for t in doc["types"]}
        self.assertEqual(types.get(codes.RUN_PARKED), "event")
        self.assertEqual(types.get("rules_graph"), "record")
        self.assertEqual(types.get("line.first_pass_yield"), "metric")


class BuilderFenceTests(GitCase):
    """(a) and (e)."""

    def _expire_on(self, to_state: str):
        real = self.f.store.transition

        def transition(entity, id, to, expect_from):
            row = real(entity, id, to, expect_from)
            if entity == E_UNIT and getattr(to, "value", to) == to_state:
                self.f.clock.advance(self.cfg.lease_ttl_s + 1)      # the lease runs out right here
            return row
        return mock.patch.object(self.f.store, "transition", side_effect=transition)

    def _check_taken_back(self, frm: str) -> None:
        self.assertEqual(self.state(), "ready")
        evs = self.f.store.events_after(0)
        st = [e.body for e in evs if e.kind == codes.UNIT_STATE]
        self.assertIn({"from": frm, "to": "ready", "code": codes.LEASE_LOST}, st)
        rq = [e.body for e in evs if e.kind == codes.UNIT_REQUEUED]
        self.assertEqual(rq[-1]["why"], "fenced event refused")
        self.assertEqual(self.f.store.get("attempt", "U1#1")["outcome"], "lost")

    def test_submit_refused_is_taken_back(self) -> None:
        with self._expire_on("submitted"):
            res, g = self.attempt({"files": {"todo/store.py": "def add(x):\n    return x + 1\n"}})
        self.assertEqual((res.outcome, res.code), ("LOST", codes.LEASE_LOST))
        self.assertNotIn(codes.UNIT_SUBMITTED, self.kinds())
        self._check_taken_back("submitted")

    def test_blocked_refused_is_taken_back(self) -> None:
        with self._expire_on("waiting"):
            res, _ = self.attempt("BLOCKED:need the storage contract")
        self.assertEqual(res.outcome, "LOST")
        self.assertNotIn(codes.UNIT_BLOCKED, self.kinds())
        self._check_taken_back("waiting")

    def test_fence_checked_before_the_state_change(self) -> None:
        def late(role, prompt, **kw):
            self.f.clock.advance(self.cfg.lease_ttl_s + 1)          # expired, nobody else took it
            return "SUBMIT"
        res, _ = self.attempt(late)
        self.assertEqual(res.outcome, "LOST")
        self.assertEqual(self.state(), "leased")                     # untouched: watchdog / pipeline requeue it
        self.assertNotIn(codes.UNIT_SUBMITTED, self.kinds())

    def test_model_error_emits_unit_state_and_requeued(self) -> None:
        res, _ = self.attempt(LineError(codes.LLM_ERROR, "boom"))
        self.assertEqual(res.outcome, "ERROR")
        evs = self.f.store.events_after(0)
        i = [n for n, e in enumerate(evs) if e.kind == codes.UNIT_STATE and e.body.get("to") == "ready"]
        j = [n for n, e in enumerate(evs) if e.kind == codes.UNIT_REQUEUED]
        self.assertTrue(i and j and i[-1] < j[-1], [e.kind for e in evs])
        self.assertEqual(evs[i[-1]].body, {"from": "leased", "to": "ready", "code": codes.LLM_ERROR})


@unittest.skipUnless(sys.platform == "win32", "8.3 short names are a Windows thing")
class ShortPathTests(GitCase):
    """(c) git prints long paths; a workroot given in 8.3 form must still match."""

    def test_registered_with_short_path(self) -> None:
        import ctypes
        from line.build.sandbox import Sandbox
        long_root = os.path.join(self.tmp, "a-long-workroot-name")
        os.makedirs(long_root)
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(long_root, buf, 1024)
        short = buf.value if n else ""
        if not short or os.path.normcase(short) == os.path.normcase(long_root):
            self.skipTest("8.3 names are disabled on this volume")
        sb = Sandbox(self.repo, short)
        path = sb.create(self.unit)
        self.assertTrue(path.startswith(short))
        self.assertTrue(sb._registered(path))
        self.assertEqual(sb.create(self.unit), path)                # reused, not re-created
        sb.cleanup(self.unit, delete_branch=True)
        self.assertNotIn("a-long-workroot-name", git(self.repo, "worktree", "list"))


class ServerRouteTests(unittest.TestCase):
    """GET /api/runs/{id}/questions, POST /api/runs/{id}/answers (resume), GET /api/metrics, board panel."""

    def setUp(self) -> None:
        from line.server import LineServer
        from line.tests.test_uplus_support import cfg as ucfg, line_of, make_pack
        from line.understand_plus import human
        self.st = SqliteStore(":memory:")
        pv, heads = make_pack()
        self.st.put(contracts.E_PACK, pv.version, contracts.to_dict(pv))
        self.st.put(E_RUN, "r1", {"id": "r1", "pack_path": "", "state": "understanding", "spec_hash": pv.version,
                                  "detail": {}, "created_ms": 1})
        sp = heads["F1"]
        d = {"kind": "assumption", "decision": "Who may cancel?", "recommended": "a", "f_items": ["F1"], "refs": [],
             "options": [{"id": "a", "text": "Anyone", "impact": "x"}, {"id": "b", "text": "Admins", "impact": "y"}],
             "evidence": [{"span_id": sp.id, "quote": line_of(sp, "credit")}]}
        c = ucfg()
        r = human.ask_round(self.st, "r1", [d], cfg=c, pack_version=pv.version)
        human.park(self.st, "r1", f_items=["F1"], questions=r["asked"], pack_version=pv.version, cfg=c)
        self.calls = []
        self.srv = LineServer(self.st, config.load_config(env={}, line_json=None, rag_local_json=None),
                              driver=lambda a, p: self.calls.append((a, p)) or {"run": p.get("run"), "resuming": True},
                              port=0).start()

    def tearDown(self) -> None:
        self.srv.stop()
        self.st.close()

    def _req(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.srv.url + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_questions_answers_resume(self) -> None:
        st, q = self._req("GET", "/api/runs/r1/questions")
        self.assertEqual(st, 200)
        self.assertTrue(q["parked"])
        self.assertEqual([x["state"] for x in q["questions"]], ["open"])
        st, b = self._req("GET", "/api/board?run=r1")
        self.assertTrue(b["human"]["parked"])
        self.assertEqual(len(b["human"]["questions"]), 1)
        st, out = self._req("POST", "/api/runs/r1/answers", {"qid": "Q1", "option": "zzz", "who": "po"})
        self.assertEqual(st, 400)
        self.assertEqual(self.calls, [])
        st, out = self._req("POST", "/api/runs/r1/answers", {"qid": "Q1", "option": "b", "who": "po"})
        self.assertEqual(st, 200, out)
        self.assertTrue(out["resume"])
        self.assertEqual(out["addendum"], "v1.1")
        self.assertEqual(self.calls, [("resume", {"run": "r1"})])
        self.assertEqual(out["resumed"], {"run": "r1", "resuming": True})
        st, _ = self._req("GET", "/api/runs/nope/questions")
        self.assertEqual(st, 404)

    def test_metrics(self) -> None:
        st, m = self._req("GET", "/api/metrics?run=r1")
        self.assertEqual(st, 200)
        self.assertEqual(m["spec"], observe.SPEC_VERSION)
        self.assertEqual(m["runs"][0]["run"], "r1")


class OffByDefaultTests(unittest.TestCase):
    def test_hooks_are_noops_with_a_default_config(self) -> None:
        import types
        cfg = config.load_config(env={}, line_json=None, rag_local_json=None)
        ctx = types.SimpleNamespace(cfg=cfg, store=None, sstore=None, run="r", llm=None, rag=None)
        self.assertFalse(uplus.enabled(cfg))
        self.assertEqual(uplus.on_tick(ctx), [])
        self.assertIsNone(reconciler.on_server_start(None, cfg))
        self.assertEqual(observe.on_run_end(ctx, "r"), {})
        self.assertEqual(agents_dir.on_run_end(ctx, "r"), {})
        from line.learn import hooks
        self.assertEqual(hooks.on_prompt(ctx, "builder", "build", "r"), "")


if __name__ == "__main__":
    unittest.main()
