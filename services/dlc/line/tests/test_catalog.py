"""The line's catalog (steps, agents, processes) as a frontend configures and explains it."""

from __future__ import annotations

import unittest

from line import catalog, hooks, runview
from line.config import Config


class CatalogTest(unittest.TestCase):
    def test_steps_follow_the_run_nodes_after_the_size_step(self):
        ids = [s["id"] for s in catalog.steps()]
        self.assertEqual(ids, ["size"] + list(runview.NODE_IDS))
        build = next(s for s in catalog.steps() if s["id"] == "build")
        self.assertEqual(build["roles"], ["builder", "fixer"])

    def test_every_step_role_is_a_known_agent_and_hooks_are_real_events(self):
        for s in catalog.steps():
            for r in s["roles"]:
                self.assertIn(r, catalog.ROLES)
            for e in s["hook_events"]:
                self.assertIn(e, hooks.EVENTS)

    def test_agents_use_the_role_model_else_the_default(self):
        cfg = Config()
        cfg.role_models = {"planner": "claude-sonnet-5-5"}
        cfg.model = "claude-opus-5-5"
        agents = {a["role"]: a for a in catalog.catalog(cfg)["agents"]}
        self.assertEqual(agents["planner"]["model"], "claude-sonnet-5-5")
        self.assertEqual(agents["builder"]["model"], "claude-opus-5-5")
        self.assertEqual(agents["builder"]["kind"], "agentic")

    def test_processes_new_system_skips_sizing(self):
        procs = {p["id"]: p for p in catalog.catalog(Config())["processes"]}
        self.assertEqual(procs["new-system"]["steps"][0], "understand")
        self.assertEqual(procs["enhancement"]["steps"][0], "size")
        self.assertEqual(procs["bug-fix"]["steps"][-1], "result")


if __name__ == "__main__":
    unittest.main()
