"""Token metering: the stream-json meter, the price table and the usage rollup.

  python -m unittest discover -s tests
"""

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["SDLC_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

import db  # noqa: E402
import llm  # noqa: E402

HAIKU = "claude-haiku-4-5-20251001"


def assistant(mid, model, i, o, w1h, r):
    return {"type": "assistant", "message": {"id": mid, "model": model, "usage": {
        "input_tokens": i, "output_tokens": o, "cache_creation_input_tokens": w1h, "cache_read_input_tokens": r,
        "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": w1h}}}}


# The shape a real `claude -p --output-format stream-json --verbose` call printed on 2026-10-06.
RESULT = {"type": "result", "session_id": "s1", "result": "ok", "total_cost_usd": 0.0248007,
          "modelUsage": {HAIKU: {"inputTokens": 17, "outputTokens": 174, "cacheReadInputTokens": 44957,
                                 "cacheCreationInputTokens": 9709, "costUSD": 0.0248007}}}


class PricingTest(unittest.TestCase):
    def test_dated_id_and_alias_resolve(self):
        self.assertEqual(llm.price_of(HAIKU)["input"], 1.0)
        self.assertEqual(llm.price_of("sonnet")["output"], 10.0)
        self.assertIsNone(llm.price_of("gpt-5"))

    def test_estimate_matches_the_cli_figure(self):
        # The CLI billed this exact usage at $0.0248007 (1h cache writes at 2x input).
        u = {"input_tokens": 17, "output_tokens": 174, "cache_creation_input_tokens": 9709,
             "cache_read_input_tokens": 44957, "cache_creation": {"ephemeral_1h_input_tokens": 9709}}
        self.assertAlmostEqual(llm.estimate(HAIKU, u), 0.0248007, places=7)


class MeterTest(unittest.TestCase):
    def test_repeated_message_counts_once_and_messages_add(self):
        m = llm.UsageMeter("haiku")
        a = assistant("m1", HAIKU, 9, 6, 8775, 18091)
        self.assertTrue(m.feed(a))
        m.feed(a)  # the CLI repeats usage once per content block
        m.feed(assistant("m2", HAIKU, 8, 1, 934, 26866))
        t = m.totals()
        self.assertEqual((t["input"], t["output"], t["cacheWrite"], t["cacheRead"]), (17, 7, 9709, 44957))
        self.assertFalse(t["final"])
        self.assertGreater(t["costUsd"], 0)

    def test_result_replaces_the_estimate(self):
        m = llm.UsageMeter("haiku")
        m.feed(assistant("m1", HAIKU, 9, 6, 8775, 18091))
        self.assertTrue(m.feed(RESULT))
        t = m.totals()
        self.assertTrue(t["final"])
        self.assertEqual(t["output"], 174)
        self.assertAlmostEqual(t["costUsd"], 0.0248007)
        self.assertFalse(m.feed({"type": "system"}))


class RollupTest(unittest.TestCase):
    def test_project_and_run_totals(self):
        db.init_db()
        db.ex("INSERT INTO project(id, name, slug, folder, kh_project, created_at) VALUES ('p-x','X','x','C:/x','sdlc-x','t')")
        r1 = db.ex("INSERT INTO run(project_id, workflow_id, kind, title, slug) VALUES ('p-x','wf','feature','A','a')")
        r2 = db.ex("INSERT INTO run(project_id, workflow_id, kind, title, slug) VALUES ('p-x','wf','feature','B','b')")
        c = db.usage_start(r1, 1, "a-dev", "sonnet")
        m = llm.UsageMeter("haiku")
        m.feed(assistant("m1", HAIKU, 9, 6, 8775, 18091))
        db.usage_set(c, m.totals())
        m.feed(RESULT)
        db.usage_set(c, m.totals())  # overwrites, does not add
        out = db.usage(["p-x", "p-missing"])
        self.assertEqual(list(out["projects"]), ["p-x"])
        self.assertEqual(out["projects"]["p-x"]["tokens"], 17 + 174 + 9709 + 44957)
        self.assertAlmostEqual(out["projects"]["p-x"]["costUsd"], 0.0248, places=4)
        self.assertEqual(out["runs"][str(r1)]["calls"], 1)
        self.assertEqual(out["runs"][str(r2)]["tokens"], 0)


if __name__ == "__main__":
    unittest.main()
