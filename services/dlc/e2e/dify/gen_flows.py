"""Dify workflow DSLs (0.6.0) for the DLC processes, driven by the engine through line.difyproc task nodes.

    python gen_flows.py <out dir>      -> new-system.yml, enhancement.yml, bug-fix.yml, feature-migration.yml
"""
import json
import os
import sys
import uuid

import yaml  # noqa: F401  (PyYAML; json is valid yaml, used when PyYAML is missing)


def start(fields):
    return {"type": "start", "title": "Start", "variables": [
        {"variable": v, "label": v, "type": t, "required": r, "max_length": 100000 if t == "paragraph" else 256,
         "options": []} for v, t, r in fields]}


START = [("request", "paragraph", True), ("kind", "text-input", False), ("given_level", "text-input", False),
         ("project", "text-input", False), ("run", "text-input", False)]


def human(title, content, actions, inputs=("result",)):
    return {"type": "human-input", "title": title, "desc": "",
            "delivery_methods": [{"id": str(uuid.uuid4()), "type": "webapp", "enabled": True}],
            "form_content": content,
            "inputs": [{"type": "paragraph", "output_variable_name": i,
                        "default": {"selector": [], "type": "constant", "value": ""}} for i in inputs],
            "user_actions": [{"id": a, "title": a.replace("_", " ").title(), "button_style": "primary" if k == 0
                              else "default"} for k, a in enumerate(actions)],
            "timeout": 3, "timeout_unit": "day"}


def task(name, params, note=""):
    return human("DLC: " + name, "%s\n\n```dlc %s```" % (note or "Engine task.", json.dumps(params)),
                 ["done", "failed"])


def end(outputs):
    return {"type": "end", "title": "End", "outputs": [{"variable": k, "value_selector": v} for k, v in outputs]}


def code_const(title, value):
    return {"type": "code", "title": title, "code_language": "python3",
            "code": "def main() -> dict:\n    return {'decision': %r}\n" % value,
            "variables": [], "outputs": {"decision": {"type": "string", "children": None}}}


class Flow:
    def __init__(self, name):
        self.name, self.nodes, self.edges, self.x = name, [], [], 0

    def node(self, nid, data, x=None, y=0):
        self.nodes.append({"id": nid, "type": "custom", "position": {"x": x if x is not None else 300 * len(self.nodes),
                                                                     "y": y},
                           "positionAbsolute": {"x": 0, "y": 0}, "width": 244, "height": 90,
                           "data": dict(data, selected=False)})
        return nid

    def edge(self, src, dst, handle="source"):
        st = next(n["data"]["type"] for n in self.nodes if n["id"] == src)
        dt = next(n["data"]["type"] for n in self.nodes if n["id"] == dst)
        self.edges.append({"id": "%s-%s-%s" % (src, handle, dst), "source": src, "sourceHandle": handle,
                           "target": dst, "targetHandle": "target", "type": "custom", "zIndex": 0,
                           "data": {"sourceType": st, "targetType": dt, "isInIteration": False, "isInLoop": False}})

    def stop(self, nid, decision, after, handle):
        c = self.node(nid + "_d", code_const("Decision: " + decision, decision), y=300)
        e = self.node(nid, end([("decision", [c, "decision"])]), y=300)
        self.edge(after, c, handle)
        self.edge(c, e)

    def dsl(self, desc):
        return {"app": {"mode": "workflow", "name": self.name, "description": desc, "icon": "\U0001F6E0",
                        "icon_background": "#E4FBCC", "use_icon_as_answer_icon": False},
                "kind": "app", "version": "0.6.0",
                "workflow": {"conversation_variables": [], "environment_variables": [], "features": {},
                             "graph": {"nodes": self.nodes, "edges": self.edges,
                                       "viewport": {"x": 0, "y": 0, "zoom": 0.7}}}}


def new_system():
    f = Flow("DLC · New System (local)")
    s = f.node("start", start(START))
    a = f.node("analyse", task("analyse", {"agents": ["spec_analyst"], "goal": "List the features (F1..Fn) of the "
                                           "requested system, their data and the open questions.", "max_usd": 0.5}))
    p = f.node("approve", human("Approve the scope", "The analysis of the request:\n\n{{#analyse.result#}}\n\n"
                                "Approve the scope to build it, or reject it.", ["approve", "reject"], ["comment"]))
    r = f.node("build", task("run", {"level": 3, "agents": ["solo_lead"]}, "Build the whole system."))
    d = f.node("deliver", task("deliver", {}, "Push the project to its repository."))
    ok = f.node("ok_d", code_const("Decision: delivered", "delivered"))
    e = f.node("end_ok", end([("decision", [ok, "decision"]), ("result", ["build", "result"])]))
    f.edge(s, a); f.edge(a, p, "done"); f.edge(p, r, "approve"); f.edge(r, d, "done"); f.edge(d, ok, "done")
    f.edge(ok, e)
    f.stop("end_af", "analysis failed", a, "failed")
    f.stop("end_rej", "rejected", p, "reject")
    f.stop("end_bf", "build failed", r, "failed")
    f.stop("end_df", "deliver failed", d, "failed")
    return f.dsl("New system: analyse, a person approves the scope, the line builds (lead), deliver.")


