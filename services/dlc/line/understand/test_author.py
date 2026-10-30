"""Block 9a: acceptance test author.

author_tests(digest, llm, repo) -> [AccTest]
  One model call per F-item (role test_author, fixture key = F-item id). The model never
  sees code; it gets the F-item, its criteria (Given/When/Then + the verbatim quote) and,
  when the pack is given, the span text. It answers strict JSON:
      {"path": "tests/acceptance/test_f2.py", "content": "<unittest module>",
       "tests": [{"criterion": "F2.C1", "span_id": "spec.md#L10-14", "name": "TestF2.test_c1"}]}
  Code checks the trace before writing anything: path under tests/acceptance/, every test
  names a criterion of that F-item and that criterion's span (or one of the F-item's spans),
  the method and the trace tag "trace: <criterion> <span_id>" are in the file, and every
  criterion has a test. Problems are fed back once; still wrong -> LineError(TEST_UNTRACED).
  Files are written into repo (with package __init__.py files); rows go to the store unlocked.
  A path already taken in repo holds the locked tests of an earlier run (enhancement, bug fix): it is
  never overwritten; the file goes to test_<run tag>_f2.py (Node: <run tag>_f2.test.js) instead, and
  the earlier run's tests stay where they are for the regression net.
"""

from __future__ import annotations

import ast
import json
import os
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .. import codes, stacks
from ..codes import LineError
from ..contracts import E_ACC_TEST, AccTest, Digest, FItem, LlmPort, PackVersion, Store, to_dict
from ._common import load_prompt

ROLE = "test_author"
TEST_DIR = "tests/acceptance"
TEST_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["path", "content", "tests"],
    "properties": {
        "path": {"type": "string"},
        "content": {"type": "string"},
        "tests": {"type": "array", "items": {
            "type": "object", "required": ["criterion", "span_id", "name"],
            "properties": {"criterion": {"type": "string"}, "span_id": {"type": "string"}, "name": {"type": "string"}},
        }},
        # optional: what the planner / builders must know (line.agent_messages), e.g. the module the tests import
        "messages": {"type": "array", "items": {
            "type": "object", "required": ["to", "text"],
            "properties": {"to": {"type": "array", "items": {"type": "string"}}, "text": {"type": "string"}},
        }},
    },
}
_NAME_RE = re.compile(r"^[A-Za-z_]\w*\.test\w*$")
_PATH_RE = re.compile(r"^[A-Za-z0-9_/]+/test_\w+\.py$")


def trace_tag(criterion: str, span_id: str) -> str:
    return "trace: %s %s" % (criterion, span_id)


def module_of(path: str) -> str:
    return path[:-3].replace("/", ".")


def shared_span_ids(pack: Optional[PackVersion], f_items: Sequence[FItem]) -> List[str]:
    """Spans of the pack no F-item owns (overview, interface, storage format ...): every F-item's tests
    and builds need them, e.g. how the program is run."""
    if pack is None:
        return []
    owned = {c.span_id for f in f_items for c in f.criteria}         # the sections that define F-items
    return [s.id for s in pack.spans if s.id not in owned and s.text.strip()]


def _prompt(f: FItem, pack: Optional[PackVersion], problems: Sequence[str], shared: Sequence[str] = (),
            st: Any = None, earlier: Optional[Mapping[str, Any]] = None) -> str:
    spans = {s.id: s for s in pack.spans} if pack else {}
    if st is not None and not st.is_python:     # non-Python target stack: its file, naming and runner
        target = ["The test file is %s. Do not use any tool and do not write files: put the whole file in the"
                  " \"content\" field of your JSON answer. This target is NOT Python: ignore the unittest rules"
                  " above and follow the stack section below. Example test name: %s"
                  % (st.target_file(f.id), st.name_example()), "", st.test_author_hint]
    else:
        target = ["The test file is %s/test_%s.py. Do not use any tool and do not write files: put the whole"
                  " module in the \"content\" field of your JSON answer." % (TEST_DIR, re.sub(r"\W", "_", f.id.lower()))]
    lines = [load_prompt(ROLE), "", "## Target"] + target + ["",
             "## F-item %s: %s" % (f.id, f.title), "Quote: %s" % json.dumps(f.quote, ensure_ascii=False), "",
             "## Criteria"]
    for c in f.criteria:
        lines += ["- id: %s" % c.id, "  span_id: %s" % c.span_id, "  text: %s" % c.text,
                  "  given: %s" % c.given, "  when: %s" % c.when, "  then: %s" % c.then,
                  "  quote: %s" % json.dumps(c.quote, ensure_ascii=False)]
    common = [s for s in shared if s in spans]
    if common:
        lines += ["", "## Spec text shared by every F-item (interface, storage format: use exactly these names)"]
        for s in common:
            lines += ["=== SPAN %s ===" % s, spans[s].text, "=== END %s ===" % s]
    used = [s for s in dict.fromkeys(list(f.span_ids) + [c.span_id for c in f.criteria]) if s in spans]
    if used:
        lines += ["", "## Spec text"]
        for s in used:
            lines += ["=== SPAN %s ===" % s, spans[s].text, "=== END %s ===" % s]
    if earlier and earlier.get("content"):
        lines += ["", "## The tests an earlier attempt of this request locked for %s (%s)" % (f.id, earlier.get("path")),
                  "They were found wrong: %s" % (earlier.get("note") or "see the note at the end of the spec"),
                  "Keep what is right and change only what is wrong; the same test names are fine.",
                  "=== FILE ===", str(earlier["content"])[:20000], "=== END FILE ==="]
    if problems:
        lines += ["", "## Your previous answer was rejected. Fix:"] + ["- " + p for p in problems]
    return "\n".join(lines)


