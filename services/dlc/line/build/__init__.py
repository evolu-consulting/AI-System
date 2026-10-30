"""Plan + build (blocks 10-12): planner, graph validation, scheduler, sandbox, builder, verifier.

    from line.build import plan, validate, next_ready, Sandbox, dispatch, run_builder, verify, decide

  planner.plan(digest, tests, repo, llm, store, run=...) -> Graph   (LLM proposes, code validates)
  graph.validate(graph, ...) -> [code]      graph.violations(...) -> [{"code","unit","message"}]
  graph.waves(units) / graph.critical_path(units)
  scheduler.next_ready(run, store) -> [Unit]  critical path > units unlocked > wait time
  sandbox.Sandbox(repo, workroot).create(unit) / diff(unit) / cleanup(unit)   git worktree per unit
  builder.dispatch(...) ready -> leased;  builder.run_builder(...) -> SUBMIT | BLOCKED:<reason>
  verifier.verify(unit, attempt, ...) -> Gate;  verifier.decide(history, cfg) -> retry ladder decision
"""

from .graph import critical_path, effective_deps, validate, violations, waves
from .planner import plan
from .scheduler import next_ready, promote
from .sandbox import Diff, Sandbox
from .builder import BuildResult, dispatch, run_builder
from .verifier import Decision, decide, fingerprint, gate, verify

__all__ = [
    "critical_path", "effective_deps", "validate", "violations", "waves", "plan", "next_ready",
    "promote", "Diff", "Sandbox", "BuildResult", "dispatch", "run_builder", "Decision", "decide",
    "fingerprint", "gate", "verify",
]
