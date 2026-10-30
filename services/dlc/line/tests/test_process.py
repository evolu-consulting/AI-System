"""line.process: definitions as data (sources, extends, validation), artifacts, checks, the living spec, and the
gated flow running a project's own definition."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest

from line import attention, gates
from line.contracts import E_RUN
from line.llm import make_llm
from line.pipeline import Pipeline, init_target
from line.process import artifacts as A
from line.process import checks as C
from line.process import definition as D
from line.process import trace as T
from line.statemachine import update_row
from line.store import SqliteStore
from line.tests.test_gates import CODE, FIXED, Team, cfg, write

SPEC_DOC = ("# Spec: add\n## Summary\nadd numbers\n## Mapping to the existing system\ncalc.py\n## Spec\n"
            "### F1 add returns the sum\nadd(2, 3) is 5\n### F2 add keeps ints\nints stay ints\n"
            "## Domains\n- calculator: F1, F2\n## Questions\nnone\nSUBMIT")
IMPL_DOC = "# Implement plan\n## Blast radius\ncalc.py\n## Steps\n1. fix add() in calc.py (F1)\n## Risks and checks\nnone\nSUBMIT"
TEST_DOC = ("# Test plan\n## Scope\nadd\n## Test cases\n| ID | F-item |\n|---|---|\n| TC1 | F1 | new | EP | add(2,3) | 5 | P1 |\n"
            "## Test data\nnone\nSUBMIT")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


def commit_file(repo, rel, text, msg="people: change"):
    path = os.path.join(repo, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg)


class FullTeam(Team):
    """Like test_gates.Team, with a spec that has F-items and plans that refer to them."""

    def __init__(self, *rounds, docs=None, judge=""):
        super().__init__(*rounds)
        self.docs = dict({"spec_analyst": SPEC_DOC, "domain_agent": IMPL_DOC, "test_author": TEST_DOC}, **(docs or {}))
        self.judge = judge

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        from line.contracts import LlmResult
        if role == "reviewer":
            self.calls.append((role, key, prompt))
            return LlmResult(None, self.judge or "FINDINGS: none\nSUBMIT", {"input": 1, "output": 1}, 0.05, model, "SUBMIT")
        if role in self.docs:
            self.calls.append((role, key, prompt))
            doc = self.docs[role]
            return LlmResult(None, doc() if callable(doc) else doc, {"input": 1, "output": 1}, 0.1, model, "SUBMIT")
        return super().raw_agentic(role, workdir, prompt, model, max_turns, usd_cap, key)


class DefinitionTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="proc-")
        self.repo = init_target(os.path.join(self.work, "target"))

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def test_seed_applies_by_flow_and_validates(self):
        r = D.select(cfg(), self.repo, "enhancement", {})
        self.assertEqual((r.id, r.source), ("gated-change", "seed"))
        self.assertEqual([s["kind"] for s in r.steps()], ["draft", "draft", "build", "review"])
        self.assertIn("{request}", r.prompt("spec"))
        self.assertIsNone(D.select(cfg(), self.repo, "new-system", {}))

    def test_a_project_overrides_one_gate_from_its_repository(self):
        over = {"id": "gated-change", "extends": "gated-change",
                "steps": [{"id": "plan", "gate": {"decisions": ["approve", "revise", "reject"]}}]}
        commit_file(self.repo, ".dlc/process/gated-change.json", json.dumps(over))
        commit_file(self.repo, ".dlc/prompts/spec.md", "PROJECT SPEC PROMPT {request}")
        r = D.select(cfg(), self.repo, "bug-fix", {})
        self.assertTrue(r.source.startswith("target<seed"), r.source)
        self.assertEqual(r.gate("plan")["decisions"], ["approve", "revise", "reject"])
        self.assertEqual(r.gate("plan")["pass"], ["approve"])                     # the rest of the seed stays
        self.assertEqual(r.prompt("spec"), "PROJECT SPEC PROMPT {request}")

    def test_a_new_process_and_a_dropped_step(self):
        mini = {"id": "spec-only", "extends": "gated-change", "applies": {"flows": ["spec-review"]},
                "steps": [{"id": "plan", "remove": True}, {"id": "build", "remove": True}]}
        commit_file(self.repo, ".dlc/process/spec-only.json", json.dumps(mini))
        r = D.select(cfg(), self.repo, "spec-review", {})
        self.assertEqual([s["id"] for s in r.steps()], ["spec", "final"])

    def test_bad_definitions_say_what_is_wrong(self):
        good = D.select(cfg(), self.repo, "enhancement", {}).data
        for patch, word in (({"steps": [{"id": "spec", "agents": [{"artifact": "nope", "role": "x", "prompt": "spec"}]}]}, "nope"),
                            ({"steps": [{"id": "plan", "gate": {"pass": ["ship"]}}]}, "pass"),
                            ({"steps": [{"id": "spec", "checks": [{"check": "astrology"}]}]}, "astrology"),
                            ({"steps": [{"id": "plan", "gate": {"show": ["secret"]}}]}, "secret")):
            with self.assertRaises(ValueError) as cm:
                D.validate(D.merge(good, patch))
            self.assertIn(word, str(cm.exception))
        with self.assertRaises(ValueError):
            D.select(cfg(), self.repo, "x", {"process": {"id": "p", "extends": "missing"}})

    def test_business_fields_are_checked(self):
        good = D.select(cfg(), self.repo, "enhancement", {}).data
        cases = (
            ({"steps": [{"id": "spec", "gate": {"approvers": ["", "x"]}}]}, "approvers"),
            ({"steps": [{"id": "spec", "gate": {"auto": {"kind": "k"}}}]}, "criteria"),
            ({"steps": [{"id": "spec", "gate": {"auto": {"criteria": "c", "decision": "revise"}}}]}, "auto decision"),
            ({"steps": [{"id": "spec", "gate": {"routes": {"approve": {"back_to": "spec"}}}}]}, "revise decision"),
            ({"steps": [{"id": "plan", "gate": {"routes": {"revise": {"back_to": "final"}}}}]}, "earlier draft"),
            ({"steps": [{"id": "final", "gate": {"decisions": ["deploy", "hold", "redo"], "revise": ["redo"],
                                                 "routes": {"redo": {"back_to": "plan"}}}}]}, "after the build"),
            ({"steps": [{"id": "spec", "checks": [{"check": "judge", "artifact": "spec", "role": "spec_analyst"}]}]},
             "the role that writes it"),
            ({"steps": [{"id": "spec", "gate": {"name": "needs"}}]}, "reserved"),
            ({"needs": [{"id": "n1", "what": "w"}]}, "owner"),
            ({"needs": [{"id": "n1", "what": "w", "owner": "o", "required": "maybe"}]}, "block or warn"),
            ({"steps": [{"id": "spec", "supervisor": 3}]}, "role name"),
        )
        for patch, word in cases:
            with self.assertRaises(ValueError, msg=word) as cm:
                D.validate(D.merge(good, patch))
            self.assertIn(word, str(cm.exception))

    def test_a_need_can_be_limited_to_some_flows(self):
        from line.process import needs as N
        r = D.select(cfg(), self.repo, "x", {"process": D.merge(D.select(cfg(), self.repo, "enhancement", {}).data, {
            "needs": [{"id": "all", "what": "w", "owner": "o"},
                      {"id": "key", "what": "k", "owner": "o", "flows": ["Enhancement"]}]})})
        self.assertEqual([n["id"] for n in N.collect(r, "enhancement")], ["all", "key"])
        self.assertEqual([n["id"] for n in N.collect(r, "bug-fix")], ["all"])
        self.assertEqual([n["id"] for n in N.collect(r)], ["all", "key"])      # no flow (readiness): every need

    def test_catalog_lists_definitions(self):
        rows = D.catalog(cfg(), self.repo)
        self.assertIn("gated-change", [x["id"] for x in rows])


class ArtifactsAndChecksTest(unittest.TestCase):
    def setUp(self):
        self.r = D.select(cfg(), "", "enhancement", {})

    def test_items_refs_fields(self):
        spec = self.r.artifact("spec")
        self.assertEqual(A.ids(SPEC_DOC, spec["items"]), ["F1", "F2"])
        self.assertEqual(A.fields(SPEC_DOC, spec), {"domains": "calculator"})
        self.assertTrue(A.document("chatter\n" + SPEC_DOC, spec).startswith("# Spec: add"))
        self.assertEqual(A.ids(TEST_DOC, self.r.artifact("tests")["cases"]), ["TC1"])

    def test_coverage_and_sections(self):
        ctx = C.Ctx(self.r, {"spec": SPEC_DOC, "impl": IMPL_DOC, "tests": TEST_DOC})
        cov = C.run({"check": "coverage", "from": "spec", "to": ["impl", "tests"]}, ctx)
        self.assertEqual(sorted(f["text"].split()[-1] for f in cov), ["F2", "F2"])     # F1 covered by both
        sec = C.run({"check": "sections", "artifact": "impl", "sections": ["Steps", "Rollback"]}, ctx)
        self.assertEqual([f["text"] for f in sec], ['missing section "Rollback"'])

    def test_in_diff(self):
        ctx = C.Ctx(self.r, {"tests": TEST_DOC}, diff="+++ b/tests/test_calc.py\n+    def test_TC1_add(self):\n")
        self.assertEqual(C.run({"check": "in_diff", "artifact": "tests", "pattern_from": "cases", "paths": "test"}, ctx), [])
        ctx.diff = "+++ b/calc.py\n+# TC1\n"
        self.assertEqual(len(C.run({"check": "in_diff", "artifact": "tests", "pattern_from": "cases", "paths": "test"}, ctx)), 1)

    def test_judge_runs_only_with_rules(self):
        ctx = C.Ctx(self.r, {"spec": SPEC_DOC}, pipe=None, rules_reader=lambda p: "")
        self.assertEqual(C.run({"check": "judge", "artifact": "spec"}, ctx), [])

    def test_judge_reads_rules_from_the_knowledge_store(self):
        class Rag:
            def retrieve(self, role, step, stack, max_chars, query=""):
                self.asked = (role, step, query)
                return [{"text": "- Every endpoint checks the caller's role."}]

        class Llm:
            def agentic(self, role, wt, prompt, turns, usd, key, run):
                self.prompt = prompt
                from line.contracts import LlmResult
                return LlmResult(None, "FINDING: warn | Every endpoint checks the caller's role. | add() | no role\nSUBMIT",
                                 {}, 0.01, "m", "SUBMIT")

        class Pipe:
            run, workdir, rag, llm = "R1", ".", Rag(), Llm()

            def _charge_stage(self):
                pass

        pipe = Pipe()
        ctx = C.Ctx(self.r, {"spec": SPEC_DOC}, pipe=pipe, gate="spec", rules_reader=lambda p: "")
        out = C.run({"check": "judge", "artifact": "spec", "rules": {"store": {"query": "security rules"}}}, ctx)
        self.assertEqual(pipe.rag.asked, ("reviewer", "spec", "security rules"))
        self.assertIn("caller's role", pipe.llm.prompt)
        self.assertEqual([(f["severity"], f["check"]) for f in out], [("warn", "judge")])

    def test_render_leaves_unknown_names_empty(self):
        self.assertEqual(C.render("a {x} b {nope} {{lit}}", {"x": 1}), "a 1 b  {lit}")


class LivingSpecFlowTest(unittest.TestCase):
    """The seed flow end to end with a spec that has F-items: artifacts in the repo, the index, drift next time."""

    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="proc-flow-")
        self.pack = os.path.join(self.work, "pack")
        write(self.pack, "spec.md", "# Add\n\nA function add(a, b) in calc.py returning a + b, with tests.\n")
        write(self.pack, "pack.json", '{"id": "calc", "title": "Calc", "kind": "enhance", "files": ["spec.md"]}')
        self.cfg = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                       solo="1", max_usd_run=20, deploy_windows=[])
        self.store = SqliteStore(self.cfg.db)
        self.target = init_target(os.path.join(self.work, "target"))

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def _run(self, backend, **detail):
        p = Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=backend))
        run = p.admit(self.pack, self.target)
        update_row(self.store, E_RUN, run, {"detail": dict(self.store.get(E_RUN, run)["detail"], level="2",
                                                           flow="enhancement", **detail)})
        self.backend = backend
        return run, self._drive(run)

    def _drive(self, run):
        p = Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=self.backend))
        return p.drive(run)

    def _decide(self, run, gate, decision, **body):
        gates.decide(self.store, self.cfg, run, gate, dict(body, decision=decision), "tester")
        return self._drive(run)

    def _through(self, backend, **detail):
        run, row = self._run(backend, **detail)
        self._decide(run, "spec", "approve")
        row = self._decide(run, "plan", "approve")
        return run, row

    def test_artifacts_and_index_live_in_the_target(self):
        run, row = self._through(FullTeam(CODE, FIXED))
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        checks = row["detail"]["gated"]["checks"]
        self.assertIn("F2", " ".join(f["text"] for f in checks["plan"]))          # F2 is in no plan: a warning
        final = attention.view(self.store, run)["gate"]
        self.assertTrue(final["process"].startswith("gated-change@"))
        self.assertTrue(final["review"])
        row = self._decide(run, "final", "deploy")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        spec_md = git(self.target, "show", "main:.dlc/changes/%s/spec.md" % run)
        self.assertIn("### F1 add returns the sum", spec_md)
        index = json.loads(git(self.target, "show", "main:.dlc/index.json"))
        self.assertEqual(index["items"]["%s:F1" % run]["files"], ["calc.py"])
        self.assertEqual(index["items"]["%s:F2" % run]["files"], [])
        self.assertEqual(T.drift(self.target), [])                               # nothing moved yet

        commit_file(self.target, "calc.py", "def add(a, b):\n    return b + a\n", "people: reorder add")
        rows = T.drift(self.target)
        self.assertEqual([r["item"] for r in rows], ["%s:F1" % run])
        self.assertIn("people: reorder add", rows[0]["commits"][0])

        run2, row2 = self._run(FullTeam(CODE, FIXED))                            # the next run sees it
        spec_prompt = [p for r, _k, p in self.backend.calls if r == "spec_analyst"][0]
        self.assertIn("EARLIER SPEC ITEMS THE CODE HAS MOVED AWAY FROM", spec_prompt)
        self.assertIn("%s:F1" % run, spec_prompt)
        self.assertIn("drift", [d["id"] for d in attention.view(self.store, run2)["gate"]["docs"]])

    def test_gate_conditions_join_the_spec_and_settle_the_findings(self):
        run, row = self._run(FullTeam(CODE, FIXED))
        self._decide(run, "spec", "approve", note="Rounding is not needed: ints stay ints.")
        row = self._decide(run, "plan", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        gated = row["detail"]["gated"]
        self.assertEqual([(f["id"], f["status"]) for f in gated["findings"] if f["kind"] == "business"],
                         [("D1", "settled at gate spec")])                  # the agent's 'rounding: none needed'
        self.assertEqual(gated["metrics"]["build"]["decisions_outside_plan"], 0)
        row = self._decide(run, "final", "deploy")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        spec_md = git(self.target, "show", "main:.dlc/changes/%s/spec.md" % run)
        self.assertIn(T.SETTLED, spec_md)
        self.assertIn("- gate spec, approved by tester: Rounding is not needed: ints stay ints.", spec_md)
        self.assertNotIn(T.SETTLED, git(self.target, "show", "main:.dlc/changes/%s/impl.md" % run))

    def test_settled_at_needs_the_note_to_say_it(self):
        notes = [{"gate": "spec", "note": "Q3: the footer stays at the window bottom on short pages."},
                 {"gate": "plan", "note": "R1 exception: POST /loi-nhan is the only public write route."}]
        self.assertEqual(gates.settled_at("footer at the window bottom", notes), "spec")
        self.assertEqual(gates.settled_at("R1: kept the public route for messages", notes), "plan")
        self.assertEqual(gates.settled_at("stored sessions in SQLite with WAL", notes), "")
        self.assertEqual(gates.settled_at("F2 kept as is", notes), "")             # no shared reference or words
        self.assertEqual(gates.settled_at("anything", []), "")

    def test_long_decisions_that_cite_the_approver_are_settled(self):
        # run R20261025-153358-b293: the approver's conditions came back as 'needs a person'
        notes = [{"gate": "spec", "note": "Approved. Conditions: take the woff2 files from the @fontsource/"
                  "cormorant-garamond npm package (its vietnamese, latin-ext and latin subsets; OFL licence file "
                  "kept next to them) rather than downloading by hand, and do not leave the package as a runtime "
                  "dependency."},
                 {"gate": "plan", "note": "Approved both plans. Check criterion 7 with headless Chrome over CDP; set "
                  "build.assetsInlineLimit so fonts are never inlined."}]
        d1 = ("Where the fonts come from: I copied them from `@fontsource/cormorant-garamond` 5.3.0 using `npm pack`, "
              "without saving it as a dependency, as the spec approver required.")
        d3 = ("Inlining: I set `build.assetsInlineLimit: 0`, as the plan approver asked. The Vietnamese files are about "
              "6 KB, just over Vite's 4 KB default.")
        d7 = ("Visual check: I checked only the home heading, at both widths. Other --serif text (post titles, quotes, "
              "admin) and the visual audit across page types were not checked.")
        self.assertEqual(gates.settled_at(d1, notes), "spec")
        self.assertEqual(gates.settled_at(d3, notes), "plan")
        self.assertEqual(gates.settled_at(d7, notes), "")                          # a real finding stays

    def test_project_constitution_is_judged_and_a_block_goes_back(self):
        commit_file(self.target, ".dlc/constitution.md", "- Money is never a float.\n")
        drafts = iter(["# Spec: add\n## Spec\n### F1 price as float\n## Domains\n- billing\nSUBMIT", SPEC_DOC])
        judge = ("FINDING: block | Money is never a float. | price as float | use decimal cents\nSUBMIT")
        team = FullTeam(CODE, FIXED, docs={"spec_analyst": lambda: next(drafts)}, judge=judge)
        run, row = self._run(team)
        roles = [r for r, *_ in team.calls]
        self.assertEqual(roles[:4], ["spec_analyst", "reviewer", "spec_analyst", "reviewer"])
        again = [p for r, k, p in team.calls if r == "spec_analyst"][1]
        self.assertIn("CHECKS ON YOUR LAST DRAFT FAILED", again)
        self.assertIn("Money is never a float.", [p for r, _k, p in team.calls if r == "reviewer"][0])
        checks = row["detail"]["gated"]["checks"]["spec"]
        self.assertTrue(any(f["check"] == "judge" for f in checks))              # still blocked after 1 retry: shown
        self.assertIn("checks", [d["id"] for d in attention.view(self.store, run)["gate"]["docs"]])

    def test_a_run_may_name_its_process(self):
        lean = {"id": "lean", "extends": "gated-change",
                "steps": [{"id": "plan", "remove": True}, {"id": "spec", "checks": []}]}
        run, row = self._run(FullTeam(CODE, FIXED), process=lean)
        self.assertEqual(row["detail"]["gated"]["process"]["id"], "lean")
        row = self._decide(run, "spec", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        self.assertNotIn("domain_agent", [r for r, *_ in self.backend.calls])

    def test_a_project_gates_new_system_runs_by_data_alone(self):
        commit_file(self.target, ".dlc/process/gated-change.json", json.dumps(
            {"id": "gated-change", "extends": "gated-change", "applies": {"flows": ["new-system"]}}))
        p = Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=FullTeam(CODE, FIXED)))
        run = p.admit(self.pack, self.target)
        update_row(self.store, E_RUN, run, {"detail": dict(self.store.get(E_RUN, run)["detail"], level="2",
                                                           flow="new-system")})
        row = p.drive(run)
        self.assertEqual(row["detail"]["gate"]["name"], "spec", row["detail"].get("escalation"))
        self.assertTrue(row["detail"]["gated"]["process"]["source"].startswith("target"))

    def test_a_definition_that_cannot_run_stops_the_run(self):
        run, row = self._run(FullTeam(CODE, FIXED), process={"id": "broken", "extends": "nowhere"})
        self.assertEqual(row["state"], "escalated")
        self.assertIn("cannot run", row["detail"]["escalation"]["message"])


if __name__ == "__main__":
    unittest.main()
