"""S3: cost caps before the call, run ledger, schema-lite validation with one repair."""

import unittest

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import E_LLM_CALL, LlmResult
from line.llm import make_llm
from line.llm.caps import Pricing, parse_json, validate
from line.tests.fakes import FakeStore


class SpyBackend:
    """Scripted backend that records every call it receives."""
    name = "spy"
    overhead_tokens = 0

    def __init__(self, answers=(), usd=0.10):
        self.answers = list(answers)
        self.usd = usd
        self.calls = []

    def raw_complete(self, role, prompt, model, key, repair=False):
        self.calls.append(("complete", role, key, repair, prompt))
        text = self.answers.pop(0) if self.answers else "{}"
        return LlmResult(None, text, {"input": 100, "output": 50}, self.usd, model, "")

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        self.calls.append(("agentic", role, key, usd_cap, prompt))
        return LlmResult(None, "done\nSUBMIT", {"input": 1, "output": 1}, self.usd, model, "SUBMIT")


def cfg(**kw):
    return load_config(env={}, line_json=None, rag_local_json=None, **kw)


SCHEMA = {"type": "object", "required": ["items"],
          "properties": {"items": {"type": "array", "items": {"type": "object", "required": ["id"],
                                                              "properties": {"id": {"type": "string"},
                                                                             "size": {"enum": ["S", "M", "L"]}}}}}}


