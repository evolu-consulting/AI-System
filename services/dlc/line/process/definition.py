"""Process definitions: what a gated run does, as data. The engine knows step KINDS (draft, build, review) and check
MECHANISMS (line.process.checks); which steps, artifacts, roles, prompts, gates, decisions and checks a run has is
read from a definition, never from code.

Where a definition comes from (first found wins, per id):
    run        detail.process of the run: an id, or a whole definition (POST /api/runs body "process")
    target     the target repository's main branch: .dlc/process/<id>.json and .dlc/prompts/<name>.md, so a
               project's process lives and is versioned with its code
    engine     Config.process_dir (LINE_PROCESS_DIR): <dir>/<id>.json and <dir>/prompts/<name>.md
    seed       line/process/seed: the built-in defaults (the flow of docs/flow-enhance_bugfix.html)

A definition may say "extends": "<id>": it is laid over that definition (dicts merge key by key, "steps" and
"checks" merge by id / position-free id, other lists are replaced), so a project changes one gate or adds one
check without copying the rest.

    select(cfg, repo, flow, detail) -> Resolved | None     the definition for a run (None: not a gated run)
    validate(d) -> d                                       ValueError naming what is wrong
    frozen(snapshot) -> Resolved                           the copy a run froze at its start (detail.gated.process)

A run freezes its definition and every prompt it names at the start, so a definition changed mid-run (a commit
on the target, a file in the engine folder) applies to the next run, never half-way through one.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed")
TARGET_DIR = ".dlc"                       # in the target repository: .dlc/process, .dlc/prompts, .dlc/<artifacts>
STEP_KINDS = ("draft", "build", "review")
SPECIAL_DOCS = ("@checks", "@drift", "@rounds", "@findings", "@needs", "@metrics")
MAX_EXTENDS = 8


@dataclass
class Resolved:
    """One definition ready to run: the merged data, every prompt it names, and where each came from."""
    id: str
    data: Dict[str, Any]
    prompts: Dict[str, str] = field(default_factory=dict)
    source: str = "seed"
    version: str = ""                     # registry "v<N>", else a content hash of the laid-out data

    def snapshot(self) -> Dict[str, Any]:
        return {"id": self.id, "source": self.source, "version": self.version, "def": self.data,
                "prompts": self.prompts}

    def ref(self) -> str:
        return "%s@%s" % (self.id, self.version)

    # -- what the rest of the engine asks
    def steps(self) -> List[Dict[str, Any]]:
        return list(self.data.get("steps") or [])

    def step(self, kind: str) -> Optional[Dict[str, Any]]:
        return next((s for s in self.steps() if s.get("kind") == kind), None)

    def gates(self) -> Dict[str, Dict[str, Any]]:
        return {s["gate"]["name"]: dict(s["gate"], _step=s.get("id")) for s in self.steps() if s.get("gate")}

    def gate(self, name: str) -> Optional[Dict[str, Any]]:
        return self.gates().get(name)

    def artifact(self, name: str) -> Dict[str, Any]:
        return dict((self.data.get("artifacts") or {}).get(name) or {})

    def prompt(self, name: str) -> str:
        if name not in self.prompts:
            raise ValueError("process %s: prompt %r is not available" % (self.id, name))
        return self.prompts[name]


# ------------------------------------------------------------------ sources

def _read_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def _git(repo: str, *args: str) -> Optional[str]:
    if not repo or not os.path.isdir(repo):
        return None
    try:
        p = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout if p.returncode == 0 else None


class _Dir:
    """A folder of <id>.json definitions and prompts/<name>.md templates."""

    def __init__(self, name: str, root: str, prompts: str):
        self.name, self.root, self.prompts_dir = name, root, prompts

    def definitions(self) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        if not self.root or not os.path.isdir(self.root):
            return out
        for n in sorted(os.listdir(self.root)):
            if n.endswith(".json"):
                d = _read_json(os.path.join(self.root, n))
                if d is not None:
                    out[str(d.get("id") or n[:-5])] = d
        return out

    def prompt(self, name: str) -> Optional[str]:
        return _read_text(os.path.join(self.prompts_dir, name + ".md")) if self.prompts_dir else None


class _Target:
    """The target repository's main branch (.dlc/process, .dlc/prompts): read with git, never from a worktree."""
    name = "target"

    def __init__(self, repo: str, ref: str = "main"):
        self.repo, self.ref = repo, ref

    def definitions(self) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        listing = _git(self.repo, "ls-tree", "--name-only", self.ref, TARGET_DIR + "/process/")
        for path in (listing or "").splitlines():
            if path.endswith(".json"):
                try:
                    d = json.loads(_git(self.repo, "show", "%s:%s" % (self.ref, path)) or "")
                except ValueError:
                    continue
                if isinstance(d, dict):
                    out[str(d.get("id") or os.path.basename(path)[:-5])] = d
        return out

    def prompt(self, name: str) -> Optional[str]:
        return _git(self.repo, "show", "%s:%s/prompts/%s.md" % (self.ref, TARGET_DIR, name))