def _validate_stack(f: FItem, data: Mapping[str, Any], test_dir: str, st: Any) -> List[str]:
    """validate_answer for a non-Python target stack: same trace rules, the stack's files and names."""
    probs: List[str] = []
    path = str(data.get("path") or "").replace("\\", "/").strip()
    content = str(data.get("content") or "")
    if not st.path_ok(path) or ".." in path or not path.startswith(test_dir.rstrip("/") + "/"):
        probs.append("path %r must be under %s/ like %s" % (path, test_dir, st.target_file(f.id)))
    err = st.compile_error(path, content.encode("utf-8"))
    if err:
        return probs + ["content does not parse: %s" % err]
    defined = st.defined_tests(path, content)
    if defined is None:
        return probs + ["content is empty or defines no tests"]
    crit = {c.id: c for c in f.criteria}
    covered = set()
    names = set()
    for t in data.get("tests") or []:
        cid, sid, name = str(t.get("criterion", "")), str(t.get("span_id", "")), str(t.get("name", ""))
        if cid not in crit:
            probs.append("test %s traces to unknown criterion %r of %s" % (name, cid, f.id))
            continue
        if sid != crit[cid].span_id and sid not in f.span_ids:
            probs.append("test %s: span %r is not a span of %s" % (name, sid, cid))
            continue
        if not st.name_ok(name) or name not in defined:
            probs.append("test %r is not '<path>::<describe title> <test title>' of a test defined in the file "
                         "(found: %s)" % (name, ", ".join(sorted(defined)[:6]) or "none"))
            continue
        if name in names:
            probs.append("test %s listed twice" % name)
            continue
        if trace_tag(cid, sid) not in content:
            probs.append("file lacks the tag %r" % trace_tag(cid, sid))
            continue
        names.add(name)
        covered.add(cid)
    for cid in crit:
        if cid not in covered:
            probs.append("criterion %s has no traced test" % cid)
    return probs


def validate_answer(f: FItem, data: Mapping[str, Any], test_dir: str = TEST_DIR, st: Any = None) -> List[str]:
    """Trace / shape problems of one test-author answer ([] = fine)."""
    if st is not None and not st.is_python:
        return _validate_stack(f, data, test_dir, st)
    probs: List[str] = []
    path = str(data.get("path") or "").replace("\\", "/").strip()
    content = str(data.get("content") or "")
    if not _PATH_RE.match(path) or ".." in path or not path.startswith(test_dir.rstrip("/") + "/"):
        probs.append("path %r must be %s/test_<name>.py" % (path, test_dir))
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        return probs + ["content does not parse: %s" % e]
    methods = {"%s.%s" % (n.name, m.name) for n in ast.walk(tree) if isinstance(n, ast.ClassDef)
               for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}
    crit = {c.id: c for c in f.criteria}
    covered = set()
    names = set()
    for t in data.get("tests") or []:
        cid, sid, name = str(t.get("criterion", "")), str(t.get("span_id", "")), str(t.get("name", ""))
        if cid not in crit:
            probs.append("test %s traces to unknown criterion %r of %s" % (name, cid, f.id))
            continue
        if sid != crit[cid].span_id and sid not in f.span_ids:
            probs.append("test %s: span %r is not a span of %s" % (name, sid, cid))
            continue
        if not _NAME_RE.match(name) or name not in methods:
            probs.append("test %r is not a Class.test_method defined in the file" % name)
            continue
        if name in names:
            probs.append("test %s listed twice" % name)
            continue
        if trace_tag(cid, sid) not in content:
            probs.append("file lacks the tag %r" % trace_tag(cid, sid))
            continue
        names.add(name)
        covered.add(cid)
    for cid in crit:
        if cid not in covered:
            probs.append("criterion %s has no traced test" % cid)
    return probs


def run_tag(run: str) -> str:
    """Short tag of a run for its test file names: the random tail of the run id (R20261016-033906-e5c4 -> e5c4)."""
    tail = re.sub(r"\W", "_", (run or "").rsplit("-", 1)[-1].lower()).strip("_")
    return tail or "run"


