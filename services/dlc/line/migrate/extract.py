"""Pluggable per-stack EXTRACTORS: deterministic facts about one tree, before any model reads it.

A model inventory alone is not enough on a real product: the facts below are what the comparison rules work
on (normalised module names, screens by basename, identifier sets from source files only), and they are
cheap, repeatable and testable.

    facts = extract(tree)          # every registered extractor whose detect(tree) is true, merged

Facts (dict, every list sorted, every path "/"-separated):
  stacks        names of the extractors that ran
  modules       {normalised module name: [paths]}       a deployable unit / package / repo-level folder
  services      {name: path}                            service definitions
  entities      {name: path}                            data model: entities, tables, views
  screens       {basename: [paths]}                     UI views, compared by BASENAME, never by path
  handlers      {name: path}                            behaviour: action handlers, before/on/after hooks
  identifiers   set of names declared in SOURCE files  (the confirmation pass's proof set; never config/json)
  strings       set of names that appear only inside string literals (a destination name is not a feature)
  catalogue     {name: path}                            names that appear ONLY in config / generator
                                                        catalogues (.json/.yaml): "planned, not built"
  fixtures      [paths]                                 test fixtures, excluded from everything above

Extractor interface (add one per stack, register it in EXTRACTORS):
  name: str
  detect(tree) -> bool
  extract(tree, facts) -> None      fills the shared facts dict
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Set

from .tree import FIXTURE_SEGS as FIXTURE_DIRS, NON_SOURCE_EXT, Tree

TEST_DIRS = ("test", "tests", "__tests__", "spec", "e2e")
_IDENT = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
_STRING = re.compile(r"""(['"`])((?:(?!\1).){3,200}?)\1""")


def is_fixture(path: str) -> bool:
    """A test fixture or mock: never a product feature (a fixture 'service' is not a service)."""
    parts = path.lower().split("/")
    return any(p in FIXTURE_DIRS for p in parts[:-1])


def is_test(path: str) -> bool:
    parts = path.lower().split("/")
    base = parts[-1]
    return (any(p in TEST_DIRS for p in parts[:-1]) or base.startswith("test_") or ".test." in base
            or ".spec." in base or base.endswith("_test.py"))


def module_key(name: str) -> str:
    """Normalise a module name across product generations so they compare equal:
    'acme_srv_config_admin', 'srv-config-admin', 'Srv.Config.Admin' -> 'srv-config-admin'.
    A leading product prefix is dropped when a known layer word follows it."""
    parts = [p for p in re.split(r"[^a-z0-9]+", re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()) if p]
    for i, p in enumerate(parts[:-1]):
        if p in LAYER_WORDS and i > 0:
            parts = parts[i:]
            break
    return "-".join(parts)


LAYER_WORDS = {"srv", "db", "app", "ui", "api", "svc", "service", "lib", "core", "web", "mta", "approuter", "router",
               "admin", "common", "shared", "job", "jobs", "batch"}


def screen_key(path: str) -> str:
    """Screens compare by basename: 'webapp/view/npiProject/Detail.view.xml' -> 'detail'."""
    base = path.replace("\\", "/").rsplit("/", 1)[-1]
    for suf in (".view.xml", ".fragment.xml", ".view.js", ".view.ts", ".controller.js", ".controller.ts",
                ".tsx", ".jsx", ".vue", ".html"):
        if base.lower().endswith(suf):
            base = base[: -len(suf)]
            break
    return base.lower()


GENERIC_WORDS = {"service", "services", "srv", "process", "handler", "handlers", "impl", "manager", "controller",
                 "api", "v1", "v2", "new", "old", "base", "default"}


def name_tokens(name: str) -> List[str]:
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", name))
    return [w for w in re.split(r"[^A-Za-z0-9]+", words.lower()) if w]


def rename_key(name: str) -> str:
    """Rename detection: drop generic words, keep order. 'IntegrationProcessService' and 'IntegrationService'
    both give 'integration'; 'BusinessPartnerSrv' and 'BusinessPartnerService' give 'business-partner'."""
    core = [t for t in name_tokens(name) if t not in GENERIC_WORDS]
    return "-".join(core) or "-".join(name_tokens(name))


def empty_facts() -> Dict[str, Any]:
    return {"stacks": [], "modules": {}, "services": {}, "entities": {}, "screens": {}, "handlers": {},
            "identifiers": set(), "strings": set(), "catalogue": {}, "fixtures": []}


class GenericExtractor:
    """Any tree: modules = top-level folders, identifiers declared in source files, strings, catalogues."""
    name = "generic"

    def detect(self, tree: Tree) -> bool:
        return True

    def extract(self, tree: Tree, facts: Dict[str, Any]) -> None:
        declared: Set[str] = set()
        in_strings: Set[str] = set()
        config_names: Dict[str, str] = {}
        for p in tree.files():
            if is_fixture(p):
                facts["fixtures"].append(p)
                continue
            text = tree.read(p)
            ext = os.path.splitext(p)[1].lower()
            if ext in (".json", ".yaml", ".yml"):
                for m in re.finditer(r"\b[A-Z][A-Za-z0-9]{3,}\b", text):
                    config_names.setdefault(m.group(0), p)
                continue
            if ext in NON_SOURCE_EXT:
                continue
            top = p.split("/")[0] if "/" in p else "."
            if top != "." and not is_test(p):
                facts["modules"].setdefault(module_key(top), [])
                if p not in facts["modules"][module_key(top)]:
                    facts["modules"][module_key(top)].append(p)
            strings = " ".join(m.group(2) for m in _STRING.finditer(text))
            code = _STRING.sub(" ", text)
            code = re.sub(r"#.*|//.*", " ", code)
            declared |= set(_IDENT.findall(code))
            in_strings |= set(_IDENT.findall(strings))
            for m in re.finditer(r"^\s*(?:def|class)\s+([A-Za-z_]\w+)", text, re.M):
                if is_test(p):
                    continue
                if m.group(1).endswith(("Handler", "handler")) or m.group(1).startswith(("on_", "handle_")):
                    facts["handlers"].setdefault(m.group(1), p)
        facts["identifiers"] |= declared
        facts["strings"] |= (in_strings - declared)
        for n, p in config_names.items():
            if n not in declared:
                facts["catalogue"].setdefault(n, p)


_CDS_DECL = re.compile(r"\b(service|entity|view|type|aspect|action|function|event)\s+([A-Za-z_][\w.]*)")
_UI5_CTRL = re.compile(r"""Controller\.extend\(\s*["']([\w.]+)["']|controllerName\s*=\s*["']([\w.]+)["']""")
_CAP_HOOK = re.compile(r"""\b(?:this|srv|service)\.(before|on|after)\(\s*\[?\s*["'`]?([\w*]+)["'`]?(?:\s*,\s*["'`]([\w.]+)["'`])?""")


class CdsUi5Extractor:
    """CAP / CDS backend + UI5 (or React) frontend: services, entities and views from .cds / .csn, CAP event
    handlers from .js / .ts, UI5 views by basename, controllers."""
    name = "cap-cds-ui5"

    def detect(self, tree: Tree) -> bool:
        return any(p.endswith((".cds", ".csn")) or p.endswith(".view.xml") for p in tree.files())

    def extract(self, tree: Tree, facts: Dict[str, Any]) -> None:
        for p in tree.files():
            if is_fixture(p):
                continue
            low = p.lower()
            text = tree.read(p)
            if low.endswith(".cds"):
                for kind, name in _CDS_DECL.findall(re.sub(r"//.*|/\*.*?\*/", " ", text, flags=re.S)):
                    short = name.rsplit(".", 1)[-1]
                    facts["identifiers"].add(short)
                    if kind == "service":
                        facts["services"].setdefault(short, p)
                    elif kind in ("entity", "view"):
                        facts["entities"].setdefault(short, p)
                    elif kind in ("action", "function"):
                        facts["handlers"].setdefault(short, p)
            elif low.endswith(".csn"):
                for m in re.finditer(r'"([\w.]+)"\s*:\s*\{\s*"kind"\s*:\s*"(service|entity|view)"', text):
                    short = m.group(1).rsplit(".", 1)[-1]
                    facts["identifiers"].add(short)
                    (facts["services"] if m.group(2) == "service" else facts["entities"]).setdefault(short, p)
            elif low.endswith((".view.xml", ".fragment.xml")) or (low.endswith((".tsx", ".jsx")) and "/view" in low):
                if not is_test(p):
                    facts["screens"].setdefault(screen_key(p), [])
                    facts["screens"][screen_key(p)].append(p)
                for a, b in _UI5_CTRL.findall(text):
                    facts["identifiers"].add((a or b).rsplit(".", 1)[-1])
            elif low.endswith((".js", ".ts")) and not is_test(p):
                for m in _CAP_HOOK.finditer(text):
                    ev, target = m.group(2), m.group(3) or ""
                    key = "%s %s%s" % (m.group(1), ev, (" " + target) if target else "")
                    facts["handlers"].setdefault(key, p)
                for m in re.finditer(r"\bclass\s+(\w+)|\bfunction\s+(\w+)|\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(",
                                     text):
                    facts["identifiers"].add(m.group(1) or m.group(2) or m.group(3))
                for m in _UI5_CTRL.finditer(text):
                    facts["identifiers"].add((m.group(1) or m.group(2)).rsplit(".", 1)[-1])
        facts["strings"] -= facts["identifiers"]
        for n in list(facts["catalogue"]):
            if n in facts["identifiers"]:
                del facts["catalogue"][n]


EXTRACTORS: List[Any] = [GenericExtractor(), CdsUi5Extractor()]


def extract(tree: Tree, extractors: Iterable[Any] = ()) -> Dict[str, Any]:
    facts = empty_facts()
    for ex in list(extractors) or EXTRACTORS:
        if ex.detect(tree):
            ex.extract(tree, facts)
            facts["stacks"].append(ex.name)
    for k in ("modules", "screens"):
        facts[k] = {n: sorted(set(v)) for n, v in sorted(facts[k].items())}
    for k in ("services", "entities", "handlers", "catalogue"):
        facts[k] = dict(sorted(facts[k].items()))
    facts["fixtures"] = sorted(set(facts["fixtures"]))
    return facts


def serialisable(facts: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(facts)
    out["identifiers"] = sorted(facts["identifiers"])
    out["strings"] = sorted(facts["strings"])
    return out


def compare(f1: Dict[str, Any], f2: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic surface comparison with the method rules: modules by normalised name, screens by
    basename, services / entities by name then by rename key; a one-sided name is re-checked against the
    other side's SOURCE identifier set, never against config. Returns per kind {both, renamed, v1_only,
    v2_only, notes}."""
    out: Dict[str, Any] = {}
    for kind in ("modules", "screens", "services", "entities"):
        a, b = set(f1[kind]), set(f2[kind])
        both = sorted(a & b)
        ra = {rename_key(x): x for x in a - b}
        rb = {rename_key(x): x for x in b - a}
        renamed = sorted((ra[k], rb[k]) for k in set(ra) & set(rb) if kind in ("services", "entities"))
        ren1, ren2 = {x for x, _ in renamed}, {y for _, y in renamed}
        only1 = sorted(a - b - ren1)
        only2 = sorted(b - a - ren2)
        notes: Dict[str, str] = {}
        if kind in ("services", "entities"):
            for n in list(only1):
                if n in f2["identifiers"]:
                    notes[n] = "declared in the other tree's source (not as a %s): re-check" % kind[:-1]
                elif n in f2["catalogue"]:
                    notes[n] = "planned, not built: named only in %s" % f2["catalogue"][n]
                elif n in f2["strings"]:
                    notes[n] = "appears in the other tree only as a string (a destination or label)"
            for n in list(only2):
                if n in f1["identifiers"]:
                    notes[n] = "declared in the other tree's source (not as a %s): re-check" % kind[:-1]
        out[kind] = {"both": both, "renamed": renamed, "v1_only": only1, "v2_only": only2, "notes": notes}
    return out


__all__ = ["EXTRACTORS", "GenericExtractor", "CdsUi5Extractor", "extract", "compare", "serialisable",
           "module_key", "screen_key", "rename_key", "is_fixture", "is_test"]
