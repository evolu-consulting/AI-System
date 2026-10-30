"""The PM plan (WBS schedule), titled sign-offs, the change-request signature chain, the cost of
re-opening signed-off work and environment promotion.

  python -m unittest discover -s tests
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["SDLC_DB"] = os.path.join(tempfile.mkdtemp(), "plan.db")

import db  # noqa: E402
import engine  # noqa: E402
import gov  # noqa: E402
import kh  # noqa: E402
import plan  # noqa: E402
import seed  # noqa: E402

for name in ("add_log", "add_knowledge", "message", "ensure_project"):
    setattr(kh, name, lambda *a, **k: None)
kh.recent = lambda *a, **k: []
engine.wake = lambda pid: None


class PlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()
        seed.seed()

    def setUp(self):
        self.p = db.create_project("Plan %s" % id(self), tempfile.mkdtemp(), owner="lucas")

    def test_working_days_dependencies_and_holidays(self):
        a = plan.add(self.p["id"], {"title": "A", "durationDays": 5, "pinnedStart": "2026-12-14"})  # Mon
        b = plan.add(self.p["id"], {"title": "B", "durationDays": 2, "deps": [{"task": a, "type": "FS"}]})
        c = plan.add(self.p["id"], {"title": "C", "durationDays": 3, "deps": [{"task": a, "type": "SS", "lag": 1}]})
        m = plan.add(self.p["id"], {"title": "M", "kind": "milestone", "deps": [{"task": b, "type": "FS"}], "invoice": True})
        v = {t["title"]: t for t in plan.schedule(self.p["id"], today=date(2026, 12, 1))["tasks"]}
        self.assertEqual((v["A"]["start"], v["A"]["end"]), ("2026-12-14", "2026-12-18"))
        self.assertEqual((v["B"]["start"], v["B"]["end"]), ("2026-12-21", "2026-12-22"))
        self.assertEqual(v["C"]["start"], "2026-12-15")
        self.assertEqual(v["M"]["start"], "2026-12-22")
        db.update_project(self.p["id"], {"holidays": [{"from": "2026-12-21", "to": "2027-01-01"}]})
        v = {t["title"]: t for t in plan.schedule(self.p["id"], today=date(2026, 12, 1))["tasks"]}
        self.assertEqual((v["B"]["start"], v["B"]["end"]), ("2027-01-04", "2027-01-05"))  # the blackout is skipped
        self.assertTrue(v["B"]["critical"] and v["A"]["critical"] and not v["C"]["critical"])
        plan.update(m, {"status": "completed"})
        sched = plan.schedule(self.p["id"], today=date(2027, 1, 6))
        self.assertTrue(sched["invoices"][0]["due"])
        self.assertEqual(sched["summary"]["invoicesDue"], 1)

    def test_health_baseline_and_rollup(self):
        ph = plan.add(self.p["id"], {"title": "Phase", "kind": "phase", "pinnedStart": "2026-10-05"})
        a = plan.add(self.p["id"], {"title": "A", "durationDays": 5, "parentId": ph})
        b = plan.add(self.p["id"], {"title": "B", "durationDays": 5, "parentId": ph, "deps": [{"task": a, "type": "FS"}], "side": "client"})
        plan.set_baseline(self.p["id"])
        plan.update(a, {"pct": 1})
        plan.update(b, {"durationDays": 7})
        v = {t["title"]: t for t in plan.schedule(self.p["id"], today=date(2026, 10, 14))["tasks"]}
        self.assertEqual(v["A"]["health"], "blue")
        self.assertEqual(v["B"]["health"], "yellow")  # started on the 12th, still 0%
        self.assertEqual(v["B"]["slipDays"], 2)
        self.assertAlmostEqual(v["Phase"]["pct"], 5 / 12, places=2)
        late = plan.schedule(self.p["id"], today=date(2026, 11, 2))
        self.assertEqual({t["title"]: t["health"] for t in late["tasks"]}["B"], "red")
        self.assertEqual(late["summary"]["clientOpen"], 1)

    def test_template_phase_with_streams(self):
        root = plan.generate(self.p["id"], "smdg-phase", "Phase 0", ["FAC", "MM"], "2026-09-21")
        v = plan.schedule(self.p["id"], today=date(2026, 9, 1))
        titles = [t["title"] for t in v["tasks"]]
        self.assertIn("SIT: FAC", titles)
        self.assertIn("UAT: MM", titles)
        self.assertEqual(sum(1 for t in v["tasks"] if t["invoice"]), 2)  # blueprint and UAT sign-off
        crit = [t["title"] for t in v["tasks"] if t["critical"] and not t["isParent"]]
        self.assertIn("UAT sign-off (business lead + PMO)", crit)
        plan.generate(self.p["id"], "smdg-phase", "Phase 1", ["GR"], None, after=root, skip_prep=True)
        v = plan.schedule(self.p["id"], today=date(2026, 9, 1))
        p1 = [t for t in v["tasks"] if t["title"] == "Phase 1"][0]
        self.assertNotIn("PREPARATION", [t["title"] for t in v["tasks"] if t["wbs"].startswith(p1["wbs"] + ".")])

    def test_cycle_is_refused(self):
        a = plan.add(self.p["id"], {"title": "A"})
        b = plan.add(self.p["id"], {"title": "B", "deps": [{"task": a}]})
        plan.update(a, {"deps": [{"task": b}]})
        with self.assertRaises(ValueError):
            plan.schedule(self.p["id"])


class SignoffTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()
        seed.seed()
        cls.bl = gov.save_user(None, {"name": "bl", "role": "member", "titles": "business lead"})
        cls.pmo = gov.save_user(None, {"name": "pmo1", "role": "lead", "titles": ["pmo"]})
        cls.sc = gov.save_user(None, {"name": "sc", "role": "member", "titles": "steering committee"})
        cls.cl = gov.save_user(None, {"name": "client1", "role": "member", "titles": "client"})
        cls.dev = gov.save_user(None, {"name": "dev1", "role": "member"})
        gov.save_settings({"signoffByTitle": True})        # titled sign-offs (people management phase)

    @classmethod
    def tearDownClass(cls):
        gov.save_settings({"signoffByTitle": False})
        for u in (cls.bl, cls.pmo, cls.sc, cls.cl, cls.dev):
            gov.save_user(u["id"], {"role": u["role"], "disabled": True})

    def u(self, x):
        return gov.user_by_token(x["token"])

    def run_at(self, gid):
        p = db.create_project("S %s %s" % (gid, id(self)), tempfile.mkdtemp(), owner="lucas")
        rid = db.create_run(p["id"], "wf-full-delivery", "Feature", owner="lucas")
        step = next(s for s in db.steps_of(rid) if s["group_id"] == gid)
        for s in db.steps_of(rid):
            if s["position"] < step["position"]:
                db.ex("UPDATE step_run SET status='done' WHERE id=?", s["id"])
        db.ex("UPDATE step_run SET status='awaiting_approval', summary_json=? WHERE id=?", json.dumps({"summary": "ok"}), step["id"])
        db.ex("UPDATE run SET status='waiting_human', current_pos=? WHERE id=?", step["position"], rid)
        return p, rid, step

    def test_titles_off_any_person_signs(self):
        gov.save_settings({"signoffByTitle": False})
        try:
            p, rid, step = self.run_at("g-uat")
            out = engine.approve(rid, step["position"], self.u(self.dev), "ok")
            self.assertEqual(out["waitingFor"], [])
            s = db.one("SELECT status, approved_by FROM step_run WHERE id=?", step["id"])
            self.assertEqual((s["status"], s["approved_by"]), ("done", "dev1"))
        finally:
            gov.save_settings({"signoffByTitle": True})

    def test_uat_needs_business_lead_and_pmo(self):
        p, rid, step = self.run_at("g-uat")
        with self.assertRaises(ValueError):
            engine.approve(rid, step["position"], self.u(self.dev))  # holds no title
        out = engine.approve(rid, step["position"], self.u(self.bl), "looks good")
        self.assertEqual(out["waitingFor"], ["pmo"])
        self.assertEqual(db.one("SELECT status FROM step_run WHERE id=?", step["id"])["status"], "awaiting_approval")
        engine.approve(rid, step["position"], self.u(self.pmo))
        s = db.one("SELECT * FROM step_run WHERE id=?", step["id"])
        self.assertEqual((s["status"], s["approved_by"]), ("done", "bl, pmo1"))
        self.assertEqual([x["title"] for x in gov.signoffs("step:%d" % step["id"])], ["business lead", "pmo"])
        # Re-opening signed-off work records the extra time and cost.
        due = db.run_get(rid)["due_at"]
        engine.rerun_from(rid, step["position"], "client found a problem")
        self.assertGreater(db.run_get(rid)["due_at"], due)
        self.assertTrue(any("re-opened" in i["title"] for i in gov.items(run_id=rid, kind="issue")))

    def test_promotion_on_sit(self):
        p, rid, step = self.run_at("g-sit")
        engine.approve(rid, step["position"], self.u(self.bl))
        engine.approve(rid, step["position"], self.u(self.pmo))
        envs = db.jload(db.project_get(p["id"])["envs_json"], [])
        self.assertEqual(envs[0]["name"], "QAS")
        self.assertIn("run #%d" % rid, envs[0]["version"])

    def test_change_request_steering_then_client(self):
        p, rid, step = self.run_at("g-uat")
        item = engine.raise_change(rid, "Add export", "CSV export of the list", "lucas")
        with self.assertRaises(ValueError):
            engine.decide_change(item["id"], True, self.u(self.cl))  # the steering committee signs first
        out = engine.decide_change(item["id"], True, self.u(self.sc))
        self.assertEqual((out["status"], out["waitingFor"]), ("proposed", ["client"]))
        out = engine.decide_change(item["id"], True, self.u(self.cl))
        self.assertEqual(out["status"], "approved")
        self.assertTrue(any(s["text"].startswith(item["ref"]) for s in gov.scope_items(rid)))
        self.assertEqual(db.run_get(rid)["rerun_from_node"],
                         next(s["node_id"] for s in db.steps_of(rid) if s["group_id"] == "g-spec"))  # blueprint first


if __name__ == "__main__":
    unittest.main()