def enhancement():
    f = Flow("DLC · Enhancement (local)")
    s = f.node("start", start(START))
    z = f.node("size", task("size", {"agents": ["change_sizer"], "goal": "Say the level 1-4 of this change and "
                                     "why, in two lines.", "max_usd": 0.3}))
    p = f.node("pick", human("Pick the level", "The sizer says:\n\n{{#size.result#}}\n\nGiven level: "
                             "{{#start.given_level#}}. Write the level (1-4) to build at.", ["go", "stop"],
                             ["level"]))
    r = f.node("build", task("run", {"level": "{{#pick.level#}}"}, "Build at the chosen level."))
    d = f.node("deliver", task("deliver", {}, "Push the project to its repository."))
    ok = f.node("ok_d", code_const("Decision: delivered", "delivered"))
    e = f.node("end_ok", end([("decision", [ok, "decision"])]))
    f.edge(s, z); f.edge(z, p, "done"); f.edge(p, r, "go"); f.edge(r, d, "done"); f.edge(d, ok, "done"); f.edge(ok, e)
    f.stop("end_sf", "sizing failed", z, "failed")
    f.stop("end_stop", "stopped by a person", p, "stop")
    f.stop("end_bf", "build failed", r, "failed")
    f.stop("end_df", "deliver failed", d, "failed")
    return f.dsl("Enhancement: a sizer group, a person picks the level (passed into the run task), build, deliver.")


def bug_fix():
    f = Flow("DLC · Bug Fix (local)")
    s = f.node("start", start(START))
    rp = f.node("repro", task("reproduce", {"agents": ["solo"], "goal": "Reproduce the bug from the report and say "
                                           "the file and line of the cause. Do not fix it.", "max_usd": 0.5}))
    r = f.node("build", task("run", {"level": 1, "agents": ["solo"]}, "Fix it with a regression test."))
    d = f.node("deliver", task("deliver", {}, "Push the fix."))
    ok = f.node("ok_d", code_const("Decision: fixed", "fixed"))
    e = f.node("end_ok", end([("decision", [ok, "decision"])]))
    h = f.node("triage", human("Run failed: triage", "The fix run failed:\n\n{{#build.result#}}\n\nRetry one level "
                               "up, or close it.", ["retry", "close"], ["note"]), y=300)
    r2 = f.node("build2", task("run", {"level": 2}, "Retry the fix one level up."), y=300)
    f.edge(s, rp); f.edge(rp, r, "done"); f.edge(r, d, "done"); f.edge(d, ok, "done"); f.edge(ok, e)
    f.edge(r, h, "failed"); f.edge(h, r2, "retry"); f.edge(r2, d, "done")
    f.stop("end_rf", "not reproduced", rp, "failed")
    f.stop("end_close", "closed by a person", h, "close")
    f.stop("end_r2", "retry failed", r2, "failed")
    return f.dsl("Bug fix: reproduce (group), fix at level 1; a failed run asks a person to retry one level up.")


def feature_migration():
    f = Flow("DLC · Feature Migration (local)")
    s = f.node("start", start(START))
    r = f.node("build", task("run", {"level": 2}, "Migrate the feature."))
    ok = f.node("ok_d", code_const("Decision: migrated", "migrated"))
    e = f.node("end_ok", end([("decision", [ok, "decision"])]))
    f.edge(s, r); f.edge(r, ok, "done"); f.edge(ok, e)
    f.stop("end_bf", "migration failed", r, "failed")
    return f.dsl("Feature migration (flow 4) through Dify: does the engine hand it to the process at all?")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    for name, fn in (("new-system", new_system), ("enhancement", enhancement), ("bug-fix", bug_fix),
                     ("feature-migration", feature_migration)):
        with open(os.path.join(out, name + ".yml"), "w", encoding="utf-8") as fh:
            yaml.safe_dump(fn(), fh, allow_unicode=True, sort_keys=False)
        print("wrote", name)
