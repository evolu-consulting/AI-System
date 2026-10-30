"""Block 8: contradiction detection (understand_plus.conflicts)."""

from __future__ import annotations

import re
import unittest

from line import codes
from line.understand_plus import conflicts as cf
from line.understand_plus._common import CONFLICTS_CHECKED, E_CONFLICT, E_RULE_GRAPH, RUN_PARKED
from line.tests.test_uplus_support import events, line_of, world


def claim(w, head, needle, entity, attribute, outcome, condition="", **kw):
    sp = w.heads[head]
    c = {"entity": entity, "attribute": attribute, "condition": condition, "outcome": outcome, "f_item": head,
         "span_id": sp.id, "quote": line_of(sp, needle).lstrip("- ")}
    c.update(kw)
    return c


def judge(default="compatible", **by_kind):
    """FakeLlm callable: a verdict for every pair in the prompt (by pair kind, else default)."""
    def ans(role, prompt, **kw):
        out = []
        for pid, kind in re.findall(r"^### (P\d+) \((\w+), ", prompt, re.M):
            out.append({"pair": pid, "verdict": by_kind.get(kind, default), "reason": "test"})
        return {"verdicts": out}
    return ans


OLD_CREDIT = {"id": "old:C1", "entity": "credit check", "attribute": "approval", "condition": "order over credit limit",
              "outcome": "the order is blocked", "span_id": "legacy.md#L1-1", "quote": "Orders over the credit limit are blocked.",
              "tests": ["T-41"], "state": "active", "source": "run:old"}
OLD_CLERK = {"id": "old:C2", "entity": "order", "attribute": "approval", "condition": "",
             "outcome": "approved by a clerk", "span_id": "legacy.md#L2-2", "quote": "Orders are approved by a clerk.",
             "tests": ["T-7"], "state": "active", "source": "run:old"}


class Base(unittest.TestCase):
    def setUp(self):
        self.w = world(self)
        self.st = self.w.f.store
        self.llm = self.w.f.llm

    def prior(self, rules, edges=()):
        g = cf.RuleGraph("system")
        for a, b in edges:
            g.add_edge(a, b, "requires")
        for r in rules:
            g.add_rule(r)
        cf.save_graph(self.st, g)

    def detect(self, claims, links=(), judge_fn=None, **cfg_kw):
        for k, v in cfg_kw.items():
            setattr(self.w.ctx.cfg, k, v)
        self.llm.add("conflicts", {"claims": claims, "links": list(links)}, key="extract")
        self.llm.add("conflicts", judge_fn or judge(), key="judge")
        return cf.detect_conflicts(self.w.pv, self.w.digest, self.llm, store=self.st, run=self.w.run, rag=self.w.f.rag,
                                   cfg=self.w.ctx.cfg)


class ExtractTest(Base):
    def test_quotes_checked(self):
        f2 = self.w.heads["F2"]
        data = {"claims": [
            claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days"),
            dict(claim(self.w, "F1", "3 days", "order", "shipping time", "x"), quote="Orders fly within 1 day."),
            claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                  supersedes="Orders ship within 5 days."),        # literal, but no replace word
        ], "links": [{"from": "order", "to": "credit check", "span_id": f2.id, "quote": "not there"}]}
        v = cf.validate_claims(data, self.w.pv, ["F1", "F2"])
        self.assertEqual(len(v["claims"]), 2)
        self.assertEqual(v["claims"][1]["supersedes"], "")
        self.assertEqual(v["links"], [])
        reasons = sorted((d["kind"], d["reason"]) for d in v["dropped"])
        self.assertEqual(reasons, [("claim", "not_in_span"), ("link", "not_in_span"), ("supersedes", "no_replace_word")])
        self.assertTrue(all(d["code"] == codes.QUOTE_UNMATCHED for d in v["dropped"]))

    def test_confirmation_reread_never_runs_detection(self):
        self.w.digest.variant = "B"
        with self.assertRaises(ValueError):
            cf.detect_conflicts(self.w.pv, self.w.digest, self.llm, store=self.st, run=self.w.run)
        self.assertEqual(self.llm.calls, [])