class CapsTest(unittest.TestCase):
    def test_call_cap_blocks_before_backend(self):
        spy = SpyBackend()
        llm = make_llm(cfg(max_usd_call=0.0001), backend=spy)
        with self.assertRaises(LineError) as cm:
            llm.complete("reader", "x" * 3000, key="A", run="r1")
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.assertEqual(cm.exception.detail["limit"], "max_usd_call")
        with self.assertRaises(LineError):
            llm.agentic("builder", ".", "build", 10, 5.0, key="U1#1", run="r1")
        self.assertEqual(spy.calls, [])
        self.assertEqual(llm.ledger, [])

    def test_agentic_usd_cap_blocks_before_backend(self):
        spy = SpyBackend()
        llm = make_llm(cfg(max_usd_call=10, max_usd_run=10), backend=spy)
        with self.assertRaises(LineError) as cm:
            llm.agentic("builder", ".", "build", 10, 0.0001, key="U1#1", run="r1")
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.assertEqual(cm.exception.detail["limit"], "usd_cap")
        self.assertEqual(spy.calls, [])

    def test_run_ledger_sums_and_run_cap_blocks(self):
        store = FakeStore()
        spy = SpyBackend(usd=0.45)
        llm = make_llm(cfg(max_usd_call=1.0, max_usd_run=1.0), store=store, backend=spy)
        llm.complete("reader", "p", key="A", run="r1")
        llm.complete("reader", "p", key="B", run="r1")
        llm.complete("reader", "p", key="A", run="r2")          # other run, own ledger
        rows = store.query(E_LLM_CALL, run="r1")
        self.assertEqual(len(rows), 2)
        self.assertEqual({r["key"] for r in rows}, {"A", "B"})
        self.assertEqual(rows[0]["role"], "reader")
        self.assertEqual(rows[0]["model"], "claude-opus-5-5")
        self.assertEqual(rows[0]["usage"]["input"], 100)
        self.assertAlmostEqual(llm.spent("r1"), 0.90)
        self.assertAlmostEqual(llm.spent("r2"), 0.45)
        with self.assertRaises(LineError) as cm:             # 0.90 + estimate(~0.16) > 1.0
            llm.complete("reader", "p", key="C", run="r1")
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.assertEqual(cm.exception.detail["limit"], "max_usd_run")
        self.assertEqual(len(spy.calls), 3)
        # a fresh wrapper over the same store sees the spend (ledger survives restarts)
        again = make_llm(cfg(max_usd_call=1.0, max_usd_run=1.0), store=store, backend=SpyBackend())
        self.assertAlmostEqual(again.spent("r1"), 0.90)

    def test_agentic_gets_ceiling_and_outcome(self):
        spy = SpyBackend(usd=0.25)
        llm = make_llm(cfg(max_usd_call=1.5, max_usd_run=5.0), backend=spy)
        res = llm.agentic("builder", ".", "build", 40, 1.0, key="U1#1", run="r1")
        self.assertEqual(res.outcome, "SUBMIT")
        self.assertAlmostEqual(spy.calls[0][3], 1.0)          # min(usd_cap, call cap, run left)
        self.assertEqual(llm.ledger[0]["outcome"], "SUBMIT")
        self.assertAlmostEqual(llm.spent("r1"), 0.25)

    def test_priced_from_usage_when_backend_gives_no_usd(self):
        spy = SpyBackend(usd=0.0)
        llm = make_llm(cfg(), backend=spy)
        res = llm.complete("reader", "p", key="A", run="r1")
        self.assertAlmostEqual(res.usd, (100 * 4.0 + 50 * 20.0) / 1e6)

    def test_malformed_json_one_repair_then_typed_error(self):
        spy = SpyBackend(answers=["{not json", '{"items": [{"id": 3}]}'])
        llm = make_llm(cfg(), backend=spy)
        with self.assertRaises(LineError) as cm:
            llm.complete("reader", "p", SCHEMA, key="A", run="r1")
        self.assertEqual(cm.exception.code, codes.SCHEMA_INVALID)
        self.assertEqual([c[3] for c in spy.calls], [False, True])     # exactly one repair
        self.assertIn("previous answer was rejected", spy.calls[1][4])
        self.assertTrue(any("$.items[0].id" in e for e in cm.exception.detail["errors"]))
        self.assertEqual(len(llm.ledger), 2)                            # both calls cost money

    def test_repair_succeeds(self):
        spy = SpyBackend(answers=["sorry, here: {bad", '```json\n{"items": [{"id": "U1", "size": "S"}]}\n```'])
        llm = make_llm(cfg(), backend=spy)
        res = llm.complete("reader", "p", SCHEMA, key="A", run="r1")
        self.assertEqual(res.data, {"items": [{"id": "U1", "size": "S"}]})
        self.assertAlmostEqual(res.usd, 0.20)
        self.assertEqual(res.usage["input"], 200)

    def test_valid_first_time_no_repair(self):
        spy = SpyBackend(answers=['Here you go {"items": []} thanks'])
        llm = make_llm(cfg(), backend=spy)
        self.assertEqual(llm.complete("reader", "p", SCHEMA, key="A").data, {"items": []})
        self.assertEqual(len(spy.calls), 1)
        self.assertIn('"required"', spy.calls[0][4])                   # schema appended to the prompt

    def test_validate_subset(self):
        self.assertEqual(validate({"items": [{"id": "a", "size": "M"}]}, SCHEMA), [])
        errs = validate({"items": [{"size": "XL"}]}, SCHEMA)
        self.assertEqual(len(errs), 2)
        self.assertEqual(validate(True, {"type": "integer"}), ["$: expected integer, got bool"])
        self.assertEqual(validate(None, {"type": ["string", "null"]}), [])
        self.assertEqual(parse_json("nope")[0], None)

    def test_pricing_default_and_unknown(self):
        p = Pricing(data={})
        self.assertEqual(p.row("claude-opus-5-5")["input"], 4.0)
        self.assertEqual(p.row("claude-opus-5-5")["output"], 20.0)
        self.assertEqual(p.row("some-unknown-model")["output"], 20.0)   # most expensive known row
        real = Pricing(cfg().pricing)
        self.assertEqual(real.row("opus")["output"], 20.0)
        self.assertEqual(real.row("claude-fable-5-1")["output"], 50.0)


if __name__ == "__main__":
    unittest.main()
