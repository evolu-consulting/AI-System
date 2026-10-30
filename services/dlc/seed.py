"""Default agents, groups, workflows and project templates.

Each workflow is ONE flow with both views: the project manager's steps (scope
sign-off, setup and plan, UAT, release and close) wrapped around the
developer's steps (spec, design, build, review, test), with rework arrows from
review, test and UAT back to the build step.

Idempotent: an existing id is left as the admin edited it. A seeded row the
admin never touched (updated_at == created_at) is upgraded when SEED_VERSION
rises, so a new default reaches installs that never customised it.
"""

import json

import db

SEED_VERSION = 3
ARGS = ["--setting-sources", "project", "--dangerously-skip-permissions"]

AGENTS = [
    ("a-pm", "PM Agent", "You are the project manager. You own scope, plan, risks and acceptance. Turn vague asks into precise, "
                         "testable scope items; keep the registers honest; never let work start without signed-off scope."),
    ("a-arch", "Architect Agent", "You own structure: modules, functions, data shapes, command contract and error handling. In a design "
                                  "step write DESIGN.md in your working folder. Challenge ambiguity in the spec."),
    ("a-dev", "Dev Agent", "You write the code and make it run: small, readable, Python standard library only unless told otherwise. "
                           "Keep the test suite green and run it before you report."),
    ("a-qa", "QA Agent", "You verify: run the full test suite, add missing tests for the acceptance criteria of every scope item, "
                         "and report pass or fail honestly with the numbers. Fix only trivial test-infrastructure issues; report real bugs as defects."),
    ("a-rev", "Reviewer Agent", "You review changes for correctness, scope creep and missing tests. Be specific: file and line. "
                                "You never wrote the code you review."),
]

NOTES = "{project_folder}\\.sdlc\\{run_slug}\\{group_slug}"
CODE = "{project_folder}"

# id, name, agents, gate, rounds, workspace, goal, lane, role, approval, verify, estimate
GROUPS = [
    ("g-intake", "Scope Sign-off (SOW)", ["a-pm"], True, 1, NOTES,
     "PM step 1 (SOW intake and scope handshake). Confirm with the user the contract boundary: which areas / modules / objects are "
     "in scope (A1..), what is out of scope, constraints. If the project folder has code, read it first. Not the feature list yet: "
     "that is the blueprint. The user's approval signs the scope off.",
     "pm", "intake", True, False, 5),
    ("g-setup", "Setup & Plan", ["a-pm", "a-arch"], False, 1, NOTES,
     "PM step (governance and artifact setup). Write PLAN.md: the remaining steps of this workflow and what each delivers against the "
     "scope items. Record the risks (probability, impact, mitigation) and any conventions. Report the exact test command.",
     "pm", "plan", False, False, 5),
    ("g-spec", "Blueprint (Spec)", ["a-pm", "a-arch"], False, 2, NOTES,
     "Exploration and blueprint: turn the signed-off areas into the detailed feature list F1.. with acceptance criteria (fit-gap: "
     "standard or gap) and write SPEC.md in the working folder: user stories, the exact command/API contract, out of scope. The "
     "business lead signs the blueprint off before anything is built; later changes are change requests.",
     "dev", "blueprint", True, False, 8),
    ("g-design", "Architect Design", ["a-arch"], False, 1, NOTES,
     "Write DESIGN.md in the working folder: files, functions, data format, error handling, test plan. Read SPEC.md from the "
     "earlier step's folder (see artifacts).",
     "dev", "work", False, False, 6),
    ("g-impl", "Implementation", ["a-dev"], False, 2, CODE,
     "Implement the request in the project folder following the spec and design, with unittest tests under tests/. Run the "
     "tests until they are green. If an earlier review, test or UAT sent the work back, fix exactly what it reported.",
     "dev", "work", False, True, 15),
    ("g-review", "Code Review", ["a-rev"], False, 1, CODE,
     "Independent review of this run's changes for correctness, scope (against the signed-off scope items) and missing tests. "
     "verdict fail with defects (file:line) sends the work back to the builder.",
     "dev", "review", False, False, 5),
    ("g-test", "Testing", ["a-qa"], False, 1, CODE,
     "Run the full test suite, add tests for any scope item that has none, and trace every scope item to a passing test. "
     "verdict fail sends the work back to the builder. The server re-runs the tests itself.",
     "dev", "test", False, True, 8),
    ("g-uat", "UAT Acceptance", ["a-pm"], True, 1, NOTES,
     "PM step (user acceptance). Present each scope item with its evidence (test, file, a command the user can try) and ask the user "
     "to accept the delivery. Approving accepts it; rejecting with 'send back' returns the work to Implementation.",
     "pm", "uat", True, False, 5),
    ("g-release", "Release & Close", ["a-pm"], False, 1, CODE,
     "PM step (close). Write RELEASE.md in the project folder: what changed, how to run it, known limits. List open follow-ups as "
     "actions and record lessons learned for the next project. No code changes.",
     "pm", "close", False, False, 4),
    ("g-bug-intake", "Bug Intake & Triage", ["a-pm"], True, 1, NOTES,
     "PM step (triage). Get the bug from the user: ticket text, repro steps, expected versus actual, severity, attached files. The "
     "scope items are the expected behaviours the fix must restore. No spec in a bug fix. The user's approval accepts the triage.",
     "pm", "intake", True, False, 5),
    ("g-code-read", "Code Reading", ["a-dev"], False, 1, NOTES,
     "Read the ticket and the existing code. Find the root cause (file:line) and the blast radius; write ANALYSIS.md in the "
     "working folder. Do not fix anything yet.",
     "dev", "work", False, False, 6),
    ("g-sit", "System Integration Test (QAS)", ["a-qa"], False, 1, CODE,
     "SIT in QAS: run the whole suite plus end-to-end scenarios of the features working together (the real command line, files, "
     "error paths), trace every feature F.. to a passing test. verdict fail sends the work back to the builder. Business lead and "
     "PMO sign the SIT off.",
     "dev", "test", True, True, 8),
    ("g-cutover", "Cutover & Go/No-Go", ["a-pm", "a-arch"], False, 1, NOTES,
     "PM step (cutover). Write CUTOVER.md: readiness of QAS (tests, open defects), the production steps with who and when, rollback, "
     "verification after go-live. Recommend GO or NO-GO. The Go/No-Go is signed by the business lead, the PMO and the project manager.",
     "pm", "cutover", True, False, 4),
    ("g-golive", "Go Live (PRD)", ["a-dev"], False, 1, CODE,
     "Take the build live: make sure it runs from the project folder exactly as RELEASE.md / the cutover checklist says, verify the "
     "main paths once more, record what now runs in production. No new features.",
     "dev", "release", False, True, 3),
    ("g-hypercare", "Hypercare", ["a-pm"], True, 1, NOTES,
     "PM step (hypercare). Ask the user what they found after go-live; file each problem as a defect (verdict fail sends it back to "
     "the build). When the user confirms all issues are resolved, close for the hypercare sign-off by business lead and PMO.",
     "pm", "hypercare", True, False, 5),
    ("g-bug-fix", "Bug Fix", ["a-dev"], False, 2, CODE,
     "Fix the root cause with the smallest change, add a regression test that fails without the fix, run the whole suite. If a "
     "review or test sent the work back, fix exactly what it reported.",
     "dev", "work", False, True, 10),
]


