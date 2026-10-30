"""One learning mechanism for every agent: the LLM port puts each role's persona in front of its prompt, agents record
outcomes in one place (line.outcomes), and the retro judges every role from that record, sharded by persona."""

from __future__ import annotations

import types
import unittest
from unittest import mock

from line import outcomes, personas, retro
from line.config import load_config
from line.contracts import E_LLM_CALL, E_RUN


class MemStore:
    def __init__(self):
        self.rows, self.vers, self.calls = {}, {}, []

    def get(self, entity, key):
        r = self.rows.get((entity, key))
        return dict(r) if r is not None else None

    def version(self, entity, key):
        return self.vers.get((entity, key), 0)

    def put(self, entity, key, row, if_version=None, run=""):
        if entity == E_LLM_CALL:
            self.calls.append(dict(row))
            return
        self.rows[(entity, key)] = dict(row)
        self.vers[(entity, key)] = self.vers.get((entity, key), 0) + 1

    def query(self, entity, run=""):
        return [c for c in self.calls if c.get("run") == run] if entity == E_LLM_CALL else []


class OutcomesTest(unittest.TestCase):
    def setUp(self):
        self.store = MemStore()
        self.store.put(E_RUN, "R0", {"id": "R0", "state": "escalated", "detail": {}})
        self.store.put(E_RUN, "R1", {"id": "R1", "state": "green", "detail": {"retry_of": "R0"}})
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")

    def test_ledger_records_and_the_failed_runs_claims_are_read_together(self):
        self.store.put(E_LLM_CALL, "x", {"run": "R1", "role": "test_author", "usd": 0.2, "outcome": "SUBMIT"})
        self.store.put(E_LLM_CALL, "y", {"run": "R1", "role": "test_author", "usd": 0.1})
        outcomes.record(self.store, "R1", "solo_reviewer", misses_per_round=[2, 0])
        outcomes.record(self.store, "R0", "supervisor", judged_by_retry=True, hint="use pnpm")
        outcomes.record(self.store, "R0", "solo", rounds=[1])            # not a claim for the retry to judge
        got = outcomes.read(self.store, "R1")
        self.assertEqual((got["test_author"]["calls"], got["test_author"]["usd"]), (2, 0.3))
        self.assertEqual(got["solo_reviewer"]["misses_per_round"], [2, 0])
        self.assertEqual(got["supervisor@R0"]["hint"], "use pnpm")
        self.assertEqual(got["supervisor@R0"]["this_run_result"], "green")
        self.assertNotIn("solo@R0", got)

    def test_every_role_gets_a_persona_and_the_retro_judges_it_with_no_code_of_its_own(self):
        self.store.put(E_LLM_CALL, "x", {"run": "R1", "role": "brand_new_agent", "usd": 0.1, "outcome": "BLOCKED"})
        outcomes.record(self.store, "R0", "supervisor", judged_by_retry=True, hint="h")
        pipe = types.SimpleNamespace(store=self.store, run="R1", cfg=self.cfg)
        ag = retro.agent_facts(pipe, {}, {})
        self.assertEqual(ag["brand_new_agent"]["personas"], ["agent-brand-new-agent"])
        self.assertEqual(personas.action_of("agent-brand-new-agent"), "work as brand_new_agent")
        self.assertEqual(ag["supervisor@R0"]["personas"], ["agent-supervisor"])
        self.assertEqual(retro.acting_personas(ag), ["agent-brand-new-agent", "agent-supervisor"])
        self.assertEqual(personas.for_role("change_sizer"), [])

    def test_an_instance_looks_after_its_share_of_personas_only(self):
        self.store.put(E_LLM_CALL, "x", {"run": "R1", "role": "solo", "usd": 1})
        self.store.put(E_LLM_CALL, "y", {"run": "R1", "role": "eval_judge", "usd": 1})
        cfg = load_config(env={"LINE_RETRO_PERSONAS": "agent-solo,agent-lead"}, line_json=None,
                          rag_local_json=None, llm="cli")
        ag = retro.agent_facts(types.SimpleNamespace(store=self.store, run="R1", cfg=cfg), {}, {})
        self.assertEqual(list(ag), ["solo"])

    def test_the_llm_port_puts_the_persona_in_front_of_every_role(self):
        from line.llm.caps import CappedLlm
        seen = []

        class Backend:
            name = "t"
            overhead_tokens = 0

            def raw_complete(self, role, prompt, model, key, repair=False):
                seen.append(prompt)
                from line.contracts import LlmResult
                return LlmResult(None, "ok", {}, 0.0, model, "")

        llm = CappedLlm(Backend(), self.cfg)
        with mock.patch("line.personas.block", lambda cfg, role: "PERSONA[%s]\n" % role):
            llm.complete("any_role", "do it", key="k")
        self.assertTrue(seen[0].startswith("PERSONA[any_role]\ndo it"))


if __name__ == "__main__":
    unittest.main()
