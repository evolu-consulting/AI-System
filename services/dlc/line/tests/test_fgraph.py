"""Feature graph (line.fgraph, slices A1 + A3): checks, multi-hop derivation, gaps, order, and the stage hook
wired to the human-question flow (ask parks, decide / dry auto answer, answers applied)."""

from __future__ import annotations

import unittest

from line import codes
from line.codes import LineError
from line.contracts import E_FGAP, E_FGRAPH
from line.fgraph import FEdge, FeatureGraph, FNode, check, depth, derive, gap_questions, must_precede
from line.fgraph.stage import on_graph
from line.tests.test_uplus_support import events, line_of, world
from line.understand_plus import human


def shop(heads, credit_external=False, cycle=False):
    """F1 Orders consumes the credit limit (nothing makes it) and produces orders; F2 VIP consumes orders."""
    f1, f2 = heads["F1"], heads["F2"]
    q_credit = line_of(f1, "credit limit")
    q_vip = line_of(f2, "VIP")
    nodes = [
        FNode("M", "feature", "Shop", tier=1, span_id=f1.id, quote="Orders"),
        FNode("F1", "feature", "Orders", tier=2, f_item="F1", span_id=f1.id, quote=q_credit),
        FNode("F2", "feature", "VIP", tier=2, f_item="F2", span_id=f2.id, quote=q_vip),
        FNode("order", "data", "order", span_id=f1.id, quote="An order"),
        FNode("credit", "data", "credit limit", external=credit_external, span_id=f1.id, quote="credit limit"),
    ]
    edges = [
        FEdge("M", "F1", "parent_of", f1.id, "Orders"),
        FEdge("M", "F2", "parent_of", f2.id, "VIP"),
        FEdge("F1", "order", "produces", f1.id, q_credit),
        FEdge("F1", "credit", "consumes", f1.id, q_credit),
        FEdge("F2", "order", "consumes", f2.id, q_vip),
    ]
    if cycle:
        edges.append(FEdge("F1", "F2", "depends_on", f1.id, q_credit))
    return FeatureGraph(pack_version="v1", nodes=nodes, edges=edges)


def spans_of(w):
    return {sp.id: sp for sp in w.pv.spans}


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)

    def test_valid_graph_has_no_violations(self):
        self.assertEqual(check(shop(self.w.heads), self.w.digest.f_items, spans_of(self.w)), [])

    def test_violations(self):
        g = shop(self.w.heads)
        g.edges.append(FEdge("F2", "ghost", "consumes", "", ""))                       # unknown node
        g.edges.append(FEdge("F1", "F2", "produces", g.edges[0].span_id, "Orders"))    # wrong kinds
        g.nodes[1].quote = "not in the spec at all"                                     # bad quote
        g.nodes.append(FNode("X", "feature", "Deep", tier=4))
        g.edges.append(FEdge("F1", "X", "parent_of", g.edges[0].span_id, "Orders"))    # skips tier 3
        got = {v["code"] for v in check(g, self.w.digest.f_items, spans_of(self.w))}
        self.assertTrue({"FG_UNKNOWN_NODE", "FG_EDGE_KIND", "FG_QUOTE", "FG_TIER"} <= got, got)

    def test_missing_fitem_and_cycle(self):
        g = shop(self.w.heads, cycle=True)
        g.edges.append(FEdge("F2", "F1", "depends_on", g.edges[0].span_id, "Orders"))
        g.nodes = [n for n in g.nodes if n.id != "F2"] + [FNode("F2", "feature", "VIP", tier=2)]
        got = {v["code"] for v in check(g, self.w.digest.f_items, spans_of(self.w))}
        self.assertIn("FG_FITEM_MISSING", got)
        self.assertIn("FG_CYCLE", got)