def _sources(cfg: Any, repo: str, store: Any = None) -> List[Any]:
    """Highest first: the registry (active processes), target repository, engine folder, seed."""
    out: List[Any] = []
    if store is not None:
        from .registry import Source
        out.append(Source(store))
    out.append(_Target(repo))
    pdir = str(getattr(cfg, "process_dir", "") or "").strip()
    if pdir:
        out.append(_Dir("engine", pdir, os.path.join(pdir, "prompts")))
    out.append(_Dir("seed", SEED, os.path.join(SEED, "prompts")))
    return out


# ------------------------------------------------------------------ merge

def _merge_by_id(base: List[Any], over: List[Any]) -> List[Any]:
    out = [copy.deepcopy(x) for x in base]
    index = {x.get("id"): i for i, x in enumerate(out) if isinstance(x, dict) and x.get("id")}
    for x in over:
        if isinstance(x, dict) and x.get("remove") and x.get("id") in index:
            out[index[x["id"]]] = None
        elif isinstance(x, dict) and x.get("id") in index:
            out[index[x["id"]]] = merge(out[index[x["id"]]], x)
        else:
            out.append(copy.deepcopy(x))
    return [x for x in out if x is not None]


def merge(base: Any, over: Any) -> Any:
    """`over` laid on `base`: dicts key by key, lists of {id} items by id (an item {"id", "remove": true} drops it),
    any other value replaced."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = copy.deepcopy(base)
        for k, v in over.items():
            if k == "extends":
                continue
            out[k] = merge(out[k], v) if k in out else copy.deepcopy(v)
        return out
    if isinstance(base, list) and isinstance(over, list) and any(isinstance(x, dict) and x.get("id") for x in over):
        return _merge_by_id(base, over)
    return copy.deepcopy(over)


Found = Dict[str, List[Tuple[str, Dict[str, Any]]]]     # id -> [(source, data)], lowest source first


def _expand(did: str, found: Found, depth: int = 0, below: Optional[int] = None) -> Tuple[str, Dict[str, Any]]:
    """The definition `did` with its extends chain laid out. `below`: use only entries under that index (a
    definition that extends its own id builds on the next lower source's copy)."""
    stack = found.get(did) or []
    if below is not None:
        stack = stack[:below]
    if not stack:
        raise ValueError("process %r not found" % did)
    idx = len(stack) - 1
    src, d = stack[idx]
    parent = str(d.get("extends") or "")
    if not parent:
        return src, copy.deepcopy(d)
    if depth >= MAX_EXTENDS:
        raise ValueError("process %r: extends goes deeper than %d" % (did, MAX_EXTENDS))
    if parent == did:
        if idx == 0:
            raise ValueError("process %r extends itself and no lower source defines it" % did)
        psrc, pdata = _expand(did, found, depth + 1, below=idx)
    else:
        psrc, pdata = _expand(parent, found, depth + 1)
    m = merge(pdata, d)
    m["id"] = did
    return "%s<%s" % (src, psrc), m


# ------------------------------------------------------------------ validate

def validate(d: Dict[str, Any]) -> Dict[str, Any]:
    """The definition is runnable: every name it uses is defined. ValueError says what is wrong."""
    did = str(d.get("id") or "?")

    def bad(msg: str) -> ValueError:
        return ValueError("process %s: %s" % (did, msg))

    arts = d.get("artifacts") or {}
    if not isinstance(arts, dict):
        raise bad("artifacts must be an object")
    steps = d.get("steps") or []
    if not steps or not isinstance(steps, list):
        raise bad("steps must be a non-empty list")
    ids, gates = set(), set()
    for s in steps:
        if not isinstance(s, dict) or not s.get("id"):
            raise bad("every step needs an id")
        if s["id"] in ids:
            raise bad("step id %r twice" % s["id"])
        ids.add(s["id"])
        if s.get("kind") not in STEP_KINDS:
            raise bad("step %s: kind must be one of %s" % (s["id"], ", ".join(STEP_KINDS)))
        for a in s.get("agents") or []:
            if a.get("artifact") not in arts:
                raise bad("step %s: agent writes unknown artifact %r" % (s["id"], a.get("artifact")))
            if not a.get("role") or not a.get("prompt"):
                raise bad("step %s: every agent needs a role and a prompt" % s["id"])
        if s.get("kind") == "draft" and not s.get("agents"):
            raise bad("step %s: a draft step needs agents" % s["id"])
        if s.get("kind") in ("draft", "review") and not s.get("gate"):
            raise bad("step %s: a %s step needs a gate" % (s["id"], s["kind"]))
        g = s.get("gate")
        if g:
            name = g.get("name")
            if not name or name in gates:
                raise bad("step %s: gate needs a unique name" % s["id"])
            gates.add(name)
            dec = list(g.get("decisions") or [])
            if not dec or not set(g.get("pass") or []) <= set(dec) or not set(g.get("revise") or []) <= set(dec):
                raise bad("gate %s: pass and revise must be among its decisions" % name)
            if not g.get("pass"):
                raise bad("gate %s: needs at least one passing decision" % name)
            for t, parts in (g.get("targets") or {}).items():
                for p in parts:
                    if p not in arts:
                        raise bad("gate %s: target %s names unknown artifact %r" % (name, t, p))
            for doc in g.get("show") or []:
                if doc not in arts and doc not in SPECIAL_DOCS:
                    raise bad("gate %s: shows unknown document %r" % (name, doc))
        for c in s.get("checks") or []:
            from .checks import CHECKS
            if c.get("check") not in CHECKS:
                raise bad("step %s: unknown check %r (known: %s)" % (s["id"], c.get("check"), ", ".join(sorted(CHECKS))))
    for kind in ("build", "review"):
        if sum(1 for s in steps if s.get("kind") == kind) > 1:
            raise bad("at most one %s step" % kind)
    if d.get("queue") is not None:
        from ..changequeue import check_policy
        try:
            q = check_policy(d.get("queue"))
        except ValueError as e:
            raise bad(str(e))
        if q["enabled"] and q["serial_from"] not in ids and q["serial_from"] not in STEP_KINDS:
            raise bad("queue.serial_from %r names no step id or step kind" % q["serial_from"])
    for s in steps:
        chat = (s.get("gate") or {}).get("chat")
        if chat is not None and not isinstance(chat, bool):
            raise bad("gate %s: chat must be true or false" % s["gate"].get("name"))
        if chat and s.get("kind") != "draft":
            raise bad("gate %s: chat is for a draft step's gate (its agents answer and edit their documents)"
                      % s["gate"].get("name"))
    _validate_business(d, bad)
    return d


RESERVED_GATES = ("needs",)


def _validate_business(d: Dict[str, Any], bad: Any) -> None:
    """The business parts: people by role, auto-approve, routes back, needs, who writes vs who judges."""
    steps = d.get("steps") or []
    index = {s["id"]: i for i, s in enumerate(steps)}
    build_at = next((i for i, s in enumerate(steps) if s.get("kind") == "build"), len(steps))
    writers: Dict[str, set] = {}
    for s in steps:
        for a in s.get("agents") or []:
            writers.setdefault(a["artifact"], set()).add(a["role"])
    for key in ("owner",):
        if d.get(key) is not None and not isinstance(d.get(key), str):
            raise bad("%s must be a role name" % key)
    for i, s in enumerate(steps):
        for key in ("supervisor", "incident"):
            if s.get(key) is not None and not isinstance(s.get(key), str):
                raise bad("step %s: %s must be a role name" % (s["id"], key))
        g = s.get("gate") or {}
        if g:
            if g.get("name") in RESERVED_GATES:
                raise bad("gate name %r is reserved" % g["name"])
            if not all(isinstance(x, str) and x for x in g.get("approvers") or []):
                raise bad("gate %s: approvers must be role names" % g["name"])
            auto = g.get("auto")
            if auto is not None and (not isinstance(auto, dict) or not str(auto.get("criteria") or "").strip()):
                raise bad("gate %s: auto needs its criteria (what makes a case simple)" % g["name"])
            if auto and auto.get("decision") and auto["decision"] not in (g.get("pass") or []):
                raise bad("gate %s: auto decision must be a passing decision" % g["name"])
            for dec, route in (g.get("routes") or {}).items():
                if dec not in (g.get("revise") or []):
                    raise bad("gate %s: a route is for a revise decision, not %r" % (g["name"], dec))
                to = (route or {}).get("back_to")
                if to not in index or index[to] >= i or steps[index[to]].get("kind") != "draft":
                    raise bad("gate %s: back_to must name an earlier draft step" % g["name"])
                if i > build_at:
                    raise bad("gate %s: comes after the build and cannot send work back before it" % g["name"])
        for c in s.get("checks") or []:
            if c.get("check") == "judge":
                role = str(c.get("role") or (d.get("judge") or {}).get("role") or "reviewer")
                if role in writers.get(c.get("artifact"), set()):
                    raise bad("step %s: the judge of %s is the role that writes it (%s)" % (s["id"], c.get("artifact"),
                                                                                        role))
    from .needs import validate as needs_ok
    try:
        needs_ok(list(d.get("needs") or []) + [n for s in steps for n in s.get("needs") or []])
    except ValueError as e:
        raise bad(str(e))


def _prompt_names(d: Dict[str, Any]) -> List[str]:
    names = [a["prompt"] for s in d.get("steps") or [] for a in s.get("agents") or []]
    for s in d.get("steps") or []:
        names += [s[k] for k in ("brief", "round") if s.get(k)]
        if any(c.get("check") == "judge" for c in s.get("checks") or []):
            names.append(str((d.get("judge") or {}).get("prompt") or "judge"))
        auto = (s.get("gate") or {}).get("auto")
        if auto:
            names.append(str(auto.get("prompt") or "auto_approve"))
        if (s.get("gate") or {}).get("chat"):
            names.append("gate_chat")
    if any(c.get("severity") == "block" for s in d.get("steps") or [] for c in s.get("checks") or []) \
            or any(c.get("check") == "judge" for s in d.get("steps") or [] for c in s.get("checks") or []):
        names.append("check_feedback")
    return list(dict.fromkeys(names))


# ------------------------------------------------------------------ select

def _all(cfg: Any, repo: str, store: Any = None) -> Tuple["Found", List[Any]]:
    srcs = _sources(cfg, repo, store)
    found: Found = {}
    for src in reversed(srcs):                 # lowest first; the last entry of a stack is the one that counts
        for did, d in src.definitions().items():
            found.setdefault(did, []).append((src.name, d))
    return found, srcs


def _content_version(data: Dict[str, Any], prompts: Dict[str, str]) -> str:
    import hashlib
    raw = json.dumps({"d": data, "p": prompts}, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return "sha-" + hashlib.sha256(raw).hexdigest()[:10]


def _resolve(did: str, found: Found, srcs: List[Any]) -> Resolved:
    src, data = _expand(did, found)
    reg_version = data.pop("_version", None)
    validate(data)
    prompts: Dict[str, str] = {}
    for name in _prompt_names(data):
        inline = (data.get("prompts") or {}).get(name)
        text = inline if isinstance(inline, str) else next((t for t in (s.prompt(name) for s in srcs) if t), None)
        if text is None:
            raise ValueError("process %s: prompt %r not found (.dlc/prompts, %s, seed)" % (did, name, "process_dir"))
        prompts[name] = text
    data = {k: v for k, v in data.items() if k != "prompts"}
    ver = ("v%d" % int(reg_version)) if reg_version is not None and src == "registry" \
        else _content_version(data, prompts)
    return Resolved(did, data, prompts, src, ver)


def _applies(d: Dict[str, Any], flow: str, level: Optional[int]) -> bool:
    a = d.get("applies") or {}
    flows = [str(x).lower() for x in a.get("flows") or []]
    if not flows or flow not in flows:
        return False
    levels = a.get("levels")
    return not levels or level is None or int(level) in [int(x) for x in levels]


def _project_extension(r: Resolved, found: Found, srcs: List[Any]) -> Resolved:
    """A registry process that allows it is extended by the project's own .dlc/process/<id>.json."""
    if not r.source.startswith("registry") or not r.data.get("project_extension"):
        return r
    over = next((d for (src, d) in found.get(r.id) or [] if src == "target"), None)
    if not over:
        return r
    data = merge(r.data, {k: v for k, v in over.items() if k not in ("id", "extends")})
    data["id"] = r.id
    validate(data)
    prompts = dict(r.prompts)
    for name in _prompt_names(data):
        if name not in prompts:
            t = next((t for t in (s.prompt(name) for s in srcs) if t), None)
            if t is None:
                raise ValueError("process %s: prompt %r not found" % (r.id, name))
            prompts[name] = t
    return Resolved(r.id, data, prompts, r.source + "+target", r.version + "+" + _content_version(over, {})[4:])


def _by_ref(ref: str, found: Found, srcs: List[Any], store: Any) -> Resolved:
    """'<id>' or '<id>@<n>' (a registry version). A registry process must be active for a new run."""
    did, _, ver = ref.strip().partition("@")
    if store is not None:
        from . import registry
        row = registry.get(store, did)
        if row is not None:
            registry.usable(store, did)
            v = registry.version(row, int(ver.lstrip("v")) if ver else None)
            if v is None:
                raise ValueError("process %s has no version %s" % (did, ver))
            f = dict(found)
            f[did] = [x for x in found.get(did) or [] if x[0] != "registry"] + \
                [("registry", dict(v["def"], _version=v["v"]))]
            return _project_extension(_resolve(did, f, srcs), found, srcs)
    if ver:
        raise ValueError("process %s: a version can only be named for a registry process" % did)
    return _resolve(did, found, srcs)


def select(cfg: Any, repo: str, flow: str, detail: Optional[Dict[str, Any]] = None,
           store: Any = None) -> Optional[Resolved]:
    """The definition for a run, or None when no definition applies to its flow. A run may name one (detail.process:
    '<id>', '<id>@<version>' or a whole definition that may extend another). ValueError on a definition that cannot
    run, and on a registry process that is not active (naming its successor)."""
    detail = detail or {}
    found, srcs = _all(cfg, repo, store)
    want = detail.get("process")
    if isinstance(want, dict):
        did = str(want.get("id") or "run")
        found.setdefault(did, []).append(("run", want))
        return _resolve(did, found, srcs)
    if isinstance(want, str) and want.strip():
        return _by_ref(want, found, srcs, store)
    level = None
    try:
        level = int(str(detail.get("level") or "").strip() or 0) or None
    except ValueError:
        level = None
    flow = (flow or "").strip().lower()
    order = {"run": 0, "registry": 1, "target": 2, "engine": 3, "seed": 4}
    cands = sorted(found, key=lambda k: (order.get(found[k][-1][0], 9),
                                         -int(found[k][-1][1].get("priority") or 0), k))
    for did in cands:
        if _applies(_expand(did, found)[1], flow, level):
            return _project_extension(_resolve(did, found, srcs), found, srcs)
    return None


def resolve_inline(cfg: Any, repo: str, body: Dict[str, Any], store: Any = None) -> Resolved:
    """A definition given whole (a draft being published): laid over what it extends, validated, prompts found."""
    return select(cfg, repo, "", {"process": body}, store=store)


def frozen(snapshot: Dict[str, Any]) -> Resolved:
    return Resolved(str(snapshot.get("id") or "?"), dict(snapshot.get("def") or {}),
                    dict(snapshot.get("prompts") or {}), str(snapshot.get("source") or "?"),
                    str(snapshot.get("version") or ""))


def catalog(cfg: Any, repo: str = "", store: Any = None) -> List[Dict[str, Any]]:
    """Every definition the engine can see (for the catalog / admin views): id, title, source, flows, steps, gates."""
    found, srcs = _all(cfg, repo, store)
    out = []
    for did in sorted(found):
        try:
            r = _resolve(did, found, srcs)
            out.append({"id": did, "title": r.data.get("title") or did, "source": r.source, "version": r.version,
                        "flows": (r.data.get("applies") or {}).get("flows") or [],
                        "steps": [{"id": s["id"], "kind": s["kind"], "gate": (s.get("gate") or {}).get("name"),
                                   "roles": [a["role"] for a in s.get("agents") or []],
                                   "checks": [c.get("check") for c in s.get("checks") or []]} for s in r.steps()]})
        except ValueError as e:
            out.append({"id": did, "source": found[did][-1][0], "error": str(e)})
    return out


__all__ = ["Resolved", "select", "resolve_inline", "validate", "merge", "frozen", "catalog", "SEED", "TARGET_DIR"]
