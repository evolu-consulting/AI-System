"""Deterministic backend for dry runs: answers come from fixture files, never from a model.

Pack root = config.dry_pack (LINE_DRY_PACK): an existing directory path, or a pack name
resolved as line/samples/<name>. Fixtures live under <pack>/dry/:

  complete(role, key=K)          dry/<role>/<K>.json   (K "" -> "default"); the file's
                                 text is the answer verbatim (it may be malformed on
                                 purpose). Repair retry reads dry/<role>/<K>.repair.json
                                 when present, else the same file again. Without dry/<role>/<K>.json,
                                 dry/<role>/_fallback.json answers any key of that role.
                                 Placeholders {{prompt:REGEX}} in a fixture are replaced by group 1 of
                                 the first match of REGEX in the prompt (JSON string escaped), and
                                 {{prompt*:REGEX}} by every match as a JSON array body ("a","b"):
                                 for answers that must cite ids the prompt carries (event ids, run ids).
  agentic(role, workdir, key=K)  K = "<unit>.<n>" | "<unit>#<n>" | "<unit>/attempt<n>" | "<unit>"
                                 dry/<role>/<unit>/attempt<n>/ is copied into workdir
                                 (a bare "<unit>" uses attempt1/ when it exists, else
                                 dry/<role>/<unit>/ itself). In that dir, _outcome.txt
                                 ("SUBMIT" | "BLOCKED:<reason>") or _outcome.json
                                 ({"outcome", "text"}) gives the result; these are not
                                 copied. Default outcome SUBMIT.

Usage and cost are always zero. A missing fixture -> LineError(LLM_ERROR) naming the path.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Dict, Optional, Tuple

from .. import codes
from ..codes import LineError
from ..config import LINE_DIR
from ..contracts import LlmResult

OUTCOME_FILES = ("_outcome.txt", "_outcome.json", "_outcome")
FALLBACK = "_fallback"
_PLACEHOLDER = re.compile(r"\{\{prompt(\*?):(.+?)\}\}")


def fill_template(text: str, prompt: str) -> str:
    """Replace {{prompt:REGEX}} / {{prompt*:REGEX}} placeholders from the prompt (see module doc)."""
    def one(m: "re.Match[str]") -> str:
        rx = re.compile(m.group(2), re.M)
        if m.group(1) == "*":
            vals = [h if isinstance(h, str) else h[0] for h in rx.findall(prompt or "")]
            return ", ".join(json.dumps(v) for v in dict.fromkeys(vals))
        hit = rx.search(prompt or "")
        return json.dumps(hit.group(1) if hit and hit.groups() else (hit.group(0) if hit else ""))[1:-1]
    return _PLACEHOLDER.sub(one, text) if "{{prompt" in text else text
_ZERO = {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0}
_SAFE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def resolve_pack(dry_pack: str) -> str:
    """Absolute pack root for LINE_DRY_PACK, or LineError(LLM_ERROR) listing what was tried."""
    if not dry_pack:
        raise LineError(codes.LLM_ERROR, "LINE_LLM=fake needs LINE_DRY_PACK (a samples/<pack> dir or pack name)",
                        {"field": "dry_pack"})
    tried = []
    for cand in (dry_pack, os.path.join(LINE_DIR, dry_pack), os.path.join(LINE_DIR, "samples", dry_pack)):
        cand = os.path.abspath(cand)
        tried.append(cand)
        if os.path.isdir(cand):
            return cand
    raise LineError(codes.LLM_ERROR, "dry pack %r not found (tried %s)" % (dry_pack, ", ".join(tried)),
                    {"dry_pack": dry_pack, "tried": tried})


def _seg(name: str, what: str) -> str:
    if not name or not _SAFE.match(name) or name in (".", ".."):
        raise LineError(codes.LLM_ERROR, "bad fixture %s %r" % (what, name), {what: name})
    return name


def parse_agentic_key(key: str) -> Tuple[str, Optional[int]]:
    """'U3#2' / 'U3/attempt2' / 'U3.2' (builder's form) -> ('U3', 2); 'U3' -> ('U3', None)."""
    m = re.match(r"^(.+?)(?:#(\d+)|/attempt(\d+)|\.(\d+))$", key or "")
    if m:
        return m.group(1), int(m.group(2) or m.group(3) or m.group(4))
    return key, None


class FakeBackend:
    name = "fake"
    overhead_tokens = 0

    def __init__(self, config: Any = None, pack_root: Optional[str] = None):
        self._pack_root = pack_root
        self._dry_pack = getattr(config, "dry_pack", "") if config is not None else ""

    @property
    def dry_root(self) -> str:
        root = self._pack_root or resolve_pack(self._dry_pack)
        return os.path.join(root, "dry")

    # ---------------------------------------------------------- complete

    def fixture_path(self, role: str, key: str, repair: bool = False) -> str:
        base = os.path.join(self.dry_root, _seg(role, "role"), _seg(key or "default", "key"))
        return base + (".repair.json" if repair else ".json")

    def raw_complete(self, role: str, prompt: str, model: str, key: str, repair: bool = False) -> LlmResult:
        path = self.fixture_path(role, key, repair)
        if repair and not os.path.isfile(path):
            path = self.fixture_path(role, key, False)
        if not os.path.isfile(path):
            fb = self.fixture_path(role, FALLBACK)
            path = fb if os.path.isfile(fb) else path
        if not os.path.isfile(path):
            raise LineError(codes.LLM_ERROR, "fake LLM: no fixture %s" % path,
                            {"path": path, "role": role, "key": key})
        with open(path, encoding="utf-8") as fh:
            text = fill_template(fh.read(), prompt)
        return LlmResult(None, text.strip(), dict(_ZERO), 0.0, model, "")

    # ---------------------------------------------------------- agentic

    def tree_path(self, role: str, key: str) -> str:
        unit, n = parse_agentic_key(key)
        base = os.path.join(self.dry_root, _seg(role, "role"), _seg(unit, "unit"))
        if n is not None:
            return os.path.join(base, "attempt%d" % n)
        first = os.path.join(base, "attempt1")
        return first if os.path.isdir(first) else base

    def raw_agentic(self, role: str, workdir: str, prompt: str, model: str, max_turns: int,
                    usd_cap: float, key: str) -> LlmResult:
        src = self.tree_path(role, key)
        if not os.path.isdir(src):
            raise LineError(codes.LLM_ERROR, "fake LLM: no fixture tree %s" % src,
                            {"path": src, "role": role, "key": key})
        if not workdir:
            raise LineError(codes.LLM_ERROR, "agentic call without workdir", {"role": role, "key": key})
        os.makedirs(workdir, exist_ok=True)
        shutil.copytree(src, workdir, dirs_exist_ok=True,
                        ignore=lambda d, names: [n for n in names if os.path.abspath(d) == os.path.abspath(src)
                                                 and n in OUTCOME_FILES])
        outcome, text = self._outcome(src)
        return LlmResult(None, text, dict(_ZERO), 0.0, model, outcome)

    @staticmethod
    def _outcome(src: str) -> Tuple[str, str]:
        for name in OUTCOME_FILES:
            path = os.path.join(src, name)
            if not os.path.isfile(path):
                continue
            with open(path, encoding="utf-8") as fh:
                raw = fh.read().strip()
            if name.endswith(".json"):
                try:
                    d: Dict[str, Any] = json.loads(raw)
                except ValueError as e:
                    raise LineError(codes.LLM_ERROR, "fake LLM: bad outcome file %s: %s" % (path, e),
                                    {"path": path}) from e
                outcome = str(d.get("outcome") or "SUBMIT")
                text = str(d.get("text") or outcome)
            else:
                lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
                outcome = lines[-1] if lines else "SUBMIT"
                text = raw or outcome
            if outcome != "SUBMIT" and not outcome.startswith("BLOCKED:"):
                raise LineError(codes.LLM_ERROR, "fake LLM: outcome in %s must be SUBMIT or BLOCKED:<reason>" % path,
                                {"path": path, "outcome": outcome})
            return outcome, text
        return "SUBMIT", "SUBMIT"