class DeriveTest(unittest.TestCase):
    def setUp(self):
        self.w = world(self)

    def test_consumer_depends_on_producer_and_order(self):
        g = derive(shop(self.w.heads))
        d = [(e.src, e.dst, e.via, e.basis) for e in g.edges if e.derived]
        self.assertIn(("F2", "F1", ["order"], "data"), d)
        self.assertLess(g.order.index("F1"), g.order.index("F2"))
        self.assertEqual(g.order[0], "M")                     # nothing outside the module: tier 1 first
        self.assertEqual(must_precede(g)["F2"], {"F1"})
        self.assertEqual(depth(g)["F2"], 1)

    def test_unproduced_is_a_gap_unless_external(self):
        g = derive(shop(self.w.heads))
        self.assertEqual([(x["kind"], x["node"], x["consumers"]) for x in g.gaps], [("unproduced", "credit", ["F1"])])
        g2 = derive(shop(self.w.heads, credit_external=True))
        self.assertEqual(g2.gaps, [])

    def test_multi_hop_chain_and_multi_producer(self):
        g = derive(shop(self.w.heads, credit_external=True))
        sp = g.nodes[1].span_id
        g.nodes += [FNode("F3", "feature", "Invoice", tier=2), FNode("ship", "data", "shipment")]
        g.edges += [FEdge("F2", "ship", "produces", sp, "x"), FEdge("F3", "ship", "consumes", sp, "x"),
                    FEdge("F1", "ship", "produces", sp, "x")]
        derive(g)
        self.assertEqual(must_precede(g)["F3"], {"F1", "F2"})   # F3 <- ship <- F2 <- order <- F1
        self.assertTrue(any(x["kind"] == "multi_producer" and x["node"] == "ship" for x in g.gaps))
        self.assertEqual(g.order.index("F3"), len(g.order) - 1)

    def test_inherited_edges_never_block_the_order(self):
        """Two modules whose features depend across both ways: a module loop, not a feature loop."""
        g = FeatureGraph("v1", nodes=[
            FNode("A", "feature", "A", tier=1), FNode("B", "feature", "B", tier=1),
            FNode("a1", "feature", "a1", tier=2), FNode("a2", "feature", "a2", tier=2),
            FNode("b1", "feature", "b1", tier=2), FNode("x", "data", "x"), FNode("y", "data", "y")],
            edges=[FEdge("A", "a1", "parent_of", derived=True), FEdge("A", "a2", "parent_of", derived=True),
                   FEdge("B", "b1", "parent_of", derived=True),
                   FEdge("a1", "x", "produces", derived=True), FEdge("b1", "x", "consumes", derived=True),
                   FEdge("b1", "y", "produces", derived=True), FEdge("a2", "y", "consumes", derived=True)])
        for e in g.edges:
            e.derived = False
        derive(g)
        self.assertTrue(any(e.basis == "inherit" and e.src == "A" and e.dst == "b1" for e in g.edges))
        self.assertTrue(g.order, "a module-level loop must not empty the order")
        self.assertLess(g.order.index("a1"), g.order.index("b1"))
        self.assertLess(g.order.index("b1"), g.order.index("a2"))
        self.assertEqual([v for v in check(g) if v["code"] == "FG_CYCLE"], [])

    def test_derive_is_idempotent(self):
        g = derive(shop(self.w.heads))
        n = len(g.edges)
        derive(g)
        self.assertEqual(len(g.edges), n)

    def test_gap_question_is_a_valid_human_question(self):
        g = derive(shop(self.w.heads))
        qs = gap_questions(g, "r1")
        self.assertEqual(len(qs), 1)
        self.assertEqual(human.validate_question(qs[0]), [])
        self.assertEqual(qs[0]["f_items"], ["F1"])
        self.assertEqual({o["id"] for o in qs[0]["options"]}, {"external", "add_feature", "not_needed"})


class StageTest(unittest.TestCase):
    def test_ok_when_nothing_is_missing(self):
        w = world(self)
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads, credit_external=True))
        self.assertEqual(res["status"], "ok")
        self.assertEqual(w.f.store.get(E_FGRAPH, w.run)["order"][:1], ["M"])
        ev = events(w.f.store, codes.FGRAPH_CHECKED)
        self.assertEqual(ev[-1].body["violations"], [])

    def test_gap_parks_the_run_in_ask_mode(self):
        w = world(self)
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        self.assertEqual(res["status"], "waiting_human")
        self.assertTrue(human.is_parked(w.f.store, w.run))
        q = human.pending(w.f.store, w.run)
        self.assertEqual([x["kind"] for x in q], ["dependency"])
        self.assertEqual(w.f.store.get(E_FGAP, "%s:credit" % w.run)["state"], "open")

    def test_answer_external_is_applied_on_the_next_pass(self):
        w = world(self)
        on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        qid = human.pending(w.f.store, w.run)[0]["qid"]
        human.answer_question(w.f.store, w.run, qid, "external", "ana", cfg=w.ctx.cfg)
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["gaps"], [])
        g = w.f.store.get(E_FGRAPH, w.run)
        self.assertTrue(next(n for n in g["nodes"] if n["id"] == "credit")["external"])

    def test_dry_auto_answers_then_applies(self):
        w = world(self, dry_human="auto")
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        self.assertEqual(res["status"], "answered")
        self.assertEqual(on_graph(w.ctx, w.pv, w.digest, shop(w.heads))["status"], "ok")

    def test_decide_mode_lets_the_model_answer(self):
        w = world(self, human_mode="decide")

        class Res:
            def __init__(self):
                self.data, self.text = {"option": "not_needed", "reason": "credit is checked elsewhere"}, ""

        class Llm:
            def complete(self, *a, **k):
                return Res()
        w.ctx.llm = Llm()
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        self.assertEqual(res["status"], "answered")
        res = on_graph(w.ctx, w.pv, w.digest, shop(w.heads))
        self.assertEqual(res["status"], "ok")
        g = w.f.store.get(E_FGRAPH, w.run)
        self.assertFalse(any(e["kind"] == "consumes" and e["dst"] == "credit" for e in g["edges"]))
        self.assertEqual(len(events(w.f.store, codes.HUMAN_DECIDED)), 1)

    def test_invalid_graph_is_refused(self):
        w = world(self)
        g = shop(w.heads)
        g.nodes[1].quote = "invented sentence"
        with self.assertRaises(LineError) as cm:
            on_graph(w.ctx, w.pv, w.digest, g)
        self.assertEqual(cm.exception.code, codes.FGRAPH_INVALID)


