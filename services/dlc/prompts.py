"""Prompt text for one agent turn. Data in, one string out; no I/O here.

The STEP_DONE json carries both views: the developer's hand-over (summary,
artifacts, tests, next_input) and the PM's registers (decisions, risks, actions,
issues, defects, lessons), plus what the step's role must report: the intake's
signed-off scope, a review/test/UAT verdict, the test step's scope trace.
"""

import json

BASE_FIELDS = {
    "summary": "<=200 words: what was done and decided",
    "artifacts": ["absolute file paths"],
    "decisions": [{"title": "what was decided", "why": "one line"}],
    "risks": [{"title": "...", "probability": "1-5", "impact": "1-5", "mitigation": "mandatory plan", "owner": "a person, never an agent (empty = the run owner)"}],
    "actions": [{"title": "follow-up someone must do", "owner": "", "due": ""}],
    "issues": [{"title": "a problem happening now", "severity": "high|medium|low"}],
    "lessons": ["what the next project should do differently (only if real)"],
    "next_input": "what the next step must know",
}

ROLE_FIELDS = {
    "intake": {"scope": [{"id": "A1", "text": "an area / module / object in scope (contract level, not a feature)",
                          "acceptance": "the success criterion for that area"}],
               "out_of_scope": ["..."]},
    "blueprint": {"scope": [{"id": "F1", "text": "one feature or behaviour to build", "acceptance": "testable acceptance criterion",
                             "fit": "standard|gap"}],
                  "out_of_scope": ["..."]},
    "cutover": {"verdict": "pass (GO) | fail (NO-GO)", "checklist": "path of CUTOVER.md"},
    "release": {"release_notes": "path of RELEASE.md", "promoted": "what now runs in production"},
    "hypercare": {"verdict": "pass (all resolved) | fail (defects to fix)",
                  "defects": [{"title": "issue the user found", "severity": "high|medium|low", "file": "path:line"}]},
    "plan": {"test_command": "the exact command that runs the project's tests"},
    "work": {"tests": {"command": "...", "passed": True}},
    "review": {"verdict": "pass|fail", "defects": [{"title": "...", "severity": "high|medium|low", "file": "path:line"}]},
    "test": {"verdict": "pass|fail", "tests": {"command": "...", "passed": True},
             "trace": [{"scope": "S1", "test": "tests/test_x.py::TestY::test_z", "passed": True}],
             "defects": [{"title": "...", "severity": "high|medium|low", "file": "path:line"}]},
    "uat": {"verdict": "pass|fail"},
    "close": {"release_notes": "path of RELEASE.md"},
}

ROLE_RULES = {
    "intake": "You run the PM's SOW intake and scope handshake. Confirm the CONTRACT BOUNDARY, not the features: which areas, "
              "modules or objects are in scope (A1, A2, ...), each with its success criterion, what is explicitly out of scope, "
              "constraints and assumptions. The detailed feature list is written later in the blueprint.",
    "blueprint": "You run exploration and the blueprint. Turn the signed-off areas into the DETAILED FEATURE LIST F1, F2, ... "
                 "each with a testable acceptance criterion, marked standard or gap (fit-gap). Write SPEC.md (the blueprint) in your "
                 "working folder. This list is what will be built, traced to tests and accepted; anything outside it later is a "
                 "change request. The business lead signs it off.",
    "cutover": "You run cutover and the Go/No-Go. Write CUTOVER.md: environment readiness (QAS state, test results, open "
               "defects), steps to promote to production with who/when, data, rollback, verification after go-live. Recommend "
               "GO (verdict pass) or NO-GO (verdict fail, the work goes back) with reasons. The sign-off is the Go/No-Go decision.",
    "release": "You take the build live (production). Make sure it runs from the project folder as RELEASE.md says, verify the "
               "main paths once more in production conditions, and record what now runs in production. No new features.",
    "hypercare": "You run hypercare with the user after go-live: ask what they found, file each problem as a defect, and give "
                 "verdict fail while defects need fixing (they go back to the build); when the user confirms everything is "
                 "resolved, close with verdict pass for the hypercare sign-off and the handover to customer support.",
    "plan": "You set the project up and plan the work: write PLAN.md (the steps of this workflow with what each delivers), "
            "record the risks you see (probability, impact, mitigation), note conventions, and report the exact test command.",
    "work": "You build. Keep the change inside the accepted scope. Run the tests before you report; a server re-runs them.",
    "review": "You are the independent reviewer. Read the actual changes. verdict 'fail' sends the work back to the builder, "
              "so fail only for real defects (wrong behaviour, scope creep, missing tests) and list each one with file:line.",
    "test": "You verify (unit tests in DEV, system integration tests in QAS). Run the whole suite, add tests for any scope "
            "item that has none, and report a trace line for EVERY "
            "scope item. verdict 'fail' (or any item without a passing test) sends the work back to the builder. "
            "The server re-runs the test command itself; never report passed=true unless you saw it pass.",
    "uat": "You run user acceptance with the human: show each scope item and the evidence (file, test, command to try) and "
           "ask the user to accept. Only the user can accept; their approval closes this step.",
    "close": "You close the delivery: write RELEASE.md (what changed, how to run it, known limits), list open follow-ups as "
             "actions, and record lessons learned. No new code.",
}


