"""What the line is made of, for a frontend that configures or explains it: steps, agents, processes, hooks.

    catalog(cfg) -> {"steps": [...], "agents": [...], "processes": [...], "hook_events": [...], "models": {...}}

steps      the stage nodes of every run (runview.NODES) in order, each with its agent roles and the hook
           events that fire at its boundary; plus "size" (change sizer, spec analyst) that runs before
           "understand" on Enhancement and Bug Fix
agents     every AI role: kind (complete = one strict JSON answer, agentic = a tool-using session in a
           worktree), the step it works in, what it does, and the model it uses now (LINE_ROLE_MODELS, else
           LINE_MODEL)
processes  the standard flows (docs: flows.md): one pipeline, they differ in what goes in
definitions the process definitions the engine sees (line.process: engine folder and seed): steps, gates, roles,
           checks; a project's own (.dlc/process in its repository) apply to its runs on top of these
Read only; nothing here changes the engine. Hooks themselves are listed and changed at /api/admin/hooks.
"""

from __future__ import annotations

from typing import Any, Dict, List

from . import hooks, runview

#: role -> (kind, step, what it does)
ROLES: Dict[str, tuple] = {
    "change_sizer": ("agentic", "size", "Puts every request (any flow) on level 1-4: 1-2 one agent, 3-4 the team"),
    "spec_analyst": ("agentic", "size", "Reads the repository and appends an analysis to the spec"),
    "reader_a": ("complete", "understand", "Turns the spec into F-items, criteria and rules, each quoted"),
    "reader_b": ("complete", "understand", "Second, sceptical reading in reverse order; never sees reader A"),
    "reader_reread": ("complete", "understand", "Re-reads only the spans where the two readers disagree"),
    "gaps": ("complete", "understand", "Finds what the spec leaves open per feature (inputs, errors, limits...)"),
    "conflicts": ("complete", "understand", "Finds rules of the spec that contradict each other or the system"),
    "fgraph": ("complete", "understand", "Builds the feature graph: what each feature produces and consumes"),
    "human_decider": ("complete", "understand", "Answers open questions when nobody is asked (human mode decide)"),
    "test_author": ("complete", "tests", "Writes one acceptance test file per feature, never code"),
    "planner": ("complete", "plan", "Splits the work into units with files, dependencies and tests"),
    "solo": ("agentic", "build", "Simple first: reads, builds and tests the whole request alone; the gates check it"),
    "solo_lead": ("agentic", "build", "Levels 3-4 (solo_lead on): the solo agent as lead, delegating parallel parts"),
    "solo_reviewer": ("agentic", "review", "Level 2: checks a green solo change against each point of the request"),
    "test_arbiter": ("agentic", "build", "Rules on a BLOCKED unit's claim that its locked test is wrong"),
    "test_repairer": ("agentic", "build", "Repairs a locked acceptance test an arbiter ruled wrong (only that file)"),
    "builder": ("agentic", "build", "Writes the code of one unit in its own worktree until its tests pass"),
    "fixer": ("agentic", "build", "Fixes a unit after a red QAS run"),
    "reviewer": ("complete", "review", "Reviews a unit's diff against the spec quotes only"),
    "judge": ("complete", "review", "Decides continue / redirect / reset / stop when a unit keeps failing"),
    "retro": ("complete", "result", "After every run: prediction vs real footprint into persona findings and rules"),
    "supervisor": ("complete", "result", "Settles a failed run: retries with a hint or hands it to a person"),
    "explainer": ("complete", "result", "Explains a failed run in plain words"),
    "distiller": ("complete", "result", "Turns the run's failures into candidate lessons"),
    "eval_judge": ("complete", "result", "Grades candidate lessons before they are used"),
}

#: step -> hook events at its boundary (hooks.EVENTS)
STEP_HOOKS: Dict[str, List[str]] = {
    "understand": ["run_start"],
    "plan": ["after_plan"],
    "qas": ["before_qas"],
    "result": ["before_green", "run_done", "run_failed"],
}

SIZE_STEP = ("size", "Size the change", ("change_sizer", "spec_analyst"))

PROCESSES: List[Dict[str, Any]] = [
    {"id": "new-system", "title": "New System", "input": "the whole system as a markdown spec, one ## F<n> per "
     "feature; a new empty repository", "steps_from": "understand"},
    {"id": "enhancement", "title": "Enhancement", "input": "only the new or changed behaviour; the project's "
     "repository after a completed run", "steps_from": "size"},
    {"id": "bug-fix", "title": "Bug Fix", "input": "title, repro, expected, actual (or a free-text report) as "
     "one F-item; the project's repository after a completed run", "steps_from": "size"},
]


def _model(cfg: Any, role: str) -> str:
    models = getattr(cfg, "role_models", None) or {}
    return str(models.get(role) or getattr(cfg, "model", "") or "")


def steps() -> List[Dict[str, Any]]:
    out = [{"id": SIZE_STEP[0], "title": SIZE_STEP[1], "roles": list(SIZE_STEP[2]), "hook_events": [],
            "optional": True}]
    for nid, title, _states, roles, _kinds in runview.NODES:
        out.append({"id": nid, "title": title, "roles": [r for r in roles if r in ROLES],
                    "hook_events": list(STEP_HOOKS.get(nid, [])), "optional": nid in ("review", "deliver")})
    for s in out:                                   # supervisor and explainer act on the result of every run
        if s["id"] == "result":
            s["roles"] = s["roles"] + ["supervisor", "explainer"]
    return out


def catalog(cfg: Any, store: Any = None) -> Dict[str, Any]:
    all_steps = steps()
    ids = [s["id"] for s in all_steps]
    agents = [{"role": r, "kind": k, "step": st, "does": d, "model": _model(cfg, r)}
              for r, (k, st, d) in ROLES.items()]
    processes = [{"id": p["id"], "title": p["title"], "input": p["input"],
                  "steps": ids[ids.index(p["steps_from"]):]} for p in PROCESSES]
    from .process import catalog as definitions
    defs = definitions(cfg, store=store)
    known = {a["role"] for a in agents}
    for d in defs:                                  # roles a process definition names are agents too
        for s in d.get("steps") or []:
            for role in s.get("roles") or []:
                if role not in known:
                    known.add(role)
                    agents.append({"role": role, "kind": "agentic", "step": s["id"], "does": "process %s, step %s"
                                   % (d["id"], s["id"]), "model": _model(cfg, role)})
    from . import difyproc
    processes = difyproc.catalog_processes(cfg, processes)
    return {"steps": all_steps, "agents": agents, "processes": processes, "definitions": defs,
            "hook_events": list(hooks.EVENTS), "wait_events": list(hooks.WAIT_EVENTS),
            "models": {"default": str(getattr(cfg, "model", "")),
                       "human_mode": str(getattr(cfg, "human_mode", "") or "")}}
