"""The feature migration as a resumable state machine over the store (row E_MIGRATION, events migration.*).

    m = Migrator(store, cfg)
    mid = m.admit({"v1": ..., "v2": ..., "v1_ref"?, "v1_base"?, "v2_ref"?, "notes"?, "mode"?, "scope"?, "build"?,
                   "v1_repos"?, "v2_repos"?})   # v1 / v2: a git repository OR a folder of repositories (estate)
    m.drive(mid)                      # runs until green / escalated / analysed, or parks (ask mode) / waits on
                                      # a parked build run; drive() again continues from the stored state
    m.answer(mid, [{"conflict": "C1", "choice": "v2"}], who="pm")   # then drive() again

States: admitted -> inventoried -> matched -> parked? -> decided -> building -> verifying -> green
        | analysed (build=false, the target stack is not supported, or v2 is several repositories)
        | escalated {code}
Budget: the migration's own model calls are capped by max_usd (LINE_MIGRATE_MAX_USD) and each repository's
scan by max_usd_repo (LINE_MIGRATE_MAX_USD_REPO); the build run gets what is left as its run budget. Used up
-> escalated MIGRATION_BUDGET with detail.resume_state; m.reopen(mid, max_usd=...) puts it back there.
Artefacts: <workroot>/migrations/<id>/ (see docs/dlc/feature-migration.md).
"""

from __future__ import annotations

import dataclasses
import json
import os
import time
import traceback
import uuid
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from .. import codes
from ..codes import LineError
from ..config import Config, load_config
from ..contracts import (E_ESCALATION, E_MIG_CONFLICT, E_MIG_FEATURE, E_MIGRATION, E_RUN, TERMINAL_RUN_STATES, Envelope,
                         RunState, now_ms)
from ..llm import make_llm
from ..ship._util import git
from ..statemachine import update_row
from . import blast as blast_mod
from . import budget as budget_mod
from . import scancache as scancache_mod
from . import conflicts as conflicts_mod
from . import inventory as inventory_mod
from . import match as match_mod
from . import matrix as matrix_mod
from . import report as report_mod
from . import effort as effort_mod
from . import extract as extract_mod
from . import estate as estate_mod
from . import scan as scan_mod
from . import specgen, verify
from .tree import Tree

MODES = ("ask", "decide")
FINAL = ("green", "escalated", "analysed")
STATES = ("admitted", "inventoried", "matched", "parked", "decided", "building", "verifying") + FINAL


def new_id() -> str:
    return "M%s-%s" % (time.strftime("%Y%m%d-%H%M%S"), uuid.uuid4().hex[:4])


class Stop(Exception):
    """Non-terminal stop (parked on conflicts, or the build run waits)."""


class Done(Exception):
    """Terminal end that is not a failure (green, analysed)."""

    def __init__(self, state: str, code: str = ""):
        super().__init__(state)
        self.state, self.code = state, code