def done_format(role):
    fields = dict(BASE_FIELDS)
    fields.update(ROLE_FIELDS.get(role or "work", {}))
    return "STEP_DONE\n```json\n" + json.dumps(fields, indent=1) + "\n```\nLeave out keys you have nothing for; never invent risks or lessons."


def _summaries(prev):
    out = []
    for s in prev:
        sm = s.get("summary") or {}
        tag = " (attempt %d)" % s["attempt"] if (s.get("attempt") or 1) > 1 else ""
        verdict = " - verdict FAIL, work was sent back" if s.get("status") == "rework" else ""
        out.append("### Step %d - %s%s%s\n%s" % (s["position"], s["groupName"], tag, verdict, sm.get("summary") or "(no summary)"))
        extra = []
        if sm.get("decisions"):
            extra.append("Decisions: " + "; ".join((d.get("title") if isinstance(d, dict) else str(d)) or "" for d in sm["decisions"]))
        if sm.get("artifacts"):
            extra.append("Artifacts: " + ", ".join(str(a) for a in sm["artifacts"]))
        if sm.get("next_input"):
            extra.append("Hand-over: " + str(sm["next_input"]))
        if sm.get("tests"):
            extra.append("Tests: " + str(sm["tests"]))
        v = s.get("verify")
        if v and v.get("ran"):
            extra.append("Server test run: %s (%s)" % ("PASS" if v.get("passed") else "FAIL", v.get("command")))
        if s.get("approvalNote"):
            extra.append("Reviewer note from a person: " + s["approvalNote"])
        if extra:
            out.append("\n".join(extra))
    return "\n\n".join(out)


def transcript(msgs):
    return "\n\n".join("[%s] %s" % (m["senderName"], m["content"]) for m in msgs)


def rules(ctx, agent, is_lead, opening=False, wrapup=False, members_spoke=True):
    lines = [
        "1. Reply in plain markdown with what you say to the group. Be concise (under 400 words) unless the step asks you "
        "to produce a document; put long documents in files and summarise them.",
        "2. Do real work with your tools when the step needs it: read and write files under the folders above. Run tests with "
        "`%s` from %s when there is code. Never run git commit or git push. Never create files outside %s." % (
            ctx.get("test_command") or "python -m unittest discover -s tests -v", ctx["project_folder"], ctx["project_folder"]),
    ]
    if is_lead:
        if ctx["has_members"] and not members_spoke:
            lines.append("3. You lead this step, but the other members have not reviewed yet: do NOT write STEP_DONE in this reply.")
        else:
            lines.append("3. You lead this step. When the step goal is reached, END your reply with a line containing only "
                         "STEP_DONE followed by a json block like:\n" + done_format(ctx.get("role")))
    else:
        lines.append("3. You never write STEP_DONE; only the lead (%s) closes the step. Review, challenge, add or fix. "
                     "Reply 'LGTM' plus one sentence if you have nothing to add." % ctx["lead_name"])
    if ctx["gate"]:
        lines.append("4. A human user is present in this step. If you still need information, ask at most 5 concrete questions in "
                     "ONE message and end with a line containing only NEED_HUMAN. Never write NEED_HUMAN and STEP_DONE in the "
                     "same reply. When the user says to proceed or you have enough, close the step.")
    else:
        lines.append("4. No human is present in this step. Never ask questions; make reasonable decisions and list them under "
                     "\"decisions\" (a lead may approve or reject them later).")
    lines.append("5. A message that starts with CHANGE REQUEST is a proposed change: assess its impact on scope, time and cost "
                 "and name the earlier artifacts it makes stale, but do not implement it until a later message says it was approved.")
    if opening:
        lines.append("6. The user has just opened this step. Greet in one line, say what you understood from the Request, then "
                     "ask your questions (at most 5, with the default you would assume for each) and end with NEED_HUMAN. "
                     "Do NOT write STEP_DONE in this first reply: the user must answer before the step can close.")
    if wrapup:
        lines.append("6. This is the FINAL turn of this step. You MUST end with STEP_DONE and the json block now, "
                     "summarising the state as it is.")
    return "\n".join(lines)