class WithinSpecTest(Base):
    def test_definite_conflict_stays_even_if_model_says_compatible(self):
        res = self.detect([claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days"),
                           claim(self.w, "F2", "5 days", "orders", "shipping time", "ship within 5 days")],
                          judge_fn=judge("compatible"))
        self.assertEqual(len(res["conflicts"]), 1)
        x = res["conflicts"][0]
        self.assertEqual((x["kind"], x["detection"], x["state"]), ("within_spec", "definite", "open"))
        self.assertTrue(x["judge_disagrees"])
        self.assertEqual(x["f_items"], ["F1", "F2"])
        self.assertEqual(sorted([x["a"]["quote"], x["b"]["quote"]]), ["Orders ship within 3 days.", "Orders ship within 5 days."])
        self.assertEqual(res["label"], "conflicts")
        self.assertIsNone(res["coverage"])                  # no system graph yet
        q = res["questions"][0]
        self.assertEqual(q["kind"], "conflict")
        self.assertEqual(len(q["evidence"]), 2)
        self.assertEqual([o["id"] for o in q["options"]], ["keep_a", "keep_b"])
        self.assertIsNotNone(self.st.get(E_CONFLICT, "%s:X1" % self.w.run))
        self.assertEqual(events(self.st, CONFLICTS_CHECKED)[0].body["conflicts"], ["X1"])

    def test_suspect_pair_cleared_by_judge(self):
        res = self.detect([claim(self.w, "F1", "credit limit", "order", "approval", "blocked", "over the credit limit"),
                           claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                                 "customer is VIP")], judge_fn=judge("compatible"))
        self.assertEqual(res["conflicts"], [])
        self.assertEqual(len(res["cleared"]), 1)
        self.assertEqual(res["label"], "greenfield")

    def test_suspect_pair_without_verdict_is_kept(self):
        res = self.detect([claim(self.w, "F1", "credit limit", "order", "approval", "blocked", "over the credit limit"),
                           claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                                 "customer is VIP")], judge_fn=lambda *a, **k: {"verdicts": []})
        self.assertEqual(len(res["conflicts"]), 1)
        self.assertEqual(res["conflicts"][0]["verdict"], "none")

    def test_different_triggers_and_agreeing_outcomes_are_not_pairs(self):
        res = self.detect([claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days", trigger="ship"),
                           claim(self.w, "F2", "5 days", "order", "shipping time", "ship within 5 days", trigger="return"),
                           claim(self.w, "F1", "3 days", "order", "shipping time", "ships within 3 days", trigger="ship")])
        self.assertEqual(res["pairs"], [])
        self.assertEqual(self.llm.calls[-1]["key"], "extract")   # no pair -> no judge call