def _doc(group_ids, rework=None):
    """Main path left to right; rework arrows (from -> to, by group id) drawn as their own kind."""
    nodes = [{"id": "n%d" % (i + 1), "groupId": g, "x": 40 + 240 * i, "y": 140} for i, g in enumerate(group_ids)]
    edges = [{"id": "e%d" % (i + 1), "source": "n%d" % (i + 1), "target": "n%d" % (i + 2), "kind": "next"}
             for i in range(len(group_ids) - 1)]
    nid = {g: "n%d" % (i + 1) for i, g in enumerate(group_ids)}
    for k, (src, dst) in enumerate(rework or []):
        edges.append({"id": "r%d" % (k + 1), "source": nid[src], "target": nid[dst], "kind": "rework"})
    return {"nodes": nodes, "edges": edges}


# Sign-off titles per step (PM Works: blueprint by the business lead; SIT, UAT and hypercare by business lead + PMO;
# Go/No-Go by all) and the environment a step works in (DEV -> QAS -> PRD promotion).
SIGN = {"g-spec": ["business lead"], "g-sit": ["business lead", "pmo"], "g-uat": ["business lead", "pmo"],
        "g-cutover": ["business lead", "pmo", "project manager"], "g-hypercare": ["business lead", "pmo"]}
ENV = {"g-impl": "dev", "g-bug-fix": "dev", "g-sit": "qas", "g-golive": "prd"}

WORKFLOWS = [
    ("wf-new-system", "New System", "feature",
     ["g-intake", "g-setup", "g-spec", "g-design", "g-impl", "g-review", "g-test", "g-uat", "g-release"],
     [("g-review", "g-impl"), ("g-test", "g-impl"), ("g-uat", "g-impl")]),
    ("wf-new-feature", "New Feature", "feature",
     ["g-intake", "g-setup", "g-spec", "g-impl", "g-review", "g-test", "g-uat", "g-release"],
     [("g-review", "g-impl"), ("g-test", "g-impl"), ("g-uat", "g-impl")]),
    ("wf-bug-fix", "Bug Fix", "bugfix",
     ["g-bug-intake", "g-code-read", "g-bug-fix", "g-review", "g-test", "g-release"],
     [("g-review", "g-bug-fix"), ("g-test", "g-bug-fix")]),
    ("wf-full-delivery", "Full Delivery (SIT, UAT, Go-live)", "feature",
     ["g-intake", "g-setup", "g-spec", "g-design", "g-impl", "g-review", "g-test", "g-sit", "g-uat", "g-cutover", "g-golive",
      "g-hypercare", "g-release"],
     [("g-review", "g-impl"), ("g-test", "g-impl"), ("g-sit", "g-impl"), ("g-uat", "g-impl"), ("g-cutover", "g-impl"),
      ("g-hypercare", "g-impl")]),
]