def free_path(repo: str, rel: str, run: str = "") -> str:
    """rel, or when a file is already there (an earlier run's locked tests) the same name with this run's tag,
    then a counter: tests/acceptance/test_f1.py -> tests/acceptance/test_e5c4_f1.py -> ..._f1_2.py."""
    if not os.path.exists(os.path.join(repo, *rel.split("/"))):
        return rel
    head, _, base = rel.rpartition("/")
    pre = "test_" if base.startswith("test_") else ""
    stem, dot, ext = base[len(pre):].partition(".")
    for n in range(1, 100):
        cand = "%s/%s%s_%s%s%s%s" % (head, pre, run_tag(run), stem, "" if n == 1 else "_%d" % n, dot, ext)
        if not os.path.exists(os.path.join(repo, *cand.split("/"))):
            return cand
    raise LineError(codes.TEST_UNTRACED, "no free test file name next to %s" % rel, {"path": rel})


def _write(repo: str, rel: str, content: str, packages: bool = True) -> None:
    full = os.path.join(repo, *rel.split("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    parts = rel.split("/")[:-1] if packages else []
    for i in range(1, len(parts) + 1):
        init = os.path.join(repo, *parts[:i], "__init__.py")
        if not os.path.exists(init):
            with open(init, "w", encoding="utf-8", newline="\n"):
                pass
    with open(full, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(content if content.endswith("\n") else content + "\n")


def _post_messages(run: str, data: Mapping[str, Any], f_id: str) -> None:
    """The answer's optional messages go to the run's project, tagged for the roles named (line.agent_messages)."""
    if not run or not isinstance(data.get("messages"), list):
        return
    try:
        from .. import agent_messages, runboard
        ctx = runboard._ctx(run)
        if ctx is None:
            return
        store, cfg, project = ctx
        for m in data["messages"][:4]:
            if isinstance(m, Mapping) and str(m.get("text") or "").strip():
                agent_messages.post(store, cfg, project, run, "test_author", m.get("to") or ["planner"], "handoff",
                                    "%s: %s" % (f_id, m["text"]))
    except Exception:   # noqa: BLE001 - a message helps; it never fails the tests
        pass


def author_tests(digest: Digest, llm: LlmPort, repo: str, *, run: str = "", store: Optional[Store] = None,
                 pack: Optional[PackVersion] = None, model: Optional[str] = None, retries: int = 1,
                 test_dir: str = TEST_DIR, only: Optional[Sequence[str]] = None,
                 earlier: Optional[Mapping[str, Mapping[str, Any]]] = None) -> List[AccTest]:
    """only: the F-items to write tests for (a supervised retry keeps the others' locked tests); earlier:
    {F-item: {path, content, note}} the tests an earlier attempt locked and the supervisor found wrong."""
    answers = []
    shared = shared_span_ids(pack, digest.f_items)
    st = stacks.for_repo(repo)
    st = None if st.is_python else st
    for f in digest.f_items:
        if only is not None and f.id not in only:
            continue
        if not f.criteria:
            raise LineError(codes.TEST_UNTRACED, "F-item %s has no criteria to test" % f.id, {"f_item": f.id})
        problems: List[str] = []
        for _ in range(retries + 1):
            res = llm.complete(ROLE, _prompt(f, pack, problems, shared, st, (earlier or {}).get(f.id)), TEST_SCHEMA,
                               key=f.id, model=model, run=run)
            data = res.data if isinstance(res.data, Mapping) else {}
            problems = validate_answer(f, data, test_dir, st) if data else ["answer is not a JSON object"]
            if not problems:
                break
        if problems:
            raise LineError(codes.TEST_UNTRACED, "tests for %s are not traced to the spec" % f.id,
                            {"f_item": f.id, "problems": problems})
        answers.append((f, data))
        _post_messages(run, data, f.id)

    out: List[AccTest] = []
    seen_paths: Dict[str, str] = {}
    for f, data in answers:
        path = str(data["path"]).replace("\\", "/").strip()
        if path in seen_paths and seen_paths[path] != f.id:
            raise LineError(codes.TEST_UNTRACED, "%s and %s share test file %s" % (seen_paths[path], f.id, path),
                            {"path": path})
        seen_paths[path] = f.id
        asked, path = path, free_path(repo, path, run)       # never over an earlier run's locked tests
        _write(repo, path, str(data["content"]), packages=st is None)
        count: Dict[str, int] = {}
        for t in data["tests"]:
            cid = str(t["criterion"])
            count[cid] = count.get(cid, 0) + 1
            tid = "T_" + re.sub(r"\W", "_", cid) + ("" if count[cid] == 1 else "_%d" % count[cid])
            name = str(t["name"])
            if st is not None and name.startswith(asked + "::"):
                name = path + name[len(asked):]
            acc = AccTest(id=tid, f_item=f.id, criterion=cid, span_id=str(t["span_id"]), path=path,
                          name="%s.%s" % (module_of(path), name) if st is None else name)
            out.append(acc)
            if store is not None:
                store.put(E_ACC_TEST, "%s:%s" % (run, tid) if run else tid, dict(to_dict(acc), run=run), run=run)
    return out


__all__ = ["author_tests", "shared_span_ids", "free_path", "run_tag", "validate_answer", "trace_tag", "module_of", "TEST_DIR", "TEST_SCHEMA", "ROLE"]