def full(ctx, agent, is_lead, msgs, opening=False, wrapup=False, members_spoke=True):
    parts = [
        'You are "%s", a member of the "%s" group of an SDLC (software development life cycle) pipeline that combines the '
        "developer's steps with the project manager's governance. This step is in the %s lane. Work autonomously; "
        "people only sign off scope, approve results and accept the delivery." % (
            agent["name"], ctx["group_name"], "project manager" if ctx.get("lane") == "pm" else "developer"),
    ]
    if agent.get("rolePrompt"):
        parts.append(agent["rolePrompt"])
    if ROLE_RULES.get(ctx.get("role")):
        parts.append("## Your step's role: %s\n%s" % (ctx["role"], ROLE_RULES[ctx["role"]]))
    if ctx["agents_line"]:
        parts.append("Group members, in turn order: " + ctx["agents_line"] + ". The first one leads.")
    parts.append("## Group goal\n" + (ctx["group_goal"] or ctx["group_name"]))
    parts.append(
        "## Keys: project=%s feature=%s task=%s\nProject: %s - code folder: %s\nWorkflow: %s (%s); this is step %d/%d: %s%s\n"
        "Request: %s\nYour working folder (current directory): %s"
        % (ctx["project_slug"], ctx["run_slug"], ctx["group_slug"], ctx["project_name"], ctx["project_folder"],
           ctx["workflow_name"], ctx["run_kind"], ctx["pos"], ctx["total"], ctx["group_name"],
           " (attempt %d: earlier attempts were sent back, see why below)" % ctx["attempt"] if ctx.get("attempt", 1) > 1 else "",
           ctx["run_title"], ctx["workspace"])
    )
    if ctx.get("scope"):
        parts.append("## Signed-off scope (the contract)\n" + "\n".join(
            "- %s [%s] %s%s" % (s["ref"], s["status"], s["text"], (" | acceptance: " + s["acceptance"]) if s["acceptance"] else "")
            for s in ctx["scope"]))
    if ctx.get("attachments"):
        parts.append("## Files the user attached\n" + "\n".join("- %s (%d bytes)" % (a["path"], a["size"]) for a in ctx["attachments"]))
    if ctx["prev"]:
        parts.append("## Conclusions of earlier steps (your input)\n" + _summaries(ctx["prev"]))
    if ctx.get("open_items"):
        parts.append("## Open register items of this run (RAIDEC)\n" + "\n".join(
            "- %s %s [%s] %s%s" % (i["ref"], i["kind"], i["status"], i["title"], (" (owner %s)" % i["owner"]) if i["owner"] else "")
            for i in ctx["open_items"]))
    if ctx.get("lessons"):
        parts.append("## Lessons learned on earlier work (apply them)\n" + "\n".join(
            "- %s (%s) %s" % (l["ref"], l["project_id"], l["title"]) for l in ctx["lessons"]))
    if ctx["kh_recent"]:
        parts.append("## Memory - recent worklog of %s\n" % ctx["kh_project"]
                     + "\n".join("- %s %s" % (r["ts"], r["text"][:400].replace("\n", " ")) for r in ctx["kh_recent"]))
    if ctx["tools"]:
        parts.append("## Tools you may use (registry %s/INDEX.md)\n" % (ctx.get("tools_dir") or "").rstrip("/\\")
                     + "\n".join("- %s: %s" % (t["name"], (t.get("work") or "")[:140]) for t in ctx["tools"]))
    kp, mu = ctx["kh_project"], ctx.get("memory_url") or ""
    if mu:   # memory server configured (SDLC_MEMORY_URL); unset = no memory protocol in the prompt
        parts.append(
            "## Memory protocol (memory at %s, project %s)\n"
            "- Store a durable decision or gotcha: POST %s/vector/add with JSON "
            '{"text":"...","scope":"knowledge","metadata":{"scope":"knowledge","project":"%s","subject":"%s","topic":"%s"}} '
            "(use ASCII only in the body).\n"
            '- Search memory: POST %s/vector/query {"text":"...","project":"%s","top_k":5}\n'
            "- Do NOT call /messages and do NOT write worklogs yourself: your reply IS your message to the group; the "
            "orchestrator delivers it to the other agents, mirrors it to memory, logs the step summary and files your registers."
            % (mu, kp, mu, kp, ctx["run_slug"], ctx["group_slug"], mu, kp)
        )
    parts.append("## Group conversation so far\n" + (transcript(msgs) if msgs else "(nobody has spoken yet)"))
    parts.append("## Your turn - rules\n" + rules(ctx, agent, is_lead, opening, wrapup, members_spoke))
    return "\n\n".join(parts)


def delta(ctx, agent, is_lead, msgs, opening=False, wrapup=False, members_spoke=True):
    """A follow-up turn on a resumed session: only what was said since, plus the rules."""
    return ("## New in the group conversation since your last turn\n"
            + (transcript(msgs) if msgs else "(nothing new)")
            + "\n\n## Your turn - rules (unchanged context: you are %s in step %s)\n" % (agent["name"], ctx["group_name"])
            + rules(ctx, agent, is_lead, opening, wrapup, members_spoke))