class SystemGraphTest(Base):
    def test_multi_hop_conflict_parks_for_a_person(self):
        self.prior([OLD_CREDIT], edges=[("order", "credit check")])
        res = self.detect([claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                                 "customer is VIP", supersedes="This replaces the old approval rule for VIP customers.")],
                          judge_fn=judge("compatible", vs_system="contradiction"))
        self.assertEqual(len(res["pairs"]), 1)
        p = res["pairs"][0]
        self.assertEqual((p["kind"], p["path"]), ("vs_system", ["order", "credit check"]))
        x = res["conflicts"][0]
        # explicit 'replaces', but the old rule is about credit (money) -> a person decides (R13)
        self.assertEqual(x["state"], "open")
        self.assertIn("money", x["categories"])
        self.assertEqual([o["id"] for o in x["options"]], ["new_replaces", "keep_old", "both_with_step"])
        self.assertEqual(res["superseded"], [])
        self.assertEqual(res["questions"][0]["refs"], [{"entity": E_CONFLICT, "id": x["id"]}])

    def test_explicit_replacement_outside_sensitive_area_retires_old_rule(self):
        self.prior([OLD_CLERK])
        res = self.detect([claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                                 "customer is VIP", supersedes="This replaces the old approval rule for VIP customers.")],
                          judge_fn=judge("contradiction"))
        x = res["conflicts"][0]
        self.assertEqual(x["state"], "superseded")
        self.assertEqual(x["resolution"]["retire_rule"], "old:C2")
        self.assertEqual(x["resolution"]["tests_to_change"], ["T-7"])
        self.assertEqual(res["questions"], [])
        self.assertEqual(res["superseded"], ["old:C2"])
        self.assertEqual(res["label"], "clean")             # every touched entity has a recorded rule
        # switched off -> a person decides
        self.st.put(E_CONFLICT, x["id"], dict(x, fingerprint="gone"), run=self.w.run)
        res2 = self.detect([claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                                  "customer is VIP", supersedes="This replaces the old approval rule for VIP customers.")],
                           judge_fn=judge("contradiction"), uplus_spec_supersede=False)
        self.assertEqual(res2["conflicts"][0]["state"], "open")

    def test_low_coverage_is_never_clean(self):
        self.prior([dict(OLD_CLERK, id="old:W1", entity="warehouse", attribute="capacity", outcome="100 pallets")])
        res = self.detect([claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days")])
        self.assertEqual(res["label"], "unscanned")
        self.assertEqual(res["coverage"], 0.0)
        self.assertEqual(res["questions"], [])
        res = self.detect([claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days")],
                          uplus_unscanned_asks=True)
        self.assertEqual([q["kind"] for q in res["questions"]], ["unscanned"])

    def test_commit_rules_and_mirror(self):
        self.prior([OLD_CLERK])
        self.detect([claim(self.w, "F2", "VIP customer is", "order", "approval", "approved automatically",
                           "customer is VIP", supersedes="This replaces the old approval rule for VIP customers.")],
                    judge_fn=judge("contradiction"))
        out = cf.commit_rules(self.st, self.w.run, rag=self.w.f.rag, cfg=self.w.ctx.cfg)
        self.assertEqual(out["retired"], ["old:C2"])
        self.assertTrue(out["mirrored"])
        g = cf.RuleGraph.from_dict(self.st.get(E_RULE_GRAPH, "system"))
        states = {r["id"]: r["state"] for r in g.rules}
        self.assertEqual(states["old:C2"], "superseded")
        self.assertEqual(states["%s:C1" % self.w.run], "active")
        remote, etag = self.w.f.rag.records[("rules_graph", "system")]
        self.assertEqual(len(remote["rules"]), 2)
        again = cf.commit_rules(self.st, self.w.run, rag=self.w.f.rag, cfg=self.w.ctx.cfg)   # update needs If-Match
        self.assertTrue(again["mirrored"])
        # the mirror is read back by another line instance with an empty local graph
        self.st.put(E_RULE_GRAPH, "system", {"id": "system", "name": "system"})
        g2, info = cf.load_graph(self.st, "system", self.w.f.rag, self.w.ctx.cfg)
        self.assertTrue(info["remote"])
        self.assertEqual(len(g2.rules), 2)

    def test_mirror_degrades_without_records_capability(self):
        self.w.f.rag.missing.add("records")
        self.prior([OLD_CLERK])
        self.detect([claim(self.w, "F1", "3 days", "order", "shipping time", "ship within 3 days")])
        out = cf.commit_rules(self.st, self.w.run, rag=self.w.f.rag, cfg=self.w.ctx.cfg)
        self.assertFalse(out["mirrored"])
        self.assertNotIn(("rules_graph", "system"), self.w.f.rag.records)
        self.assertEqual(len(cf.RuleGraph.from_dict(self.st.get(E_RULE_GRAPH, "system")).rules), 2)

    def test_graph_neighbours_bounded(self):
        g = cf.RuleGraph()
        for a, b in (("a", "b"), ("b", "c"), ("c", "d"), ("d", "e")):
            g.add_edge(a, b)
        self.assertEqual(sorted(g.neighbours("a", 3)), ["a", "b", "c", "d"])
        g.add_entity("Orders", ["SalesOrder"])
        self.assertEqual(g.canon("sales orders"), g.canon("order"))


if __name__ == "__main__":
    unittest.main()