TEMPLATES = [
    ("tpl-python-cli", "Python CLI (standard library)", "A command-line tool in Python with unittest tests under tests/.",
     "wf-new-system", "python -m unittest discover -s tests -v", 5.0),
    ("tpl-blank", "Blank", "No defaults: the Setup & Plan step finds the test command.", "wf-new-system", "", 0.0),
    ("tpl-full-delivery", "Full delivery (SIT, UAT, cutover, hypercare)", "The whole PM implementation flow with sign-offs and "
     "DEV -> QAS -> PRD promotion.", "wf-full-delivery", "python -m unittest discover -s tests -v", 10.0),
]


def _untouched(table, rid):
    r = db.one("SELECT created_at, updated_at FROM %s WHERE id=?" % table, rid)
    return r and r["created_at"] == r["updated_at"]


def seed():
    ts = db.now()
    mark = db.one("SELECT value_json FROM setting WHERE key='_seed_version'")
    upgrade = (int(db.jload(mark["value_json"], 1)) if mark else 1) < SEED_VERSION
    for aid, name, role in AGENTS:
        if not db.one("SELECT id FROM agent WHERE id=?", aid):
            db.ex("INSERT INTO agent(id, name, llm_type, model, args_json, env_json, tools_json, role_prompt, created_at, updated_at) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?)", aid, name, "claude-cli", "sonnet", json.dumps(ARGS), "{}", None, role, ts, ts)
        elif upgrade and _untouched("agent", aid):
            db.ex("UPDATE agent SET role_prompt=? WHERE id=?", role, aid)
    for gid, name, agents, gate, rounds, ws, goal, lane, role, approval, verify, est in GROUPS:
        vals = (name, goal, ws, 1 if gate else 0, rounds, lane, role, 1 if approval else 0, 1 if verify else 0, est,
                json.dumps(SIGN.get(gid, [])), ENV.get(gid, ""))
        if not db.one("SELECT id FROM grp WHERE id=?", gid):
            db.ex("INSERT INTO grp(name, goal, workspace, human_gate, max_rounds, lane, role, approval, verify_tests, estimate_min, "
                  "approvers_json, env, created_at, updated_at, id, slug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  *vals, ts, ts, gid, gid[2:])
            for i, a in enumerate(agents):
                db.ex("INSERT OR IGNORE INTO group_agent(group_id, agent_id, position) VALUES (?,?,?)", gid, a, i)
        elif upgrade and _untouched("grp", gid):
            db.ex("UPDATE grp SET name=?, goal=?, workspace=?, human_gate=?, max_rounds=?, lane=?, role=?, approval=?, verify_tests=?, "
                  "estimate_min=?, approvers_json=?, env=? WHERE id=?", *vals, gid)
            db.ex("DELETE FROM group_agent WHERE group_id=?", gid)
            for i, a in enumerate(agents):
                db.ex("INSERT OR IGNORE INTO group_agent(group_id, agent_id, position) VALUES (?,?,?)", gid, a, i)
    for wid, name, kind, gids, rework in WORKFLOWS:
        doc = json.dumps(_doc(gids, rework))
        row = db.one("SELECT * FROM workflow WHERE id=?", wid)
        if not row:
            db.ex("INSERT INTO workflow(id, name, kind, doc_json, created_at, updated_at, version) VALUES (?,?,?,?,?,?,1)",
                  wid, name, kind, doc, ts, ts)
            version = 1
        elif upgrade and _untouched("workflow", wid) and row["doc_json"] != doc:
            version = (row["version"] or 1) + 1
            db.ex("UPDATE workflow SET doc_json=?, version=? WHERE id=?", doc, version, wid)
        else:
            version = row["version"] or 1
        if not db.one("SELECT 1 FROM workflow_version WHERE workflow_id=? AND version=?", wid, version):
            r = db.one("SELECT * FROM workflow WHERE id=?", wid)
            db.ex("INSERT INTO workflow_version(workflow_id, version, name, kind, doc_json, created_at, created_by) VALUES (?,?,?,?,?,?,?)",
                  wid, version, r["name"], r["kind"], r["doc_json"], ts, "seed")
    for tid, name, desc, wf, cmd, budget in TEMPLATES:
        if not db.one("SELECT id FROM template WHERE id=?", tid):
            db.ex("INSERT INTO template(id, name, description, workflow_id, test_command, budget_usd, created_at, updated_at) "
                  "VALUES (?,?,?,?,?,?,?,?)", tid, name, desc, wf, cmd, budget, ts, ts)
    db.ex("INSERT OR REPLACE INTO setting(key, value_json) VALUES ('_seed_version', ?)", json.dumps(SEED_VERSION))
