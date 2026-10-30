"""Persona seeding (line.personas): a store without the persona gets it; a store that has it is never overwritten."""

from __future__ import annotations

import unittest
from unittest import mock

from line import personas
from line.config import load_config


class SeedTest(unittest.TestCase):
    def setUp(self):
        personas._done.clear()
        self.addCleanup(personas._done.clear)
        self.rules, self.projects = {}, set()

        def call(cfg, method, path, body=None):
            if path.startswith("/policy/plan"):
                proj = path.split("project=")[-1].replace("+", " ").replace("%20", " ")
                return {"rules": [dict(r, project=p) for (p, _s), r in self.rules.items() if p == proj]}
            if path == "/projects":
                self.projects.add(body["id"])
                return {}
            if path == "/policy/action/set":
                return {}
            if path == "/policy/rule/set":
                self.rules[(body["project"], body["sub_action"])] = {"sub_action": body["sub_action"],
                                                                     "seq": body["seq"], "content": body["content"]}
                return {}
            raise AssertionError(path)
        for target, new in ((personas, "_call"),):
            p = mock.patch.object(target, new, call)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch("line.ragmap.enabled", lambda cfg: True)
        p.start()
        self.addCleanup(p.stop)
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")

    def test_a_fresh_store_gets_every_persona_and_an_edited_rule_survives_a_second_seed(self):
        self.assertEqual(personas.seed(self.cfg), {p: "created" for p in personas.PERSONAS})
        self.assertEqual(self.projects, set(personas.PERSONAS))
        self.assertEqual(len([k for k in self.rules if k[0] == "agent-sizer"]), len(personas.SIZER_RULES))
        self.rules[("agent-sizer", "calibration")]["content"] = "edited by the retro"
        personas._done.clear()
        self.assertEqual(personas.seed(self.cfg), {p: "present" for p in personas.PERSONAS})
        self.assertEqual(self.rules[("agent-sizer", "calibration")]["content"], "edited by the retro")

    def test_protected_rules_are_seeded(self):
        names = [s for s, _c in personas.SIZER_RULES]
        for name in ("two axes", "level", "report"):
            self.assertIn(name, names)
        self.assertIn("facts only", [s for s, _c in personas.RETRO_RULES])


    def test_rules_fit_the_store_and_every_main_role_has_a_persona(self):
        for persona, spec in personas.PERSONAS.items():
            for name, content in spec["rules"]:
                self.assertLess(len(content), 1150, (persona, name))
            for name in spec.get("protected", ()):
                self.assertIn(name, [n for n, _c in spec["rules"]], persona)
        for role in ("solo", "solo_lead", "solo_reviewer", "supervisor", "explainer", "distiller", "eval_judge"):
            self.assertTrue(personas.for_role(role), role)
        self.assertEqual(personas.for_role("solo_lead"), ["agent-solo", "agent-lead"])


class BlockTest(unittest.TestCase):
    def setUp(self):
        personas._blocks.clear()
        self.addCleanup(personas._blocks.clear)

    def test_the_block_lists_rules_and_open_findings_and_is_empty_without_a_store(self):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli")
        rules = [{"sub_action": "hot paths", "content": "one shared client", "seq": 1}]
        found = [{"status": "open", "title": "forgot pnpm build"}, {"status": "applied", "title": "old"}]
        with mock.patch("line.understand.sizer._kh_on", lambda c: True),                 mock.patch.object(personas, "seed", lambda c: {}),                 mock.patch("line.retro.persona_rules", lambda c, p, a: rules),                 mock.patch("line.retro.findings", lambda c, p: found):
            text = personas.block(cfg, "solo_reviewer")
        self.assertIn("persona agent-reviewer", text)
        self.assertIn("- hot paths: one shared client", text)
        self.assertIn("forgot pnpm build", text)
        self.assertNotIn("old", text.split("weigh them")[-1])
        personas._blocks.clear()
        with mock.patch("line.understand.sizer._kh_on", lambda c: False):
            self.assertEqual(personas.block(cfg, "solo"), "")
        self.assertEqual(personas.block(cfg, "planner"), "")


if __name__ == "__main__":
    unittest.main()