class Fail(Exception):
    def __init__(self, code: str, message: str, detail: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code, self.message, self.detail = code, message, dict(detail or {})


class Migrator:
    def __init__(self, store: Any, cfg: Optional[Config] = None, *, llm: Any = None,
                 pipeline_factory: Optional[Callable[[], Any]] = None, log: Optional[Callable[[str], None]] = None):
        self.store = store
        self.cfg = cfg or load_config()
        self._llm = llm
        self.pipeline_factory = pipeline_factory
        self.log = log or (lambda msg: None)

    # ------------------------------------------------------------------ helpers

    @property
    def llm(self) -> Any:
        if self._llm is None:
            # the per-run cap (LINE_MAX_USD_RUN) is for build runs; a migration has its own budget, enforced
            # by BudgetedLlm on the migration row, so the inner port runs without a run cap
            inner = make_llm(dataclasses.replace(self.cfg, max_usd_run=0.0), self.store)
            self._llm = budget_mod.BudgetedLlm(inner, self._budget_or_none)
        elif not isinstance(self._llm, budget_mod.BudgetedLlm):
            self._llm = budget_mod.BudgetedLlm(self._llm, self._budget_or_none)
        return self._llm

    def limits(self, row: Mapping[str, Any]) -> Dict[str, float]:
        def num(v: Any, default: float) -> float:
            try:
                return float(v) if v not in (None, "") else float(default)
            except (TypeError, ValueError):
                return float(default)
        return {"max_usd": num(row.get("max_usd"), getattr(self.cfg, "migrate_max_usd", 50.0)),
                "max_usd_repo": num(row.get("max_usd_repo"), getattr(self.cfg, "migrate_max_usd_repo", 3.0))}

    def budget(self, mid: str) -> budget_mod.MigrationBudget:
        lim = self.limits(self._row(mid))
        return budget_mod.MigrationBudget(self.store, mid, limit=lim["max_usd"], limit_repo=lim["max_usd_repo"],
                                          warn_ratio=float(getattr(self.cfg, "budget_warn_ratio", 0.8)),
                                          emit=lambda kind, body: self._emit(mid, kind, body))

    def _budget_or_none(self, run: str) -> Optional[budget_mod.MigrationBudget]:
        return self.budget(run) if run and self.store.get(E_MIGRATION, run) is not None else None

    def _env(self, mid: str) -> Envelope:
        return Envelope(run=mid, agent_version=self.cfg.agent_version, model=self.cfg.model)

    def _emit(self, mid: str, kind: str, body: Mapping[str, Any]) -> None:
        self.store.emit(kind, self._env(mid), dict(body))

    def _row(self, mid: str) -> Dict[str, Any]:
        row = self.store.get(E_MIGRATION, mid)
        if row is None:
            raise LineError(codes.NOT_FOUND, "migration %s" % mid, {"migration": mid})
        return row

    def _set(self, mid: str, **kv: Any) -> Dict[str, Any]:
        kv["updated_ms"] = now_ms()
        return update_row(self.store, E_MIGRATION, mid, kv)

    def _dir(self, mid: str) -> str:
        d = os.path.join(self.cfg.workroot, "migrations", mid)
        os.makedirs(d, exist_ok=True)
        return d

    def _write(self, mid: str, name: str, data: Any) -> str:
        path = os.path.join(self._dir(mid), name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            if isinstance(data, str):
                fh.write(data)
            else:
                json.dump(data, fh, indent=2, ensure_ascii=False)
        return path

    def _read(self, mid: str, name: str, default: Any = None) -> Any:
        path = os.path.join(self._dir(mid), name)
        if not os.path.isfile(path):
            return default
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    def _features(self, mid: str) -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for side in ("v1", "v2"):
            for f in (self._read(mid, "inventory-%s.json" % side, {}) or {}).get("features") or []:
                out[f["id"]] = f
        return out

    def _conflicts(self, mid: str) -> List[Dict[str, Any]]:
        rows = self.store.query(E_MIG_CONFLICT, run=mid)
        return sorted(rows, key=lambda c: int(str(c["id"]).lstrip("C") or 0))

    def _put_conflict(self, mid: str, c: Mapping[str, Any]) -> None:
        self.store.put(E_MIG_CONFLICT, "%s:%s" % (mid, c["id"]), dict(c, migration=mid), run=mid)

    # ------------------------------------------------------------------ public

    def admit(self, params: Mapping[str, Any]) -> str:
        v1, v2 = str(params.get("v1") or ""), str(params.get("v2") or "")
        if not v1 or not v2:
            raise LineError(codes.CONFIG_INVALID, "v1 and v2 repository paths are required", {"field": "v1/v2"})
        mode = str(params.get("mode") or "ask")
        if mode not in MODES:
            raise LineError(codes.CONFIG_INVALID, "mode must be ask or decide", {"field": "mode", "value": mode})
        for p in (v1, v2):
            if not os.path.isdir(p):
                raise LineError(codes.NOT_FOUND, "%s does not exist" % p, {"path": p})
        v1_ref, v2_ref = str(params.get("v1_ref") or ""), str(params.get("v2_ref") or "")
        m1, m2 = str(params.get("v1_repos") or ""), str(params.get("v2_repos") or "")
        repos1 = estate_mod.detect(v1, manifest=m1, default_ref=v1_ref)
        repos2 = estate_mod.detect(v2, manifest=m2, default_ref=v2_ref)
        v2_estate = estate_mod.is_estate(repos2)
        v2_head = ""
        if not v2_estate:
            head = git(v2, "symbolic-ref", "-q", "HEAD", check=False).stdout.strip()
            if head != "refs/heads/main":
                raise LineError(codes.STATE_CONFLICT, "v2 must have branch main checked out (has %s)" % head,
                                {"v2": v2, "head": head})
            v2_head = git(v2, "rev-parse", "HEAD").stdout.strip()
        if v2_ref and not v2_estate:
            want = git(v2, "rev-parse", "-q", "--verify", v2_ref + "^{commit}", check=False).stdout.strip()
            if want != v2_head:
                raise LineError(codes.STATE_CONFLICT, "v2 main is at %s, not at %s" % (v2_head[:12], v2_ref),
                                {"v2_head": v2_head, "v2_ref": v2_ref})
        notes_path = str(params.get("notes") or "")
        notes = ""
        if notes_path:
            if not os.path.isfile(notes_path):
                raise LineError(codes.NOT_FOUND, "notes %s not found" % notes_path, {"path": notes_path})
            with open(notes_path, encoding="utf-8", errors="replace") as fh:
                notes = fh.read()[:20000]
        scope = params.get("scope") or []
        if isinstance(scope, str):
            scope = [s for s in scope.replace(",", " ").split() if s]
        mid = str(params.get("id") or new_id())
        t = now_ms()
        row = {"id": mid, "state": "admitted", "v1": os.path.abspath(v1), "v1_ref": v1_ref,
               "v1_base": str(params.get("v1_base") or ""), "v2": os.path.abspath(v2), "v2_ref": v2_ref,
               "v2_head": v2_head, "notes": notes, "notes_path": notes_path, "mode": mode,
               "scope": [str(s) for s in scope], "build": params.get("build", True) not in (False, "false", "0", 0),
               "run": "", "code": "", "message": "", "counts": {}, "dir": "", "created_ms": t, "updated_ms": t,
               "run_ids": [], "v1_repos": m1, "v2_repos": m2,
               "max_usd": _usd(params.get("max_usd"), getattr(self.cfg, "migrate_max_usd", 50.0)),
               "max_usd_repo": _usd(params.get("max_usd_repo"), getattr(self.cfg, "migrate_max_usd_repo", 3.0)),
               "spent_usd": 0.0, "repo_usd": {}, "budget_warned": [],
               "v1_kind": "estate" if estate_mod.is_estate(repos1) else "repo",
               "v2_kind": "estate" if v2_estate else "repo",
               "repo_counts": {"v1": len(repos1), "v2": len(repos2)}}
        self.store.put(E_MIGRATION, mid, row, run=mid)
        self._set(mid, dir=self._dir(mid))
        self._write(mid, "repos-v1.json", repos1)
        self._write(mid, "repos-v2.json", repos2)
        self._emit(mid, codes.MIGRATION_ADMITTED, {"v1": row["v1"], "v2": row["v2"], "mode": mode,
                                                   "v1_base": row["v1_base"], "scope": row["scope"],
                                                   "v1_repos": len(repos1), "v2_repos": len(repos2)})
        return mid

    def drive(self, mid: str) -> Dict[str, Any]:
        row = self._row(mid)
        state = row["state"]
        try:
            for _ in range(len(STATES) + 2):
                state = row["state"]
                if state in FINAL:
                    break
                getattr(self, "_s_" + state)(mid, row)
                row = self._row(mid)
        except Stop as e:
            self.log("%s: waits (%s)" % (mid, e))
        except Done as e:
            self._end(mid, e.state, e.code, "", {})
        except Fail as e:
            self._end(mid, "escalated", e.code, e.message, _resumable(e.code, e.detail, state))
        except LineError as e:
            self._end(mid, "escalated", e.code, e.message, _resumable(e.code, e.detail, state))
        except Exception as e:   # noqa: BLE001 - a bug still ends the migration cleanly, with the trace
            self._end(mid, "escalated", codes.BUILD_FAIL, "internal error: %s: %s" % (type(e).__name__, e),
                      {"trace": traceback.format_exc()[-3000:]})
        return self._row(mid)

    def answer(self, mid: str, answers: Sequence[Mapping[str, Any]], who: str = "") -> Dict[str, Any]:
        row = self._row(mid)
        if row["state"] not in ("parked", "matched"):
            raise LineError(codes.STATE_CONFLICT, "migration %s is %s, not waiting for decisions" % (mid, row["state"]),
                            {"migration": mid, "state": row["state"]})
        by = {c["id"]: c for c in self._conflicts(mid)}
        results = []
        for a in answers:
            cid, choice = str(a.get("conflict") or ""), str(a.get("choice") or "")
            if cid not in by:
                raise LineError(codes.NOT_FOUND, "conflict %s" % cid, {"conflict": cid})
            allowed = conflicts_mod.choices(by[cid])
            if choice not in allowed:
                raise LineError(codes.SCHEMA_INVALID, "choice must be one of %s" % ", ".join(allowed),
                                {"choice": choice, "allowed": allowed})
            self._decide(mid, by[cid], choice, who or "person")
            results.append({"conflict": cid, "choice": choice})
        remaining = [c["id"] for c in self._conflicts(mid) if not c.get("choice")]
        return {"migration": mid, "results": results, "remaining": remaining, "resume": not remaining}

    def reopen(self, mid: str, max_usd: Any = None, max_usd_repo: Any = None, rescan: bool = False
               ) -> Dict[str, Any]:
        """Make a stopped migration drivable again. A migration that ran out of budget goes back to the stage
        it stopped in (raise the cap first: max_usd / max_usd_repo here); rescan=True goes back to the
        repository scan (cached repositories are kept). Anything else that is not final: nothing to undo."""
        row = self._row(mid)
        kv: Dict[str, Any] = {}
        if max_usd not in (None, ""):
            kv["max_usd"] = _usd(max_usd, 0.0)
        if max_usd_repo not in (None, ""):
            kv["max_usd_repo"] = _usd(max_usd_repo, 0.0)
        if kv:
            row = self._set(mid, **kv)
        state, code = row["state"], row.get("code") or ""
        if state == "escalated" and code == codes.MIGRATION_BUDGET:
            lim = self.limits(row)
            detail = row.get("detail") or {}
            scope = detail.get("scope") or "total"
            spent = float(row.get("spent_usd") or 0.0)
            if lim["max_usd"] > 0 and spent >= lim["max_usd"] - budget_mod.EPS:
                raise LineError(codes.STATE_CONFLICT, "migration %s spent $%.2f of $%.2f: raise max_usd to resume"
                                % (mid, spent, lim["max_usd"]), {"migration": mid, "spent": spent,
                                                                 "limit": lim["max_usd"]})
            if scope == "repo" and not kv.get("max_usd_repo"):
                raise LineError(codes.STATE_CONFLICT, "a repository scan used its budget: raise max_usd_repo to resume",
                                {"migration": mid, "repos": detail.get("repos") or [detail.get("repo")]})
            to = "admitted" if rescan else str(detail.get("resume_state") or "admitted")
            if to not in STATES or to in FINAL:
                to = "admitted"
            warned = [w for w in (row.get("budget_warned") or []) if w != mid] if "max_usd" in kv else \
                row.get("budget_warned") or []
            self._set(mid, state=to, code="", message="", detail={}, budget_warned=warned)
            return {"migration": mid, "state": to, "resuming": True}
        if rescan and state not in ("building", "verifying"):
            self._set(mid, state="admitted", code="", message="", detail={})
            return {"migration": mid, "state": "admitted", "resuming": True}
        return {"migration": mid, "state": state, "resuming": state not in FINAL}

    # ------------------------------------------------------------------ stages

    def _repos(self, mid: str, row: Mapping[str, Any], side: str) -> List[Dict[str, Any]]:
        repos = self._read(mid, "repos-%s.json" % side, None)
        if repos is None:     # a migration admitted before estates existed: one tree
            repos = [{"name": os.path.basename(row[side]), "path": row[side], "ref": row.get(side + "_ref") or "",
                      "sha": "", "single": "1"}]
        return repos

    def _side(self, mid: str, row: Mapping[str, Any], side: str, ref_override: str = "") -> Any:
        """The side as one readable tree: a Tree (one repository) or an Estate (several)."""
        return estate_mod.open_side(row[side], self._repos(mid, row, side), ref_override)

    def _cached(self, mid: str, llm: Any) -> Any:
        """LINE_SCAN_CACHE: model answers keyed by their prompt (unchanged chunks are not read again)."""
        d = scancache_mod.cache_dir(self.cfg, self._dir(mid))
        return scancache_mod.CachedLlm(llm, d) if d else llm

    def _s_admitted(self, mid: str, row: Mapping[str, Any]) -> None:
        counts: Dict[str, Any] = {}
        facts: Dict[str, Any] = {}
        invs: Dict[str, Any] = {}
        if scancache_mod.cache_dir(self.cfg, self._dir(mid)) and not estate_mod.is_estate(self._repos(mid, row, "v2")):
            self._set(mid, v2_scanned_sha=scancache_mod.head(row["v2"]))
        for side in ("v1", "v2"):
            repos = self._repos(mid, row, side)
            if not estate_mod.is_estate(repos):
                tree = self._side(mid, row, side)
                facts[side] = extract_mod.extract(tree)
                invs[side] = inventory_mod.inventory(tree, side, self._cached(mid, self.llm), run=mid,
                                                     notes=row.get("notes", ""), facts=facts[side])
                continue

            def on_repo(r: Dict[str, Any], side: str = side) -> None:
                self._emit(mid, codes.MIGRATION_REPO, dict(r, side=side))

            b = self.budget(mid)
            llm = self.llm
            try:
                res = scan_mod.scan_side(self._dir(mid), side, repos, row[side], self._cached(mid, llm), run=mid,
                                         notes=row.get("notes", ""),
                                         parallel=int(getattr(self.cfg, "migrate_parallel", 3)), on_repo=on_repo,
                                         llm_for=lambda r, side=side: self._cached(mid, budget_mod.BudgetedLlm(
                                             llm.inner, lambda run: b, repo="%s.%s" % (side, scan_mod.slug(r["name"])))))
            except LineError as e:
                over = [x for x in (e.detail or {}).get("repos") or [] if budget_mod.is_budget_text(x.get("error"))]
                if e.code == codes.REPO_SCAN_FAILED and over:
                    raise Fail(codes.MIGRATION_BUDGET, "every %s repository stopped on its budget" % side,
                               {"scope": "repo", "repos": [x["repo"] for x in over], "resume_state": "admitted"})
                raise
            over = [x["repo"] for x in res["repos"] if budget_mod.is_budget_text(x.get("error"))]
            if over:
                # a repository left out silently would read as features that v1 does not have: stop instead
                scope = "total" if b.limit > 0 and b.spent() >= b.limit - budget_mod.EPS else "repo"
                raise Fail(codes.MIGRATION_BUDGET, "%d %s repositor%s stopped on the budget" % (
                    len(over), side, "y" if len(over) == 1 else "ies"),
                    {"scope": scope, "repos": over, "resume_state": "admitted"})
            facts[side], invs[side] = res["facts"], res["inventory"]
            self._write(mid, "scan-%s.json" % side, {"repos": res["repos"], "merged": res["merged"]})
        for side in ("v1", "v2"):
            self._write(mid, "facts-%s.json" % side, extract_mod.serialisable(facts[side]))
        surface = extract_mod.compare(facts["v1"], facts["v2"])
        self._write(mid, "surface.json", surface)
        counts["surface"] = {k: {c: len(v[c]) for c in ("both", "renamed", "v1_only", "v2_only")}
                             for k, v in surface.items()}
        for side in ("v1", "v2"):
            inv = invs[side]
            self._write(mid, "inventory-%s.json" % side, inv)
            counts[side] = len(inv["features"])
            body = {"side": side, "features": len(inv["features"]), "unproven": len(inv["unproven"]),
                    "chunks": inv["chunks"]}
            if inv.get("repos") is not None:
                body["repos"] = len(inv["repos"])
                body["failed"] = [r["repo"] for r in inv["repos"] if r["status"] != "ok"]
                body["merged"] = len(inv.get("merged") or [])
            self._emit(mid, codes.MIGRATION_INVENTORY, body)
        self._set(mid, state="inventoried", counts=dict(row.get("counts") or {}, features=counts))

    def _facts(self, mid: str, side: str) -> Dict[str, Any]:
        f = self._read(mid, "facts-%s.json" % side, None) or extract_mod.empty_facts()
        f["identifiers"], f["strings"] = set(f.get("identifiers") or []), set(f.get("strings") or [])
        return f

    def _s_inventoried(self, mid: str, row: Mapping[str, Any]) -> None:
        t1, t2 = self._side(mid, row, "v1"), self._side(mid, row, "v2")
        inv1, inv2 = self._read(mid, "inventory-v1.json"), self._read(mid, "inventory-v2.json")
        matched = match_mod.match(inv1, inv2, t1, t2, self._cached(mid, self.llm), run=mid, notes=row.get("notes", ""),
                                  facts1=self._facts(mid, "v1"), facts2=self._facts(mid, "v2"))
        self._write(mid, "match.json", {"pairs": matched["pairs"], "decisions": matched["decisions"]})
        self._write(mid, "confirm.json", matched["confirm"])
        base = self._side(mid, row, "v1", row["v1_base"]) if row.get("v1_base") else None
        rows = matrix_mod.rows(inv1, inv2, matched, base=base, scope=row.get("scope") or [])
        feats = self._features(mid)
        self._write(mid, "matrix.json", rows)
        self._write(mid, "matrix.md", matrix_mod.markdown(rows, feats))
        for r in rows:
            self.store.put(E_MIG_FEATURE, "%s:%s" % (mid, r["id"]), dict(r, migration=mid), run=mid)
        recs = conflicts_mod.records(rows, feats)
        recs += conflicts_mod.decision_records(matched["decisions"], len(recs) + 1)
        for c in recs:
            self._put_conflict(mid, c)
        cnt = matrix_mod.counts(rows)
        self._emit(mid, codes.MIGRATION_MATRIX, cnt)
        self._set(mid, state="matched", counts=dict(row.get("counts") or {}, matrix=cnt))

    def _s_matched(self, mid: str, row: Mapping[str, Any]) -> None:
        open_ = [c for c in self._conflicts(mid) if not c.get("choice")]
        if open_ and row["mode"] == "decide":
            for c in open_:
                self._decide(mid, c, conflicts_mod.default_choice(c), "model (decide mode)")
            open_ = []
        if open_:
            self._emit(mid, codes.MIGRATION_PARKED, {"questions": [c["id"] for c in open_]})
            self._set(mid, state="parked")
            raise Stop("%d conflict(s) wait for a person" % len(open_))
        self._set(mid, state="decided")

    def _s_parked(self, mid: str, row: Mapping[str, Any]) -> None:
        open_ = [c["id"] for c in self._conflicts(mid) if not c.get("choice")]
        if open_:
            raise Stop("still open: %s" % ", ".join(open_))
        self._set(mid, state="decided")

    def _s_decided(self, mid: str, row: Mapping[str, Any]) -> None:
        feats = self._features(mid)
        rows = self._read(mid, "matrix.json", [])
        conflicts = self._conflicts(mid)
        facts2 = self._facts(mid, "v2")
        fresh = None
        d = scancache_mod.cache_dir(self.cfg, self._dir(mid))
        if d and row.get("v2_kind") != "estate" and row.get("v2_scanned_sha"):
            # as-of graph: the target may have moved since the inventory read it (another run sealed and merged)
            touched = sorted({e.get("path", "") for f in feats.values() if str(f.get("id", "")).startswith("v2.")
                              for e in f.get("evidence") or [] if e.get("path")})
            fresh = scancache_mod.freshness(d, row["v2"], row["v2_scanned_sha"], touched)
            if fresh["changed"]:
                facts2 = extract_mod.extract(self._side(mid, row, "v2"))      # cheap: regex, no model
                self._write(mid, "facts-v2.json", extract_mod.serialisable(facts2))
                facts2["identifiers"], facts2["strings"] = set(facts2["identifiers"]), set(facts2["strings"])
        b = blast_mod.radius(rows, conflicts, feats, self._side(mid, row, "v2"), facts2)
        if fresh is not None:
            b["freshness"] = fresh
        self._write(mid, "blast.json", b)
        self._write(mid, "effort.json", effort_mod.hints(rows, feats, b))
        if row.get("v2_kind") == "estate":
            # the build stage drives ONE git repository; a v2 estate gets the full analysis and the spec pack
            specgen.pack(os.path.join(self._dir(mid), "pack"), "Feature migration %s" % mid, b["changes"], feats,
                         conflicts, b.get("gates") or [])
            self._write(mid, "baseline.json", {"supported": False, "tests": {}, "passed": 0, "failed": 0,
                                               "code": codes.TARGET_ESTATE})
            raise Done("analysed", codes.TARGET_ESTATE)
        base = verify.suite(row["v2"])
        self._write(mid, "baseline.json", {k: base[k] for k in ("supported", "tests", "passed", "failed", "code")})
        self._emit(mid, codes.MIGRATION_BASELINE, {"tests": len(base["tests"]), "passed": base["passed"],
                                                   "failed": base["failed"], "at_risk": len(b["at_risk"])})
        pk = specgen.pack(os.path.join(self._dir(mid), "pack"), "Feature migration %s" % mid, b["changes"], feats,
                          conflicts, b.get("gates") or [])
        if not base["supported"]:
            raise Done("analysed", codes.STACK_UNSUPPORTED)
        if not row.get("build", True):
            raise Done("analysed")
        if not pk["items"]:
            self._set(mid, state="verifying")
            return
        left = self.budget(mid).remaining()
        cap = float(getattr(self.cfg, "max_usd_run", 0) or 0)
        build_budget = left if cap <= 0 else min(left, max(cap, 0.0)) if left != float("inf") else cap
        if build_budget < budget_mod.MIN_BUILD_USD:
            raise Fail(codes.MIGRATION_BUDGET, "only $%.2f left for the build run" % max(build_budget, 0.0),
                       {"scope": "total", "remaining": round(max(build_budget, 0.0), 6), "resume_state": "decided"})
        self._set(mid, build_budget=round(build_budget, 6))
        p = self._pipeline(build_budget)
        run = p.admit(pk["dir"], row["v2"])
        self._emit(mid, codes.MIGRATION_BUILD, {"run": run, "pack": pk["dir"], "items": pk["items"],
                                                "budget": round(build_budget, 6)})
        self._set(mid, state="building", run=run, items=pk["items"], run_ids=list(row.get("run_ids") or []) + [run])

    def _s_building(self, mid: str, row: Mapping[str, Any]) -> None:
        run = row["run"]
        child = self.store.get(E_RUN, run) or {}
        if child.get("state") not in TERMINAL_RUN_STATES:
            child = self._pipeline(row.get("build_budget")).drive(run)
        st = child.get("state")
        if st == RunState.GREEN.value:
            self._set(mid, state="verifying")
            return
        if st == RunState.ESCALATED.value:
            escs = self.store.query(E_ESCALATION, run=run)
            code = (escs[-1].get("code") if escs else "") or codes.BUILD_FAIL
            if code == codes.BUDGET_EXCEEDED:
                raise Fail(codes.MIGRATION_BUDGET, "build run %s used its budget" % run,
                           {"scope": "build", "run": run, "resume_state": "decided"})
            raise Fail(code if codes.is_code(code) else codes.BUILD_FAIL, "build run %s escalated" % run,
                       {"run": run, "escalations": escs[-3:]})
        raise Stop("build run %s is %s" % (run, st))

    def _s_verifying(self, mid: str, row: Mapping[str, Any]) -> None:
        before = (self._read(mid, "baseline.json", {}) or {}).get("tests") or {}
        after = verify.suite(row["v2"])
        feats = self._features(mid)
        superseded = []
        for c in self._conflicts(mid):
            if c.get("choice") == "v1" and c.get("kind", "conflict") == "conflict":
                for t in (feats.get(c["v2"]) or {}).get("tests") or []:
                    superseded.append(t[:-3].replace("/", ".") if t.endswith(".py") else t)
        regs = verify.regressions(before, after["tests"], superseded)
        self._write(mid, "verify.json", {"tests": after["tests"], "passed": after["passed"], "failed": after["failed"],
                                         "regressions": regs, "superseded": superseded})
        self._emit(mid, codes.MIGRATION_VERIFIED, {"passed": after["passed"], "regressions": regs,
                                                   "superseded": superseded})
        if regs:
            raise Fail(codes.PARITY_REGRESSION, "%d test(s) that passed before fail now" % len(regs),
                       {"regressions": regs[:50]})
        raise Done("green")

    # ------------------------------------------------------------------ pieces

    def _pipeline(self, budget: Any = None) -> Any:
        """The build pipeline; with ``budget`` its run cap is what the migration has left (LINE_MAX_USD_RUN
        otherwise). A factory that takes a config gets the capped one."""
        cfg = self.cfg
        if budget not in (None, "") and float(budget) > 0:
            cfg = dataclasses.replace(self.cfg, max_usd_run=float(budget))
        if self.pipeline_factory is not None:
            import inspect
            try:
                takes = len(inspect.signature(self.pipeline_factory).parameters) >= 1
            except (TypeError, ValueError):
                takes = False
            return self.pipeline_factory(cfg) if takes else self.pipeline_factory()
        from ..pipeline import Pipeline
        return Pipeline(self.store, cfg, log=self.log)

    def _decide(self, mid: str, c: Dict[str, Any], choice: str, who: str) -> None:
        c = dict(c)
        c.update(choice=choice, who=who, decided_ms=now_ms())
        if choice == "v2" and c.get("kind", "conflict") == "conflict":
            feats = self._features(mid)
            c["backup"] = conflicts_mod.write_backup(os.path.join(self._dir(mid), "backup"), c, feats.get(c["v1"]) or {})
        conflicts_mod.log_decision(os.path.join(self._dir(mid), "decisions.jsonl"), mid, c)
        self._put_conflict(mid, {k: v for k, v in c.items() if k != "migration"})
        self._emit(mid, codes.MIGRATION_DECIDED, {"conflict": c["id"], "choice": choice, "who": who,
                                                  "backup": c.get("backup", "")})

    def _report(self, mid: str, state: str, code: str) -> str:
        row = self._row(mid)
        row.update(state=state, code=code)
        feats = self._features(mid)
        unproven = []
        for side in ("v1", "v2"):
            unproven += (self._read(mid, "inventory-%s.json" % side, {}) or {}).get("unproven") or []
        child = self.store.get(E_RUN, row.get("run") or "") or {} if row.get("run") else {}
        lim = self.limits(row)
        row["budget"] = budget_mod.view(self.store, row, lim["max_usd"], lim["max_usd_repo"])
        repos = {s: (self._read(mid, "scan-%s.json" % s, {}) or {}).get("repos") or [] for s in ("v1", "v2")}
        for s, rows_ in repos.items():
            for r in rows_:
                r["usd"] = row["budget"]["repos"].get("%s.%s" % (s, scan_mod.slug(r.get("repo") or "")), 0.0)
        text = report_mod.build(row, self._read(mid, "matrix.json", []), feats, self._conflicts(mid),
                                self._read(mid, "blast.json", {}) or {}, unproven,
                                self._read(mid, "baseline.json", {}) or {}, self._read(mid, "verify.json", {}) or {},
                                child, effort=self._read(mid, "effort.json", {}) or {},
                                surface=self._read(mid, "surface.json", {}) or {},
                                repos=repos)
        return self._write(mid, "report.md", text)

    def _end(self, mid: str, state: str, code: str, message: str, detail: Mapping[str, Any]) -> None:
        self._set(mid, state=state, code=code, message=message, detail=dict(detail or {}))
        report = self._report(mid, state, code)
        self._emit(mid, codes.MIGRATION_DONE, dict({"state": state, "report": report}, **({"code": code} if code else {})))


def _usd(v: Any, default: float) -> float:
    try:
        return round(float(v), 6) if v not in (None, "") else round(float(default), 6)
    except (TypeError, ValueError):
        raise LineError(codes.CONFIG_INVALID, "a budget must be a number of USD, not %r" % (v,), {"value": v})


def _resumable(code: str, detail: Optional[Mapping[str, Any]], state: str) -> Dict[str, Any]:
    d = dict(detail or {})
    if code == codes.MIGRATION_BUDGET:
        d.setdefault("resume_state", state if state in STATES and state not in FINAL else "admitted")
    return d


def summary(store: Any, row: Mapping[str, Any]) -> Dict[str, Any]:
    open_ = [c["id"] for c in store.query(E_MIG_CONFLICT, run=row["id"]) if not c.get("choice")]
    lim_total = float(row.get("max_usd") or 0.0)
    lim_repo = float(row.get("max_usd_repo") or 0.0)
    return {"budget": budget_mod.view(store, row, lim_total, lim_repo),
            "message": row.get("message", ""), "detail": row.get("detail") or {},
            "id": row["id"], "state": row["state"], "code": row.get("code", ""), "mode": row.get("mode"),
            "v1": row.get("v1"), "v2": row.get("v2"), "run": row.get("run", ""), "counts": row.get("counts", {}),
            "v1_kind": row.get("v1_kind", "repo"), "v2_kind": row.get("v2_kind", "repo"),
            "repo_counts": row.get("repo_counts") or {},
            "open_conflicts": open_, "created_ms": row.get("created_ms"), "updated_ms": row.get("updated_ms"),
            "report": os.path.join(row.get("dir") or "", "report.md") if row.get("dir") else ""}


def view(store: Any, mid: str) -> Dict[str, Any]:
    row = store.get(E_MIGRATION, mid)
    if row is None:
        raise LineError(codes.NOT_FOUND, "migration %s" % mid, {"migration": mid})
    feats = sorted(store.query(E_MIG_FEATURE, run=mid), key=lambda r: int(str(r["id"]).lstrip("R") or 0))
    confl = sorted(store.query(E_MIG_CONFLICT, run=mid), key=lambda c: int(str(c["id"]).lstrip("C") or 0))
    out = {"migration": summary(store, row), "features": feats, "conflicts": confl,
           "questions": [conflicts_mod.question(c) for c in confl if not c.get("choice")]}
    if row.get("run"):
        out["run"] = store.get(E_RUN, row["run"])
    return out


def list_all(store: Any) -> List[Dict[str, Any]]:
    rows = store.query(E_MIGRATION)
    return [summary(store, r) for r in sorted(rows, key=lambda r: r.get("created_ms") or 0, reverse=True)]


#: the artefacts the board may read, by fixed name (never a path from the request)
ARTEFACTS = ("blast.json", "effort.json", "surface.json", "baseline.json", "verify.json", "match.json",
             "scan-v1.json", "scan-v2.json", "repos-v1.json", "repos-v2.json")


def _artefact_dir(store: Any, mid: str) -> str:
    row = store.get(E_MIGRATION, mid)
    if row is None:
        raise LineError(codes.NOT_FOUND, "migration %s" % mid, {"migration": mid})
    return str(row.get("dir") or "")


def _load(directory: str, name: str, default: Any) -> Any:
    path = os.path.join(directory, name)
    if not directory or not os.path.isfile(path):
        return default
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def details(store: Any, mid: str) -> Dict[str, Any]:
    """Everything the board's migration view draws besides the matrix: repositories, blast radius, effort,
    decisions log, baseline / verify, the build runs."""
    d = _artefact_dir(store, mid)
    row = store.get(E_MIGRATION, mid) or {}
    repos = {}
    for side in ("v1", "v2"):
        scanned = (_load(d, "scan-%s.json" % side, {}) or {}).get("repos")
        repos[side] = scanned if scanned is not None else _load(d, "repos-%s.json" % side, [])
    decisions = []
    path = os.path.join(d, "decisions.jsonl") if d else ""
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        decisions.append(json.loads(line))
                    except ValueError:
                        continue
    base = _load(d, "baseline.json", {}) or {}
    ver = _load(d, "verify.json", {}) or {}
    evidence = {}
    for side in ("v1", "v2"):
        for f in (_load(d, "inventory-%s.json" % side, {}) or {}).get("features") or []:
            evidence[f["id"]] = {"behaviour": f.get("behaviour", ""), "repo": f.get("repo", ""),
                                 "quotes": [{"path": e.get("path", ""), "quote": str(e.get("quote", ""))[:400],
                                             "verified": bool(e.get("verified"))}
                                            for e in (f.get("evidence") or [])[:4]]}
    events = store.events_after(0, run=mid, limit=5000)
    return {"migration": mid, "repos": repos, "blast": _load(d, "blast.json", {}) or {},
            "effort": _load(d, "effort.json", {}) or {}, "decisions": decisions, "evidence": evidence,
            "baseline": {k: base.get(k) for k in ("supported", "passed", "failed", "code")},
            "verify": {k: ver.get(k) for k in ("passed", "failed", "regressions", "superseded")} if ver else {},
            "runs": list(row.get("run_ids") or []),
            "timeline": [{"seq": e.seq, "kind": e.kind, "ts_ms": e.ts_ms,
                          "body": {k: v for k, v in (e.body or {}).items() if k in (
                              "side", "repo", "status", "features", "state", "code", "run", "questions", "conflict",
                              "choice", "who", "passed", "regressions", "node", "spent", "limit", "budget")}}
                         for e in events][-200:]}


def report_text(store: Any, mid: str) -> Dict[str, Any]:
    d = _artefact_dir(store, mid)
    path = os.path.join(d, "report.md") if d else ""
    if not path or not os.path.isfile(path):
        return {"migration": mid, "report": "", "ready": False}
    with open(path, encoding="utf-8", errors="replace") as fh:
        return {"migration": mid, "report": fh.read(), "ready": True}


__all__ = ["Migrator", "MODES", "STATES", "FINAL", "new_id", "summary", "view", "list_all", "details", "report_text"]
