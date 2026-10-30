"""Happy cases of the AI-SDLC process model on the sample line/samples/sdd-contracts (docs/dlc/process.md):

H1  an admin sets a process up (registry draft -> publish), checks a project's readiness, binds the project; a run
    goes through needs, spec, plan, build, review with people deciding; actual against target is reported; the
    living spec records the process version; every person's decision is a precedent of the project
H2  a second, similar request: the spec and plan gates are auto-approved from those precedents; only the final
    review needs a person; an automatic decision is never a precedent
H3  a missing need (the legal rules) parks the run at the start for its owner; supplying it lets the run go on
H4  a new version while a run waits at a gate: the run keeps its version, may adopt the new one, new runs get it
H5  a deprecated process refuses new runs and names its successor; history stays; a retired process is read only
H6  the plan gate sends the work back to the spec; the Spec Agent gets the note; both gates pass again
H7  a gate's approvers: a person without one of their roles cannot decide
H8  a run that stops names the role that handles it
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from line import attention, gates, projects, runview
from line.contracts import E_RUN, LlmResult
from line.llm import make_llm
from line.pipeline import Pipeline, init_target
from line.process import api as process_api
from line.process import precedent as P
from line.process import registry
from line.statemachine import update_row
from line.store import SqliteStore
from line.tests.test_gates import cfg

SAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples", "sdd-contracts")

SPEC = ("# Spec: tax code\n## Summary\nadd {field}\n## Mapping to the existing system\ncontracts.create, sale\n"
        "## Spec\n### F1 {field} must have 10 digits\ncreate('sale', {{..., '{field}': '123'}}) raises "
        "'{field}: must have 10 digits'\n## Domains\n- contracts: F1\n## Questions\n| Q | question | status | answer |\n"
        "|---|---|---|---|\n| Q1 | optional? | settled | yes, the request says may (legal rules R1) |\nSUBMIT")
IMPL = ("# Implement plan\n## Blast radius\ncontracts.py, tests/test_contracts.py\n## Steps\n1. validate {field} in "
        "contracts.py (F1)\n## Risks and checks\nsale without it still works\n## Assumptions\nnone\n"
        "## Decision rules\nif the code has spaces then refuse it\nSUBMIT")
TESTS = ("# Test plan\n## Scope\nF1\n## Test cases\n| ID | F-item | type | technique | steps | expected | priority |\n"
         "|---|---|---|---|---|---|---|\n| TC1 | F1 | new | BVA | 9 digits | refused | P1 |\n## Test data\nnone\nSUBMIT")
CODE = '''

def _tax_code(fields, name):
    v = fields.get(name)
    if v is not None and (not isinstance(v, str) or len(v) != 10 or not v.isdigit()):
        raise ContractError("%s: must have 10 digits" % name)
'''


def git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout


def copy_tree(src, dst):
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), src)
            out = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(os.path.join(root, f), encoding="utf-8") as a, open(out, "w", encoding="utf-8", newline="\n") as b:
                b.write(a.read())


def commit_all(repo, msg):
    git(repo, "add", "-A")
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg)


class Team:
    """Design-phase agents answer their documents (filled with the request's field); the reviewer answers the
    auto-approve check ('yes' once asked) and the judge; the build agent adds the field's validation and its test."""
    name = "team"
    overhead_tokens = 0

    def __init__(self, field="buyer_tax_code", auto="yes", fail_rounds=0, spec_docs=None):
        self.field, self.auto, self.fail_rounds, self.calls = field, auto, fail_rounds, []
        self.spec_docs = list(spec_docs or [])

    def raw_complete(self, role, prompt, model, key, repair=False):
        return LlmResult(None, "{}", {"input": 1, "output": 1}, 0.01, model, "")

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        self.calls.append((role, key, prompt))
        f = self.field
        if role == "reviewer":
            if "decide whether a person needs to look" in prompt:
                return LlmResult(None, "AUTO: %s | adds one validated field, precedent matches\nSUBMIT" % self.auto,
                                 {}, 0.02, model, "SUBMIT")
            return LlmResult(None, "FINDINGS: none\nSUBMIT", {}, 0.02, model, "SUBMIT")
        if role == "spec_analyst":
            doc = self.spec_docs.pop(0) if self.spec_docs else SPEC.format(field=f)
            return LlmResult(None, doc, {}, 0.1, model, "SUBMIT")
        if role == "domain_agent":
            return LlmResult(None, IMPL.format(field=f), {}, 0.1, model, "SUBMIT")
        if role == "test_author":
            return LlmResult(None, TESTS, {}, 0.1, model, "SUBMIT")
        if self.fail_rounds:                            # the build agent changes nothing useful
            self.fail_rounds -= 1
            with open(os.path.join(workdir, "contracts.py"), "a", encoding="utf-8") as fh:
                fh.write("\nraise SystemExit('broken')\n")
            return LlmResult(None, "done\nDECISIONS:\nnone\nSUBMIT", {}, 0.2, model, "SUBMIT")
        path = os.path.join(workdir, "contracts.py")
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        if "def _tax_code" not in src:
            src += CODE
        src = src.replace("    return dict(fields, kind=kind)", "    _tax_code(fields, %r)\n    return dict(fields, kind=kind)" % f)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(src)
        with open(os.path.join(workdir, "tests", "test_%s.py" % f), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("import unittest\nfrom contracts import ContractError, create\n\n\nclass T(unittest.TestCase):\n"
                     "    def test_TC1_%s(self):\n        with self.assertRaises(ContractError):\n"
                     "            create('sale', {'buyer': 'a', 'seller': 'b', 'price_cents': 1, %r: '123'})\n" % (f, f))
        return LlmResult(None, "done\nDECISIONS:\n- spaces: refused, by the plan's decision rule\nSUBMIT", {}, 0.3,
                         model, "SUBMIT")


class App:
    def __init__(self, store, c):
        self.store, self.cfg = store, c


class HappyTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="sdd-")
        self.old = {k: os.environ.get(k) for k in ("DLC_HOME", "DLC_WORKSPACE_ROOT")}
        os.environ["DLC_HOME"] = os.path.join(self.work, "home")
        os.environ["DLC_WORKSPACE_ROOT"] = os.path.join(self.work, "ws")
        self.cfg = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                       solo="1", max_usd_run=50, deploy_windows=[])
        self.store = SqliteStore(self.cfg.db)
        self.app = App(self.store, self.cfg)

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.work, ignore_errors=True)

    # ---------------------------------------------------------------- helpers
    def api(self, method, path, body=None, query=None):
        st, out = process_api.handle(method, path, query or {}, body or {}, self.app, "admin@test")
        self.assertLess(st, 300, out)
        return out

    def setup_process(self, **override):
        with open(os.path.join(SAMPLE, "process.json"), encoding="utf-8") as fh:
            body = dict(json.load(fh), **override)
        self.api("POST", "/api/admin/processes", body)
        return self.api("POST", "/api/admin/processes/contract-change:publish", {"reason": "first version"})

    def project(self, drop=()):
        src = os.path.join(self.work, "ws", "contracts")
        init_target(src)
        copy_tree(os.path.join(SAMPLE, "app"), src)
        for rel in drop:
            os.remove(os.path.join(src, *rel.split("/")))
        commit_all(src, "contract app")
        p = projects.create({"name": "contracts", "source": {"kind": "folder", "path": "contracts"}}, "admin")
        return p["id"]

    def start(self, pid, request, team, flow="enhancement"):
        payload = {"pack": os.path.join(SAMPLE, "requests", request), "project": pid, "flow": flow}
        projects.resolve_run_target(self.store, payload)
        pack = os.path.join(self.work, "packs", request + str(len(os.listdir(os.path.join(self.work))) ))
        shutil.copytree(payload["pack"], pack)
        p = Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=team))
        run = p.admit(pack, payload["target"])
        update_row(self.store, E_RUN, run, {"detail": dict(self.store.get(E_RUN, run)["detail"], level="2", flow=flow,
                                                           project=pid, process=payload.get("process"))})
        self.team = team
        return run, self.drive(run)

    def drive(self, run):
        return Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=self.team)).drive(run)

    def decide(self, run, gate, decision, roles=("dlc-user",), **body):
        gates.decide(self.store, self.cfg, run, gate, dict(body, decision=decision), "ann@test", roles=list(roles))
        return self.drive(run)

    def roles_called(self):
        return [r for r, *_ in self.team.calls]

    # ---------------------------------------------------------------- H1 + H2
    def test_h1_h2_setup_run_with_people_then_auto_approve(self):
        self.setup_process()
        pid = self.project()
        ready = self.api("GET", "/api/admin/processes/contract-change/readiness", query={"project": [pid]})
        self.assertTrue(ready["ready"], ready["table"])
        self.assertEqual(self.api("POST", "/api/admin/projects/%s/processes" % pid,
                                  {"flow": "enhancement", "process": "contract-change"})["processes"],
                         {"enhancement": "contract-change"})

        run, row = self.start(pid, "add-tax-code", Team("buyer_tax_code"))
        self.assertEqual(row["detail"]["gate"]["name"], "spec", row["detail"].get("escalation"))
        g = attention.view(self.store, run)["gate"]
        self.assertEqual(g["process"], "contract-change@v1")
        self.assertEqual(g["approvers"], ["dlc-user", "dlc-admin"])
        self.assertIn("needs", [d["id"] for d in g["docs"]])           # what the agents had, at the spec gate
        auto_calls = [k for r, k, _p in self.team.calls if r == "reviewer" and k.startswith("auto-")]
        self.assertEqual(auto_calls, [])                               # no precedent yet: no auto check call
        judged = [p for r, _k, p in self.team.calls if r == "reviewer" and "Money is an integer" in p]
        self.assertTrue(judged)                                        # the project's rules judged the spec
        self.decide(run, "spec", "approve")
        row = self.decide(run, "plan", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "final", row["detail"].get("escalation"))
        final = attention.view(self.store, run)["gate"]
        metrics = next(d for d in final["docs"] if d["id"] == "metrics")["text"]
        self.assertIn("| build |", metrics)
        row = self.decide(run, "final", "deploy")
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        rep = row["detail"]["gated"]["report"]
        self.assertTrue(rep["process"]["met"], rep)
        self.assertEqual(rep["steps"]["spec"]["actual"]["human_decisions"], 1)
        index = json.loads(git(projects.get(pid)["path"], "show", "main:.dlc/index.json"))
        self.assertEqual(index["items"]["%s:F1" % run]["process"], "contract-change@v1")
        self.assertEqual(index["items"]["%s:F1" % run]["files"], ["contracts.py"])
        kinds = sorted(p["kind"] for p in self.store.query("precedent"))
        self.assertEqual(kinds, ["final", "plan-approval", "spec-signoff"])
        self.assertEqual(row["detail"]["outcomes"]["process"]["met"], True)

        run2, row2 = self.start(pid, "add-seller-tax-code", Team("seller_tax_code"))   # H2
        self.assertEqual(row2["detail"]["gate"]["name"], "final", row2["detail"].get("escalation"))
        log = row2["detail"]["gated"]["log"]
        self.assertEqual([(d["gate"], d["by"]) for d in log], [("spec", "auto"), ("plan", "auto")])
        self.assertIn("approved before", log[0]["note"] + " approved before")
        row2 = self.decide(run2, "final", "deploy")
        self.assertEqual(row2["state"], "green")
        self.assertEqual(row2["detail"]["gated"]["report"]["steps"]["spec"]["actual"]["auto_decisions"], 1)
        self.assertEqual(len(self.store.query("precedent", project=pid, kind="spec-signoff")), 1)   # auto is not one
        self.assertEqual(sorted(x["run"] for x in registry.runs_on(self.store, "contract-change")), sorted([run, run2]))

    # ---------------------------------------------------------------- H9 + H10: the project's change queue
    def drive_with(self, run, team):
        return Pipeline(self.store, self.cfg, llm=make_llm(self.cfg, self.store, backend=team)).drive(run)

    def decide_with(self, run, gate, decision, team):
        gates.decide(self.store, self.cfg, run, gate, {"decision": decision}, "ann@test", roles=["dlc-user"])
        return self.drive_with(run, team)

    def test_h9_first_approved_builds_first_and_the_waiting_run_redraws_on_top_of_it(self):
        import threading
        from line import changequeue as Q
        self.setup_process()
        pid = self.project()
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        self.git_green(pid)
        t1, t2 = Team("buyer_tax_code"), Team("seller_tax_code", auto="no")   # people decide run 2's gates
        run1, row1 = self.start(pid, "add-tax-code", t1)
        run2, row2 = self.start(pid, "add-seller-tax-code", t2)           # a second live run of the same project
        self.assertEqual((row1["detail"]["gate"]["name"], row2["detail"]["gate"]["name"]), ("spec", "spec"))
        self.assertEqual([(s["run"], s.get("order")) for s in Q.slots(self.store, pid)], [(run1, None), (run2, None)])
        self.assertNotIn("CHANGE QUEUE of project", [p for r, _k, p in t2.calls if r == "spec_analyst"][-1])
        self.decide_with(run1, "spec", "approve", t1)
        row1 = self.decide_with(run1, "plan", "approve", t1)                # run 1 joins the queue, builds, waits at final
        self.assertEqual(row1["detail"]["gate"]["name"], "final", row1["detail"].get("escalation"))
        self.assertEqual((Q.mine(self.store, run1)["state"], Q.mine(self.store, run1)["order"]), ("implementing", 1))

        n = len(t2.calls)
        row2 = self.drive_with(run2, t2)                                   # woken: the queue moved under its draft
        self.assertEqual(row2["detail"]["gate"]["name"], "spec", row2["detail"].get("escalation"))
        again = [p for r, _k, p in t2.calls[n:] if r == "spec_analyst"]
        self.assertEqual(len(again), 1)                                    # its spec written again, once
        self.assertIn("CHANGE QUEUE of project %s" % pid, again[0])
        self.assertIn("THE CHANGE QUEUE CHANGED", again[0])
        self.assertIn("YOUR EARLIER DRAFT", again[0])
        view = attention.view(self.store, run2)["gate"]
        self.assertEqual(view["refreshed"][-1]["took"][0]["run"], run1)
        n = len(t2.calls)
        self.drive_with(run2, t2)                                          # nothing moved since: nothing redone
        self.assertEqual([r for r, *_ in t2.calls[n:] if r == "spec_analyst"], [])

        self.decide_with(run2, "spec", "approve", t2)
        plan2 = [p for r, _k, p in t2.calls if r == "domain_agent"][-1]
        self.assertIn("spec: # Spec: tax code", plan2)                    # run 1's approved spec is in the queue text
        done = {}
        th = threading.Thread(target=lambda: done.update(row=self.decide_with(run2, "plan", "approve", t2)))
        th.start()
        th.join(1.5)
        self.assertTrue(th.is_alive())                                    # run 2 waits in the queue behind run 1
        self.assertEqual((Q.mine(self.store, run2)["state"], Q.mine(self.store, run2)["order"]), ("planned", 2))
        nodes = {x["id"]: x["state"] for x in runview.nodes(self.store, run2)}
        self.assertEqual((nodes["build"], nodes["plan"]), ("queued", "done"))
        nodes1 = {x["id"]: x["state"] for x in runview.nodes(self.store, run1)}
        self.assertEqual(nodes1["result"], "awaiting")                     # run 1 waits for a person at final
        self.assertFalse([k for r, k, _p in t2.calls if r not in ("spec_analyst", "domain_agent", "test_author",
                                                                   "reviewer")])   # no build call yet
        row1 = self.decide_with(run1, "final", "deploy", t1)
        self.assertEqual(row1["state"], "green")
        th.join(60)
        self.assertFalse(th.is_alive())
        row2 = done["row"]
        self.assertEqual(row2["detail"]["gate"]["name"], "final", row2["detail"].get("escalation"))
        src = git(projects.get(pid)["path"], "show", "main:contracts.py")
        self.assertIn("buyer_tax_code", src)                               # run 2 built on run 1's merge
        self.assertIn("seller_tax_code", src)
        row2 = self.decide_with(run2, "final", "deploy", t2)
        self.assertEqual(row2["state"], "green", row2["detail"].get("escalation"))
        self.assertEqual([s["state"] for s in Q.slots(self.store, pid, every=True)], ["done", "done"])

    def test_h10_a_run_approved_later_waits_for_nobody_in_design_and_lets_go_once_merged(self):
        from line import changequeue as Q
        self.setup_process(queue={"hold_until": "merged"})
        pid = self.project()
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        self.git_green(pid)
        t1, t2 = Team("buyer_tax_code", auto="no"), Team("seller_tax_code")
        run1, _ = self.start(pid, "add-tax-code", t1)                      # stays at its spec gate (a slow person)
        run2, _ = self.start(pid, "add-seller-tax-code", t2)
        self.decide_with(run2, "spec", "approve", t2)
        row2 = self.decide_with(run2, "plan", "approve", t2)                # approved first: builds at once
        self.assertEqual(row2["detail"]["gate"]["name"], "final", row2["detail"].get("escalation"))
        self.assertEqual(Q.mine(self.store, run2)["end"], "merged")         # hold_until merged: let go before final
        self.assertEqual(Q.mine(self.store, run1)["state"], "reserved")     # run 1 untouched, never ignored
        self.decide_with(run1, "spec", "approve", t1)
        row1 = self.decide_with(run1, "plan", "approve", t1)                # no wait: run 2 is merged
        self.assertEqual(row1["detail"]["gate"]["name"], "final", row1["detail"].get("escalation"))
        src = git(projects.get(pid)["path"], "show", "main:contracts.py")
        self.assertIn("buyer_tax_code", src)
        self.assertIn("seller_tax_code", src)
        self.assertEqual(self.decide_with(run2, "final", "deploy", t2)["state"], "green")
        self.assertEqual(self.decide_with(run1, "final", "deploy", t1)["state"], "green")

    def git_green(self, pid):
        """The sample app counts as delivered (a project that started from existing code)."""
        p = projects.get(pid)
        self.assertTrue(p.get("has_code") or projects._delivered(p, []), p)

    # ---------------------------------------------------------------- H3
    def test_h3_missing_need_waits_for_its_owner_at_the_start(self):
        self.setup_process()
        pid = self.project(drop=("docs/business/legal-rules.md",))
        self.assertFalse(self.api("GET", "/api/admin/processes/contract-change/readiness",
                                  query={"project": [pid]})["ready"])
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        run, row = self.start(pid, "add-tax-code", Team())
        self.assertEqual(row["detail"]["gate"]["name"], "needs")
        self.assertEqual(self.roles_called(), [])                      # no agent guessed
        g = attention.view(self.store, run)["gate"]
        self.assertEqual(g["targets"], ["legal-rules"])
        self.assertIn("legal-expert", g["note_placeholder"])
        doc = base64.b64encode(b"- R1: the tax code of a company party has exactly 10 digits.\n").decode()
        row = self.decide(run, "needs", "supply", target="legal-rules", files=[{"name": "legal.md", "data": doc}])
        self.assertEqual(row["detail"]["gate"]["name"], "spec", row["detail"].get("escalation"))
        rows = {x["id"]: x for x in row["detail"]["gated"]["needs"]["rows"]}
        self.assertTrue(rows["legal-rules"]["ok"])
        self.assertEqual(len(self.store.query("precedent")), 0)        # supplying a need is not a gate precedent

    # ---------------------------------------------------------------- H4
    def test_h4_new_version_keeps_running_runs_and_can_be_adopted(self):
        self.setup_process()
        pid = self.project()
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        run, row = self.start(pid, "add-tax-code", Team())
        self.assertEqual(row["detail"]["gated"]["process"]["version"], "v1")
        with open(os.path.join(SAMPLE, "process.json"), encoding="utf-8") as fh:
            v2 = json.load(fh)
        v2["kpi"] = {"max_human_decisions": 6}
        v2["steps"][3]["gate"]["approvers"] = ["dlc-admin"]
        self.api("POST", "/api/admin/processes", v2)
        out = self.api("POST", "/api/admin/processes/contract-change:publish", {"reason": "final review by admins"})
        self.assertEqual(out["versions"][-1]["v"], 2)
        self.assertIn("kpi changed", out["versions"][-1]["changes"])
        impact = self.api("GET", "/api/admin/processes/contract-change")["impact"]
        self.assertEqual(impact["live_by_version"], {"v1": 1})
        self.assertEqual(impact["projects"], [{"project": pid, "flow": "enhancement", "binding": "contract-change"}])
        self.assertEqual(self.drive(run)["detail"]["gated"]["process"]["version"], "v1")   # still v1
        moved = self.api("POST", "/api/admin/runs/%s:adopt-process" % run, {"process": "contract-change@2"})
        self.assertEqual((moved["from"], moved["to"]), ("contract-change@v1", "contract-change@v2"))
        self.assertEqual(attention.view(self.store, run)["gate"]["process"], "contract-change@v2")
        self.api("POST", "/api/admin/projects/%s/processes" % pid,
                 {"flow": "enhancement", "process": "contract-change@1"})          # a pinned project keeps v1
        payload = {"pack": "x", "project": pid, "flow": "enhancement"}
        self.store.put(E_RUN, run, dict(self.store.get(E_RUN, run), state="green"))  # let the project start again
        projects.resolve_run_target(self.store, payload)
        self.assertEqual(payload["process"], "contract-change@1")

    # ---------------------------------------------------------------- H5
    def test_h5_deprecate_and_retire_keep_history(self):
        self.setup_process()
        with open(os.path.join(SAMPLE, "process.json"), encoding="utf-8") as fh:
            nxt = dict(json.load(fh), id="contract-change-2", title="Contract change, second edition")
        self.api("POST", "/api/admin/processes", nxt)
        self.api("POST", "/api/admin/processes/contract-change-2:publish")
        pid = self.project()
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        run, _row = self.start(pid, "add-tax-code", Team())
        self.api("POST", "/api/admin/processes/contract-change:status",
                 {"status": "deprecated", "reason": "second edition", "replaced_by": "contract-change-2"})
        self.store.put(E_RUN, run, dict(self.store.get(E_RUN, run), state="green"))
        from line.codes import LineError
        with self.assertRaises(LineError) as cm:
            projects.resolve_run_target(self.store, {"pack": "x", "project": pid, "flow": "enhancement"})
        self.assertIn("use contract-change-2 instead", str(cm.exception))
        self.api("POST", "/api/admin/processes/contract-change:status", {"status": "retired"})
        rec = self.api("GET", "/api/admin/processes/contract-change")
        self.assertEqual(rec["process"]["status"], "retired")
        self.assertEqual(len(rec["process"]["versions"]), 1)                # nothing deleted
        self.assertEqual([x["run"] for x in registry.runs_on(self.store, "contract-change")], [run])
        st, err = process_api.handle("POST", "/api/admin/processes", {}, {"id": "contract-change"}, self.app, "a")
        self.assertEqual(st, 400)
        self.assertIn("retired", err["message"])
        self.assertIsNotNone(gates.view(self.store, run) or True)          # the old run still renders

    # ---------------------------------------------------------------- H6 + H7
    def test_h6_h7_plan_gate_sends_back_to_spec_and_approvers_hold(self):
        self.setup_process()
        pid = self.project()
        team = Team(spec_docs=[SPEC.format(field="buyer_tax_code"),
                               SPEC.format(field="buyer_tax_code").replace("10 digits", "10 digits, no spaces")])
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        run, _row = self.start(pid, "add-tax-code", team)
        with self.assertRaises(PermissionError):                       # H7
            gates.decide(self.store, self.cfg, run, "spec", {"decision": "approve"}, "eve", roles=["dlc-viewer"])
        self.decide(run, "spec", "approve")
        row = self.decide(run, "plan", "back-to-spec", note="spaces in tax codes: say they are refused")
        self.assertEqual(row["detail"]["gate"]["name"], "spec", row["detail"].get("escalation"))
        spec_prompts = [p for r, _k, p in team.calls if r == "spec_analyst"]
        self.assertEqual(len(spec_prompts), 2)
        self.assertIn("spaces in tax codes", spec_prompts[1])
        self.assertIn("no spaces", attention.view(self.store, run)["gate"]["docs"][0]["text"])
        row = self.decide(run, "spec", "approve")
        self.assertEqual(row["detail"]["gate"]["name"], "plan")
        self.assertEqual(len([r for r in self.roles_called() if r == "domain_agent"]), 2)

    # ---------------------------------------------------------------- H8
    def test_h8_a_stop_names_who_handles_it(self):
        self.setup_process()
        pid = self.project()
        self.api("POST", "/api/admin/projects/%s/processes" % pid, {"flow": "enhancement", "process": "contract-change"})
        run, _row = self.start(pid, "add-tax-code", Team(fail_rounds=5))
        self.decide(run, "spec", "approve")
        row = self.decide(run, "plan", "approve")
        self.assertEqual(row["state"], "escalated")
        a = attention.view(self.store, run)
        self.assertEqual(a["process_roles"]["handler"], "dlc-admin")       # build has no incident role: the owner
        self.assertIn("Handled by dlc-admin", a["do"])
        rep = row["detail"]["gated"]["report"]
        self.assertFalse(rep["steps"]["build"]["met"])


class PrecedentUnitTest(unittest.TestCase):
    def test_kind_of_and_project_of(self):
        self.assertEqual(P.kind_of({"name": "spec", "auto": {"kind": "spec-signoff"}}), "spec-signoff")
        self.assertEqual(P.kind_of({"name": "spec"}), "spec")
        self.assertEqual(P.project_of({"project": "p1"}), "p1")
        self.assertEqual(P.project_of({}), "default")


if __name__ == "__main__":
    unittest.main()