class _R:
    def __init__(self, data):
        self.data, self.text, self.usd, self.model = data, "", 0.0, "m"


class _SeqLlm:
    """Answers the given replies in order; records the prompts."""
    def __init__(self, replies):
        self.replies, self.prompts = list(replies), []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.prompts.append((role, key, prompt))
        return _R(self.replies.pop(0))


def as_data(g):
    from dataclasses import asdict
    return {"nodes": [asdict(n) for n in g.nodes], "edges": [asdict(e) for e in g.edges]}


class ExtractTest(unittest.TestCase):
    def test_valid_answer_is_parsed(self):
        from line.fgraph.extract import extract
        w = world(self)
        llm = _SeqLlm([as_data(shop(w.heads))])
        g = extract(w.pv, w.digest, llm, run=w.run)
        self.assertEqual({n.id for n in g.nodes}, {"M", "F1", "F2", "order", "credit"})
        self.assertIn("SPAN", llm.prompts[0][2])
        self.assertIn("F1 Orders", llm.prompts[0][2])

    def test_one_retry_with_the_violations_then_refused(self):
        from line.fgraph.extract import extract
        w = world(self)
        bad = as_data(shop(w.heads))
        bad["nodes"][1]["quote"] = "made up"
        good = as_data(shop(w.heads))
        llm = _SeqLlm([bad, good])
        extract(w.pv, w.digest, llm, run=w.run)
        self.assertEqual([k for _, k, _ in llm.prompts], ["fgraph", "fgraph-retry"])
        self.assertIn("FG_QUOTE", llm.prompts[1][2])
        with self.assertRaises(LineError) as cm:
            extract(w.pv, w.digest, _SeqLlm([bad, bad]), run=w.run)
        self.assertEqual(cm.exception.code, codes.FGRAPH_INVALID)


class OrderTest(unittest.TestCase):
    def units(self, u3_deps):
        from line.contracts import Unit
        return [Unit(id="U1", run="r", title="", state="pending", claims=["a.py"], deps=[], f_items=["F1"], tests=[],
                     size="S"),
                Unit(id="U2", run="r", title="", state="pending", claims=["b.py"], deps=u3_deps, f_items=["F2"],
                     tests=[], size="S")]

    def test_feature_order_violation(self):
        from line.build import graph as G
        bad = G.violations(self.units([]), feature_deps={"F2": ["F1"]})
        self.assertEqual([v["code"] for v in bad if v["code"] == codes.FEATURE_ORDER], [codes.FEATURE_ORDER])
        good = G.violations(self.units(["U1"]), feature_deps={"F2": ["F1"]})
        self.assertFalse([v for v in good if v["code"] == codes.FEATURE_ORDER])

    def test_planner_gets_order_and_feature_deps(self):
        from line.build.planner import _order_text, feature_deps
        w = world(self)
        g = derive(shop(w.heads, credit_external=True))
        fd = feature_deps(g)
        self.assertEqual(fd["F2"], ["F1"])
        txt = _order_text(g, fd)
        self.assertIn("F1 -> F2", txt)
        self.assertIn("credit limit", txt)                    # external, read as input

    def test_needs_text_for_the_builder(self):
        from line.fgraph import needs_text
        w = world(self)
        g = derive(shop(w.heads, credit_external=True))
        txt = needs_text(g, ["F2"], [{"id": "U1", "f_items": ["F1"], "state": "merged", "claims": ["shop/orders.py"]}])
        self.assertIn("'order' made by F1 (already built in shop/orders.py)", txt)
        self.assertIn("given from outside", needs_text(g, ["F1"], []))


if __name__ == "__main__":
    unittest.main()
