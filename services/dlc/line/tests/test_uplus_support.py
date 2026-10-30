"""Shared fixtures of the understand_plus tests (blocks 7 + 8).

Until the integrator adds the new event kinds and entities to codes.py / contracts.py, every
uplus test registers them locally with register_uplus(self)."""

from __future__ import annotations

import types
import unittest
from unittest import mock

from line import codes, contracts
from line import store as store_mod
from line.contracts import E_FITEM, E_PACK, E_RUN, Criterion, Digest, FItem, PackVersion, to_dict
from line.tests import fakes
from line.understand._common import sha256_text
from line.understand.ingest import split_spans
from line.understand_plus._common import NEW_ENTITIES, NEW_EVENT_KINDS

SPEC = """# Shop

## F1 Orders

- An order over the credit limit is blocked.
- Orders ship within 3 days.
- A cancelled order is deleted after 30 days.

## F2 VIP

- An order of a VIP customer is approved automatically.
- This replaces the old approval rule for VIP customers.
- Orders ship within 5 days.
"""


def register_uplus(tc: unittest.TestCase) -> None:
    kinds = frozenset(codes.EVENT_KINDS) | frozenset(NEW_EVENT_KINDS)
    ents = frozenset(contracts.ENTITIES) | frozenset(NEW_ENTITIES)
    for target, name, value in ((codes, "EVENT_KINDS", kinds), (contracts, "ENTITIES", ents),
                                (fakes, "ENTITIES", ents), (store_mod, "ENTITIES", ents)):
        p = mock.patch.object(target, name, value)
        p.start()
        tc.addCleanup(p.stop)


def cfg(**kw):
    base = dict(agent_version="test", uplus_enabled=True, uplus_gaps=True, uplus_conflicts=True,
                uplus_park_scope="run", uplus_spec_supersede=True, uplus_unscanned_asks=False, uplus_graph="system",
                uplus_graph_mirror=True, uplus_max_hops=3, uplus_pack_major=1, human_max_open=3,
                human_due_workdays=2, human_remind_workdays=1, dry_human="", dry_pack="")
    base.update(kw)
    return types.SimpleNamespace(**base)


def make_pack(text: str = SPEC):
    spans = split_spans("spec.md", text)
    sha = sha256_text(text)
    pv = PackVersion(version="v-" + sha[:16], pack_id="shop", root="", files={"spec.md": sha}, spans=spans)
    by_head = {sp.heading.split(" ")[0]: sp for sp in spans}
    return pv, by_head


def line_of(span, needle: str) -> str:
    return next(l for l in span.text.split("\n") if needle in l)


def make_digest(pv, by_head, variant: str = "R") -> Digest:
    f1, f2 = by_head["F1"], by_head["F2"]
    q1 = line_of(f1, "credit limit")
    q2 = line_of(f2, "VIP")
    return Digest(pack_version=pv.version, variant=variant, f_items=[
        FItem("F1", "Orders", [f1.id], q1, [Criterion("F1.C1", "F1", "blocked", f1.id, q1, "", "", "blocked")]),
        FItem("F2", "VIP", [f2.id], q2, [Criterion("F2.C1", "F2", "approved", f2.id, q2, "", "", "approved")]),
    ])


def world(tc: unittest.TestCase, run: str = "r1", **cfg_kw):
    """FakeStore + FakeLlm + FakeRag, pack and run row stored; returns a ctx usable as the Pipeline."""
    register_uplus(tc)
    f = fakes.make_fakes()
    pv, heads = make_pack()
    f.store.put(E_PACK, pv.version, to_dict(pv))
    f.store.put(E_RUN, run, {"id": run, "pack_path": "", "state": "understanding", "spec_hash": pv.version, "detail": {}})
    dg = make_digest(pv, heads)
    for it in dg.f_items:
        f.store.put(E_FITEM, "%s:%s" % (run, it.id), to_dict(it), run=run)
    ctx = types.SimpleNamespace(store=f.store, sstore=None, run=run, llm=f.llm, cfg=cfg(**cfg_kw), rag=f.rag,
                                clock=f.clock)
    return types.SimpleNamespace(f=f, pv=pv, heads=heads, digest=dg, ctx=ctx, run=run)


def events(store, kind=None, run=None):
    return [e for e in store.events_after(0, run=run) if kind is None or e.kind == kind]


class SupportTest(unittest.TestCase):
    def test_pack_has_feature_spans(self):
        pv, heads = make_pack()
        self.assertIn("F1", heads)
        self.assertIn("F2", heads)
        self.assertIn("credit limit", heads["F1"].text)


if __name__ == "__main__":
    unittest.main()
