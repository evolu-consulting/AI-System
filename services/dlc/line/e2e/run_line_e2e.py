"""Dry end-to-end run of the line on samples/todo-pack, plus its variants.

    cd Slaves/SDLC
    python -m line.e2e.run_line_e2e                 # all variants
    python -m line.e2e.run_line_e2e base flaky      # some of: base flaky qas_red rag_outage all_on conflict_park

Every variant gets a fresh work root under LINE_WORKROOT (default: the system temp dir), its own
SQLite store and a fresh target git repository (branch main). The model is the fake one
(fixtures under samples/todo-pack/dry/), so nothing is spent.

Checks (every variant): the run is green; event seq is gapless from 1; budget and ledger spent 0;
every approved test is locked and traced to a span of the frozen pack; the board shows the run
green and every F-item lane green on QAS (flaky allowed in the flaky variant); the live QAS
directory passes `python -m unittest` on its own.
Base also checks the milestone order of the plan (reader B diverges on the F2 exit code, re-read
agrees; U3 attempt 1 fails verify with TEST_FAIL, attempt 2 passes; U2/U3 build in parallel; four
units merged; QAS 3/3 green).
Variants:
  flaky       LINE_DRY_FLAKY=1    -> a flaky test is quarantined and reported; run still green
  qas_red     LINE_DRY_QAS_RED=F3 -> F3 red on QAS, fixer unit FX-F3-g1 built and merged, then green
  rag_outage  RAG port over a fake remote that goes down when building starts -> rag.degraded
              events, run still green; after the remote is back the outbox drains and every
              event reached it once, in order
  all_on      every wave 4 flag on (ALL_ON): the gap checklist leaves one sensitive gap (F2 deletion) ->
              one question, answered by the dry fixture (LINE_DRY_HUMAN=auto) -> addendum v1.1 re-freezes
              the pack -> digest again; the reviewer blocks U2 attempt 1 -> the judge rules "fix" -> U2
              attempt 2 passes review; drift notes; the decision is graded right on QAS; lessons are
              distilled from the run's failures and judged at run end; GET /api/metrics has the run;
              merged unit worktrees are gone
  decide_off  the conflict_park spec with human questions off (LINE_HUMAN_MODE=decide): the model decides
              every question (dry fixture: the recommended option), each decision is a human.decided event and a
              worklog line, nothing waits for a person, the run goes green
  fgraph      feature graph on (LINE_FGRAPH=1): the graph is extracted from the dry fixture, checked, its
              derived order puts F3 after F1, the planner graph respects it, the run goes green
  conflict_park  understand_plus on, no auto answers: the spec copy plants a contradiction (a missing file
              exits 2 vs 0) -> the run parks waiting_human (non-terminal, nothing escalated); the open
              questions are answered through POST /api/runs/{id}/answers on a live server, which resumes
              the run -> green on the addendum version
  migrate     feature migration (flow 4) on samples/migrate-pair over a live server: v1 (vanilla + a customer
              custom CSV export) -> v2 (rewrite: no export, a v2-only search, 5% instead of 10% discount).
              POST /api/migrations (ask) -> inventory, confirmation pass (v2 mentions export only in a comment:
              absent), matrix 1 same / 1 conflict / 1 v1-only custom / 1 v2-only, one unproven feature -> parks
              on the discount conflict -> POST answers v2 -> backup + decision log -> baseline 3 tests -> the
              export is built as an enhancement run on v2 -> v2 suite again: 5 pass, no regression -> green
  migrate_estate  the same migration with v1 as an ESTATE (samples/migrate-estate): a folder of 3 git repositories
              (data + service layer of the order object, tagged vanilla, and a customer-only export repository).
              Each repository is scanned on its own (3 migration.repo events, one inventory call per repository),
              'Add an item' found in both order repositories is merged into one feature, the custom flag comes
              from the repositories that have the vanilla tag; then the same matrix, park, answer, build, green
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any, Callable, Dict, List, Optional

LINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if __name__ == "__main__" and __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(LINE_DIR))

from line import codes  # noqa: E402
from line.budget import SqliteBudget  # noqa: E402
from line.config import load_config  # noqa: E402
from line.contracts import E_ACC_TEST, E_LLM_CALL, E_PACK, E_RUN, E_UNIT, RunState  # noqa: E402
from line.events import check_gapless  # noqa: E402
from line.pipeline import Pipeline, init_target, QAS_DIR, _safe  # noqa: E402
from line.runtime import python_exe as _pyexe  # noqa: E402
from line.server import board  # noqa: E402
from line.ship.deploy import current_dir  # noqa: E402
from line.store import SqliteStore  # noqa: E402

PACK = os.path.join(LINE_DIR, "samples", "todo-pack")
VARIANTS = ("base", "flaky", "qas_red", "rag_outage", "all_on", "conflict_park", "decide_off", "fgraph", "migrate",
            "migrate_estate", "seal", "seal_taint")
ENV_OF = {"base": {}, "flaky": {"LINE_DRY_FLAKY": "1"}, "qas_red": {"LINE_DRY_QAS_RED": "F3"}, "rag_outage": {},
          "all_on": {}, "conflict_park": {}, "decide_off": {}, "fgraph": {}, "migrate": {}, "migrate_estate": {},
          "seal": {}, "seal_taint": {}}
#: every wave 4 feature flag on (+ the dry human answering from dry/human/answers.json)
ALL_ON: Dict[str, Any] = {"reconcile": True, "uplus_enabled": True, "dry_human": "auto", "review_enabled": True,
                          "review_max_rounds": 1, "drift_enabled": True, "judge_enabled": True, "learn_enabled": True,
                          "agents_enabled": True, "obs_enabled": True}
CONFIG_OF: Dict[str, Dict[str, Any]] = {"all_on": ALL_ON, "conflict_park": {"uplus_enabled": True, "dry_human": ""},
                                        "decide_off": {"uplus_enabled": True, "dry_human": "", "human_mode": "decide"},
                                        "fgraph": {"fgraph_enabled": True},
                                        "seal": {"seal_enabled": True, "scan_cache": "1"},
                                        "seal_taint": {"seal_enabled": True, "scan_cache": "1"}}
DRY_VARS = ("LINE_DRY_FLAKY", "LINE_DRY_QAS_RED")


class Result:
    def __init__(self, variant: str):
        self.variant = variant
        self.failures: List[str] = []
        self.numbers: Dict[str, Any] = {}
        self.run = ""
        self.work = ""
        self.pipeline: Any = None

    @property
    def ok(self) -> bool:
        return not self.failures

    def check(self, cond: Any, msg: str) -> bool:
        if not cond:
            self.failures.append(msg)
        return bool(cond)

    def line(self) -> str:
        nums = " ".join("%s=%s" % kv for kv in self.numbers.items())
        return "%-10s %s  %s%s" % (self.variant, "PASS" if self.ok else "FAIL", nums,
                                   "" if self.ok else "\n    - " + "\n    - ".join(self.failures))


# ------------------------------------------------------------------ checks


def _kinds(events: List[Any]) -> List[str]:
    return [e.kind for e in events]


def check_common(res: Result, store: Any, cfg: Any, run: str, allow_flaky: bool = False, min_tests: int = 9) -> None:
    row = store.get(E_RUN, run) or {}
    res.check(row.get("state") == RunState.GREEN.value,
              "run is %s, not green: %s" % (row.get("state"), (row.get("detail") or {}).get("escalation")))
    evs = store.events_after(0, limit=1000000)
    try:
        check_gapless(evs)
        gapless = True
    except Exception as e:   # noqa: BLE001
        gapless = False
        res.check(False, "event seq not gapless: %s" % e)
    res.numbers["events"] = len(evs)
    res.numbers["gapless"] = gapless

    st = SqliteBudget(store, emit=False).state(run, run)
    ledger = store.query(E_LLM_CALL, run=run)
    spent = sum(float(c.get("usd") or 0) for c in ledger)
    res.numbers["llm_calls"] = len(ledger)
    res.numbers["spent_usd"] = round(spent + st.spent, 6)
    res.check(st.spent == 0 and spent == 0, "dry run spent money: budget %.6f ledger %.6f" % (st.spent, spent))
    res.check(len(ledger) > 0, "no llm_call on the ledger")

    pack = store.get(E_PACK, row.get("spec_hash", "")) or {}
    spans = {s["id"] for s in pack.get("spans") or []}
    tests = store.query(E_ACC_TEST, run=run)
    untraced = [t["id"] for t in tests if t.get("span_id") not in spans or not t.get("locked") or not t.get("sha")
                or not t.get("criterion")]
    res.numbers["tests"] = len(tests)
    res.check(len(tests) >= min_tests, "expected >= %d acceptance tests, got %d" % (min_tests, len(tests)))
    res.check(not untraced, "tests not traced to a span / not locked: %s" % untraced)
    approved = [e for e in evs if e.kind == codes.TESTS_APPROVED and e.env.run == run]
    res.check(approved and set((approved[-1].body.get("trace") or {})) == {t["id"] for t in tests},
              "tests.approved trace does not cover every test")

    left = [u["id"] for u in store.query(E_UNIT, run=run)
            if u.get("state") == "merged" and u.get("worktree") and os.path.isdir(u["worktree"])]
    res.check(not left, "worktrees of merged units still on disk: %s" % left)

    b = board(store, run)
    lanes = (b.get("lanes") or {}).get("rows") or []
    okv = ("green", "flaky") if allow_flaky else ("green",)
    res.check((b.get("run") or {}).get("state") == "green", "board run state is %s" % (b.get("run") or {}).get("state"))
    res.check(lanes and all(r["state"] in okv for r in lanes),
              "board lanes not green: %s" % [(r["f_item"], r["state"]) for r in lanes])
    res.numbers["board"] = ",".join("%s:%s" % (r["f_item"], r["state"]) for r in lanes)

    qdir = current_dir(os.path.join(cfg.workroot, _safe(run), QAS_DIR))
    res.check(qdir and os.path.isdir(qdir), "no live QAS directory")
    if qdir and os.path.isdir(qdir):
        env = {k: v for k, v in os.environ.items() if not k.startswith("LINE_") and k != "PYTHONPATH"}
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        p = subprocess.run([_pyexe(), "-m", "unittest"], cwd=qdir, env=env, capture_output=True, text=True,
                           timeout=600)
        tail = (p.stderr or "").strip().splitlines()
        ran = next((l for l in tail if l.startswith("Ran ")), "")
        res.numbers["qas_unittest"] = "%s rc=%d" % (ran.replace("Ran ", "").split(" in ")[0], p.returncode)
        res.check(p.returncode == 0 and ran and not ran.startswith("Ran 0"),
                  "QAS dir does not pass unittest on its own: rc=%s %s" % (p.returncode, "\n".join(tail[-5:])))


def check_base(res: Result, store: Any, run: str) -> None:
    evs = store.events_after(0, run=run, limit=1000000)
    seq = {k: [e for e in evs if e.kind == k] for k in codes.EVENT_KINDS}
    order = [codes.RUN_ADMITTED, codes.SPEC_FROZEN, codes.RECONCILE_DIVERGED, codes.DIGEST_DONE, codes.TESTS_APPROVED,
             codes.GRAPH_VALID, codes.UNIT_MERGED, codes.DEPLOY_DONE, codes.QAS_RESULT, codes.RUN_GREEN]
    firsts = [seq[k][0].seq if seq[k] else None for k in order]
    res.check(None not in firsts, "missing milestones: %s" % [k for k, s in zip(order, firsts) if s is None])
    if None not in firsts:
        res.check(firsts == sorted(firsts), "milestones out of order: %s" % list(zip(order, firsts)))
    div = seq[codes.RECONCILE_DIVERGED]
    res.check(div and any("F2" in f.get("path", "") and f.get("a") == ["1"] and f.get("b") == ["2"]
                          for f in div[0].body.get("fields", [])), "reader B did not diverge on the F2 exit code")
    dd = seq[codes.DIGEST_DONE]
    res.check(dd and dd[0].body.get("rereads") == 1, "digest not reconciled after one re-read")
    vf = seq[codes.VERIFY_FAILED]
    res.check(len(vf) == 1 and vf[0].env.unit == "U3" and vf[0].env.attempt == 1 and vf[0].body.get("code") == codes.TEST_FAIL,
              "expected one verify.failed U3#1 TEST_FAIL, got %s" % [(e.env.unit, e.env.attempt, e.body.get("code")) for e in vf])
    merged = [e.env.unit for e in seq[codes.UNIT_MERGED]]
    if vf and seq[codes.GRAPH_VALID] and seq[codes.DEPLOY_DONE]:
        u3m = [e.seq for e in seq[codes.UNIT_MERGED] if e.env.unit == "U3"]
        res.check(seq[codes.GRAPH_VALID][0].seq < vf[0].seq < min(u3m or [0]) and
                  max(e.seq for e in seq[codes.UNIT_MERGED]) < seq[codes.DEPLOY_DONE][0].seq,
                  "verify.failed / merges / deploy out of order")
    res.check(sorted(merged) == ["U1", "U2", "U3", "U4"], "merged units: %s" % merged)
    u3 = [e for e in seq[codes.UNIT_MERGED] if e.env.unit == "U3"]
    res.check(u3 and u3[0].env.attempt == 2, "U3 not merged from attempt 2")
    disp = {e.env.unit: e.seq for e in seq[codes.UNIT_DISPATCHED] if e.env.attempt == 1}
    mseq = {e.env.unit: e.seq for e in seq[codes.UNIT_MERGED]}
    parallel = all(k in disp and k in mseq for k in ("U2", "U3")) and disp["U3"] < mseq["U2"] and disp["U2"] < mseq["U3"]
    res.check(parallel, "U2 and U3 did not build in parallel")
    res.numbers["parallel_U2_U3"] = parallel
    gv = seq[codes.GRAPH_VALID]
    res.check(gv and gv[0].body.get("waves") == [["U1"], ["U2", "U3"], ["U4"]], "waves: %s" % (gv and gv[0].body.get("waves")))
    dep = seq[codes.DEPLOY_DONE]
    res.check(dep and dep[-1].body.get("ok") is True, "deploy not ok")
    qr = seq[codes.QAS_RESULT]
    res.check(len(qr) == 3 and all(e.body.get("runs") == [True, True, True] and e.body.get("verdict") == "green" for e in qr),
              "QAS not 3/3 green: %s" % [(e.body.get("f_item"), e.body.get("runs")) for e in qr])
    res.numbers["merged"] = len(merged)
    res.numbers["attempts"] = len(seq[codes.UNIT_DISPATCHED])


def check_flaky(res: Result, store: Any, cfg: Any, run: str) -> None:
    row = store.get(E_RUN, run) or {}
    q = (row.get("detail") or {}).get("quarantine") or {}
    res.check(q.get("tests"), "no quarantined test on the run")
    res.check(q.get("path") and os.path.isfile(q["path"]), "no quarantine report file")
    flaky = [e for e in store.events_after(0, run=run, kinds=[codes.QAS_RESULT]) if e.body.get("verdict") == "flaky"]
    res.check(flaky, "no flaky qas.result")
    res.numbers["quarantined"] = len(q.get("tests") or [])


def check_qas_red(res: Result, store: Any, run: str) -> None:
    evs = store.events_after(0, run=run, limit=1000000)
    red = [e for e in evs if e.kind == codes.QAS_RESULT and e.body.get("f_item") == "F3" and e.body.get("verdict") == "red"]
    green = [e for e in evs if e.kind == codes.QAS_RESULT and e.body.get("f_item") == "F3" and e.body.get("verdict") == "green"]
    fx = store.query(E_UNIT, run=run, id="FX-F3-g1")
    merged = [e for e in evs if e.kind == codes.UNIT_MERGED and e.env.unit == "FX-F3-g1"]
    res.check(red, "F3 never red on QAS")
    res.check(fx and fx[0]["state"] == "merged" and fx[0].get("fixer_gen") == 1, "fixer unit FX-F3-g1 not merged")
    res.check(merged and red and green and red[0].seq < merged[0].seq < green[-1].seq,
              "order red -> fixer merged -> green not seen")
    res.check(len([e for e in evs if e.kind == codes.DEPLOY_DONE and e.body.get("ok")]) >= 2, "no redeploy after the fix")
    res.numbers["fixer_units"] = len(fx)
    states = [e.body.get("to") for e in evs if e.kind == codes.RUN_STATE]
    res.check("qas" in states and states.count("building") >= 2, "run did not loop qas -> building: %s" % states)


# ------------------------------------------------------------------ run one variant


def run_variant(variant: str, workroot: Optional[str] = None, log: Optional[Callable[[str], None]] = None,
                cfg_over: Optional[Dict[str, Any]] = None, rag_factory: Optional[Callable[[Any, Any], Any]] = None
                ) -> Result:
    """One variant. cfg_over: extra Config fields (e.g. rag="http" for a live run); rag_factory(cfg, store) ->
    the RAG port to use (default: the config's own)."""
    if variant not in VARIANTS:
        raise ValueError("unknown variant %r (one of %s)" % (variant, ", ".join(VARIANTS)))
    res = Result(variant)
    base = workroot or os.environ.get("LINE_WORKROOT") or tempfile.gettempdir()
    os.makedirs(base, exist_ok=True)
    work = tempfile.mkdtemp(prefix="line-e2e-%s-" % variant, dir=base)
    res.work = work
    saved = {k: os.environ.get(k) for k in DRY_VARS}
    for k in DRY_VARS:
        os.environ.pop(k, None)
    os.environ.update(ENV_OF[variant])
    store = None
    t0 = time.monotonic()
    try:
        pack = PACK if variant not in ("conflict_park", "decide_off") else plant_conflict(os.path.join(work, "pack"))
        if variant == "seal_taint":
            pack = plant_seal_taint(os.path.join(work, "pack"))
        if variant == "migrate":
            pack = os.path.join(LINE_DIR, "samples", "migrate-pair")
        elif variant == "migrate_estate":
            pack = os.path.join(LINE_DIR, "samples", "migrate-estate")
        kw_cfg: Dict[str, Any] = dict(workroot=os.path.join(work, "work"), db=os.path.join(work, "line.db"), llm="fake",
                                      rag="http" if variant == "rag_outage" else "off", dry_pack=pack,
                                      max_parallel_units=3, qas_repeats=3, deploy_windows=[])
        if variant == "rag_outage":
            kw_cfg["rag_url"] = "http://rag.invalid"     # the remote is a fake; a live run passes rag_url in cfg_over
        kw_cfg.update(CONFIG_OF.get(variant, {}))
        kw_cfg.update(cfg_over or {})
        cfg = load_config(**kw_cfg)
        store = SqliteStore(cfg.db)
        target = init_target(os.path.join(work, "target")) if not variant.startswith("migrate") else ""
        kw: Dict[str, Any] = {"log": log}
        remote = None
        if rag_factory is not None:
            kw["rag"] = rag_factory(cfg, store)
        if variant == "rag_outage":
            from line.rag import make_rag
            from line.tests.fakes import FakeRag
            remote = FakeRag()
            kw["rag"] = make_rag(cfg, store, remote=remote, probe_interval_s=0)

            def outage(run: str, stage: str) -> None:
                if stage == "building":
                    remote.down = True
            kw["on_stage"] = outage
        p = None
        if variant == "conflict_park":
            run = drive_conflict_park(res, store, cfg, pack, target, kw)
        elif variant in ("migrate", "migrate_estate"):
            run = drive_migrate(res, store, cfg, work, kw, estate=(variant == "migrate_estate"))
        else:
            p = Pipeline(store, cfg, **kw)
            run = p.admit(pack, target)
            res.run = run
            p.drive(run)
        res.pipeline = p
        res.numbers["seconds"] = round(time.monotonic() - t0, 1)
        if variant == "rag_outage":
            check_rag(res, store, p, remote)
        check_common(res, store, cfg, run, allow_flaky=(variant == "flaky"), min_tests=2 if variant.startswith("migrate") else 9)
        if variant == "base":
            check_base(res, store, run)
        elif variant == "flaky":
            check_flaky(res, store, cfg, run)
        elif variant == "qas_red":
            check_qas_red(res, store, run)
        elif variant == "all_on":
            check_all_on(res, store, cfg, run, p)
        elif variant == "decide_off":
            check_decide_off(res, store, run, p)
        elif variant == "fgraph":
            check_fgraph(res, store, run)
        elif variant in ("seal", "seal_taint"):
            check_seal(res, store, run, taint=(variant == "seal_taint"))
    except Exception as e:   # noqa: BLE001
        import traceback
        res.check(False, "crashed: %s\n%s" % (e, traceback.format_exc()))
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        if store is not None:
            store.close()
    return res


# ------------------------------------------------------------------ all_on / conflict_park


def _evs(store: Any, run: str, kind: str) -> List[Any]:
    return [e for e in store.events_after(0, run=run, limit=1000000) if e.kind == kind]


def _after_run(store: Any, run: str, kind: str) -> List[Any]:
    """Events about a closed run: on the system run "_line" with body.run (pipeline.AfterRunStore)."""
    return [e for e in store.events_after(0, run="_line", limit=1000000)
            if e.kind == kind and (e.body or {}).get("run") == run]


def check_all_on(res: Result, store: Any, cfg: Any, run: str, p: Any) -> None:
    from line.contracts import E_DECISION
    row = store.get(E_RUN, run) or {}
    # understand_plus: one gap question, answered by the dry fixture, addendum v1.1, digest again
    qs = _evs(store, run, codes.HUMAN_QUESTION)
    ans = _evs(store, run, codes.HUMAN_ANSWERED)
    add = _evs(store, run, codes.SPEC_ADDENDUM)
    dig = _evs(store, run, codes.DIGEST_DONE)
    res.check(len(qs) == 1 and len(qs[0].body.get("questions") or []) == 1,
              "want one round with one question: %s" % [e.body for e in qs])
    res.check(len(ans) == 1 and ans[0].body.get("who") == "dry-auto", "want one dry-auto answer: %s" % [e.body for e in ans])
    res.check(len(add) == 1 and add[0].body.get("label") == "v1.1", "want addendum v1.1: %s" % [e.body for e in add])
    res.check((row.get("detail") or {}).get("addenda") == ["v1.1"],
              "run.detail.addenda: %s" % (row.get("detail") or {}).get("addenda"))
    res.check(len(dig) == 2 and bool(add) and dig[0].seq < add[0].seq < dig[1].seq,
              "want a digest before and after the addendum")
    pack = store.get(E_PACK, row.get("spec_hash", "")) or {}
    res.check("addendum/v1.1.md" in (pack.get("files") or {}), "the run's spec_hash is not the addendum version")
    res.check(len(_evs(store, run, codes.GAPS_CHECKED)) == 2 and len(_evs(store, run, codes.CONFLICTS_CHECKED)) == 2,
              "gaps / conflicts not checked once per digest")
    res.numbers["addendum"] = add[0].body.get("label") if add else None
    # review: U2 attempt 1 blocked, the judge ruled fix, attempt 2 passed; the decision graded right on QAS
    rv = [(e.env.unit, e.env.attempt, e.body.get("ok")) for e in _evs(store, run, codes.REVIEW_DONE)]
    res.check(("U2", 1, False) in rv and ("U2", 2, True) in rv, "review U2 block then pass not seen: %s" % rv)
    res.check(all(ok for u, a, ok in rv if (u, a) != ("U2", 1)), "unexpected review block: %s" % rv)
    jd = _evs(store, run, codes.JUDGE_DECISION)
    res.check(bool(jd) and jd[0].env.unit == "U2" and jd[0].body.get("choice") == "fix",
              "no judge 'fix' on U2: %s" % [e.body for e in jd])
    gr = [e.body for e in _evs(store, run, codes.DECISION_GRADED)]
    res.check(any(g.get("status") == "right" for g in gr), "judge decision not graded right: %s" % gr)
    decs = store.query(E_DECISION, run=run)
    res.check(bool(decs) and all(d.get("status") == "right" for d in decs),
              "decision log: %s" % [(d.get("id"), d.get("status")) for d in decs])
    res.numbers["reviews"] = len(rv)
    # drift
    dr = [(e.env.unit, e.env.attempt, e.body.get("action")) for e in _evs(store, run, codes.DRIFT_SIGNAL)]
    notes = [d for d in dr if d[2] == "note"]
    res.check(bool(notes), "no drift note: %s" % dr)
    res.numbers["drift_notes"] = len(notes)
    # learning loop: lessons proposed from the run's failures and judged at run end
    lp = _after_run(store, run, codes.LESSON_PROPOSED)
    lj = _after_run(store, run, codes.LESSON_JUDGED)
    green = _evs(store, run, codes.RUN_GREEN)
    res.check(bool(lp) and bool(lj) and bool(green) and min(e.seq for e in lp) > green[0].seq,
              "no lesson proposed + judged after the run ended")
    res.check(not [e for e in store.events_after(green[0].seq if green else 0, run=run, limit=1000000)
                   if green and e.seq > green[0].seq], "events on the run after run.green")
    res.check(any(e.body.get("verdict") == "approve" for e in lj),
              "no lesson approved for canary: %s" % [e.body for e in lj])
    res.numbers["lessons"] = "%d/%d" % (len(lp), len(lj))
    # observability: GET /api/metrics serves the run
    from line.server import LineServer
    srv = LineServer(store, cfg, port=0).start()
    try:
        _, m = _http("GET", srv.url + "/api/metrics?run=" + run)
    finally:
        srv.stop()
    mr = (m.get("runs") or [{}])[0]
    res.check(mr.get("run") == run and mr.get("first_pass_yield") is not None and bool(mr.get("f_items")),
              "metrics endpoint: %s" % {k: mr.get(k) for k in ("run", "first_pass_yield", "units")})
    res.numbers["fpy"] = mr.get("first_pass_yield")
    res.check(bool(p.run_end.get("observe")), "observe run end produced nothing")
    res.check(bool(p.obs_calls), "no observed model call")
    res.check(bool(p.run_end.get("agents")), "agent directory run end produced nothing")
    # merged units leave no worktree behind (their work is on main)
    left = [u["id"] for u in store.query(E_UNIT, run=run) if u.get("worktree") and os.path.isdir(u["worktree"])]
    res.check(not left, "worktrees of merged units still on disk: %s" % left)


def check_fgraph(res: Result, store: Any, run: str) -> None:
    """Feature graph on: the graph is extracted, checked and stored; F3 (uses F1's add command) is ordered
    after F1, the planner's units respect it (no FEATURE_ORDER), and the run goes green."""
    from line.contracts import E_FGRAPH, E_GRAPH
    evs = store.events_after(0, run=run, limit=1000000)
    fg = store.get(E_FGRAPH, run) or {}
    order = fg.get("order") or []
    res.numbers["fgraph_order"] = ">".join(order)
    res.check(any(e.kind == codes.FGRAPH_CHECKED for e in evs), "no fgraph.checked event")
    res.check("f1" in order and "f3" in order and order.index("f1") < order.index("f3"),
              "F3 is not ordered after F1: %s" % order)
    derived = [(e["src"], e["dst"]) for e in fg.get("edges") or [] if e.get("derived")]
    res.check(("f3", "f1") in derived, "no derived f3 -> f1 edge: %s" % derived)
    g = store.get(E_GRAPH, run) or {}
    u4 = next((u for u in g.get("units") or [] if "F3" in (u.get("f_items") or [])), {})
    res.check("U2" in (u4.get("deps") or []), "the F3 unit does not wait for the F1 unit: %s" % u4.get("deps"))
    res.check(any(e.kind == codes.RUN_GREEN for e in evs), "the run did not go green with the feature graph on")


def check_decide_off(res: Result, store: Any, run: str, p: Any) -> None:
    """Human questions off: nothing parks waiting for a person; the model answered every question, each
    decision is a human.decided event and one worklog line, and the run went on to green."""
    evs = store.events_after(0, run=run, limit=1000000)
    asked = [q for e in evs if e.kind == codes.HUMAN_QUESTION for q in e.body.get("questions") or []]
    decided = [e for e in evs if e.kind == codes.HUMAN_DECIDED]
    res.numbers["decided"] = len(decided)
    res.check(bool(asked), "the planted contradiction asked nothing")
    res.check(len(decided) == len(asked), "decided %d of %d questions" % (len(decided), len(asked)))
    res.check(all((e.body.get("model") or "").startswith("model:") for e in decided), "a decision without its model")
    lines = getattr(getattr(p.rag, "local", p.rag), "worklog", [])
    res.check(len(lines) == len(decided) and all("human questions off" == w["subject"] for w in lines),
              "worklog lines %d for %d decisions" % (len(lines), len(decided)))
    res.check(any(e.kind == codes.RUN_GREEN for e in evs), "the run did not go green on the model's decisions")


def plant_seal_taint(dst: str) -> str:
    """Pack copy whose dry scorer refuses U2#1 (dry/_variants/seal_taint overlays dry/seal); U4 gets a second
    attempt fixture (the same files) for the redo after its producer's seal failed."""
    shutil.copytree(PACK, dst)
    over = os.path.join(dst, "dry", "_variants", "seal_taint", "dry")
    shutil.copytree(over, os.path.join(dst, "dry"), dirs_exist_ok=True)
    u4 = os.path.join(dst, "dry", "builder", "U4")
    if not os.path.isdir(os.path.join(u4, "attempt2")):
        shutil.copytree(os.path.join(u4, "attempt1"), os.path.join(u4, "attempt2"))
    return dst


def check_seal(res: Result, store: Any, run: str, taint: bool = False) -> None:
    """Every merged unit merged from a finalised seal, the ledger chain re-walks, the run's final seal holds.
    taint: U2#1 was refused by its score, U2 was built again and what speculated on U2#1 was voided and redone."""
    from line.contracts import E_SEAL, E_SEAL_ENTRY
    from line.seal.ledger import SealLedger
    rows = {r["id"]: r for r in store.query(E_SEAL, run=run)}
    ledger = SealLedger(entries=store.query(E_SEAL_ENTRY, run=run))
    res.check(ledger.verify(), "seal ledger chain does not verify")
    res.numbers["seal_entries"] = len(ledger.entries())
    merged = {u["id"]: int(u.get("attempt") or 0) for u in store.query(E_UNIT, run=run) if u.get("state") == "merged"}
    unsealed = [u for u, n in merged.items() if ledger.state("%s:%s#%d" % (run, u, n)) != "sealed"
                or (rows.get("%s:%s#%d" % (run, u, n)) or {}).get("rt_state") != "sealed"]
    res.check(merged and not unsealed, "merged units without a finalised seal: %s" % unsealed)
    final = "%s:final#1" % run
    res.check(ledger.state(final) == "sealed", "final seal is %s" % ledger.state(final))
    evs = store.events_after(0, run=run, limit=1000000)
    kinds = {e.kind for e in evs}
    for k in (codes.SEAL_GATED, codes.SEAL_SUBMITTED, codes.SEAL_SCORED, codes.SEAL_SEALED):
        res.check(k in kinds, "no %s event" % k)
    order = {e.env.unit: e.seq for e in evs if e.kind == codes.UNIT_MERGED}
    sealed_at = {}
    for e in evs:
        if e.kind == codes.SEAL_SEALED and e.env.unit:
            sealed_at.setdefault(e.env.unit, []).append(e.seq)
    early = [u for u, seq in order.items() if not any(x < seq for x in sealed_at.get(u, []))]
    res.check(not early, "merged before its seal finalised: %s" % early)
    spec = [r["id"] for r in rows.values() if r.get("spec_on")]
    res.numbers["speculative"] = len(spec)
    res.numbers["sealed"] = sum(1 for r in rows.values() if r.get("rt_state") == "sealed")
    if taint:
        u2 = "%s:U2#1" % run
        res.check(ledger.state(u2) == "rejected", "U2#1 seal is %s, expected rejected" % ledger.state(u2))
        res.check(merged.get("U2", 0) >= 2, "U2 not rebuilt after its refused seal (merged from #%s)" % merged.get("U2"))
        tainted = [r["id"] for r in rows.values() if r.get("tainted_by") == u2]
        res.numbers["tainted"] = len(tainted)
        for t in tainted:
            st = ledger.state(t)
            res.check(st in ("void", "sealed"), "tainted %s left %s" % (t, st))
            uid = t.rsplit(":", 1)[1].split("#")[0]
            res.check(merged.get(uid, 0) > int(t.rsplit("#", 1)[1]), "tainted %s was not redone" % t)
        res.check(any(e.kind == codes.SEAL_TAINTED for e in evs) == bool(tainted), "seal.tainted events vs rows")
        res.check(bool(tainted), "nothing speculated on U2#1 (U4 should start on it)")


def plant_conflict(dst: str) -> str:
    """Pack copy whose spec plants a contradiction (dry/_variants/conflict_park overlays the copy)."""
    shutil.copytree(PACK, dst)
    over = os.path.join(dst, "dry", "_variants", "conflict_park")
    shutil.copyfile(os.path.join(over, "spec.md"), os.path.join(dst, "spec.md"))
    shutil.copyfile(os.path.join(over, "conflicts", "extract.json"), os.path.join(dst, "dry", "conflicts", "extract.json"))
    return dst


def _http(method: str, url: str, body: Optional[Dict[str, Any]] = None) -> Any:
    import urllib.request
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


def drive_conflict_park(res: Result, store: Any, cfg: Any, pack: str, target: str, kw: Dict[str, Any]) -> str:
    from line.pipeline import make_driver
    from line.server import LineServer
    driver = make_driver(store, cfg, **kw)
    srv = LineServer(store, cfg, driver=driver, port=0).start()
    try:
        _, out = _http("POST", srv.url + "/api/runs", {"pack": pack, "target": target})
        run = out["run"]
        res.run = run
        t = driver.threads[run]
        t.join(240)
        res.check(not t.is_alive(), "the parked drive did not return")
        row = store.get(E_RUN, run) or {}
        _, q = _http("GET", srv.url + "/api/runs/%s/questions" % run)
        open_qs = [x for x in q.get("questions") or [] if x.get("state") == "open"]
        kinds = sorted(str(x.get("kind")) for x in open_qs)
        res.numbers["parked_with"] = ",".join(kinds)
        res.check(row.get("state") == RunState.UNDERSTANDING.value and q.get("parked"),
                  "run not parked in understanding: %s parked=%s" % (row.get("state"), q.get("parked")))
        res.check("conflict" in kinds, "the planted contradiction asked nothing: %s" % kinds)
        evs = store.events_after(0, run=run, limit=1000000)
        res.check(not [e for e in evs if e.kind in (codes.ESCALATED, codes.RUN_GREEN)], "a parked run has a terminal event")
        res.check(any(e.kind == codes.RUN_PARKED for e in evs), "no run.parked")
        b = board(store, run)
        res.check(len([x for x in b["human"]["questions"] if x.get("state") == "open"]) == len(open_qs)
                  and b["human"]["parked"], "board does not show the open questions")
        # the person decides: the F1 sentence holds for a missing file (keep_b); the gap: the recommendation
        answers = [{"qid": x["qid"], "option": "keep_b" if x.get("kind") == "conflict" else x.get("recommended")}
                   for x in open_qs]
        st, out = _http("POST", srv.url + "/api/runs/%s/answers" % run, {"who": "product owner", "answers": answers})
        res.check(st == 200 and out.get("resume") and out.get("addendum") == "v1.1"
                  and (out.get("resumed") or {}).get("resuming"),
                  "answers did not resume the run: %s" % {k: out.get(k) for k in ("remaining", "addendum", "resume",
                                                                                   "resumed")})
        t = driver.threads[run]
        t.join(300)
        res.check(not t.is_alive(), "the resumed drive did not finish")
        x = store.query("conflict", run=run)
        res.check(bool(x) and all(c.get("state") == "resolved" for c in x),
                  "conflict not resolved: %s" % [(c.get("id"), c.get("state")) for c in x])
        res.numbers["questions"] = len(open_qs)
        return run
    finally:
        srv.stop()


def drive_migrate(res: Result, store: Any, cfg: Any, work: str, kw: Dict[str, Any], estate: bool = False) -> str:
    """Flow 4 over HTTP: start (ask mode), park on the conflict, answer v2, finish green; returns the build run.
    estate=True: v1 is a folder of repositories (samples/migrate-estate), scanned per repository and merged."""
    from line.e2e.migrate_estate import REPOS, make_estate
    from line.e2e.migrate_pair import make_pair
    from line.pipeline import make_driver
    from line.server import LineServer
    pair = make_estate(os.path.join(work, "estate")) if estate else make_pair(os.path.join(work, "pair"))
    srv = LineServer(store, cfg, driver=make_driver(store, cfg, **kw), port=0).start()
    try:
        st, out = _http("POST", srv.url + "/api/migrations", dict(pair, mode="ask"))
        res.check(st == 202 and out.get("migration"), "POST /api/migrations: %s %s" % (st, out))
        mid = out["migration"]
        res.numbers["migration"] = mid

        def wait(states: tuple, limit: float = 300) -> Dict[str, Any]:
            until = time.monotonic() + limit
            v: Dict[str, Any] = {}
            while time.monotonic() < until:
                _, v = _http("GET", srv.url + "/api/migrations/" + mid)
                if v["migration"]["state"] in states:
                    return v
                time.sleep(0.5)
            return v

        v = wait(("parked", "green", "escalated", "analysed"))
        res.check(v["migration"]["state"] == "parked", "not parked on the conflict: %s" % v["migration"])
        res.check([q["conflict"] for q in v.get("questions") or []] == ["C1"], "questions %s" % v.get("questions"))
        m = (v["migration"].get("counts") or {}).get("matrix") or {}
        res.check((m.get("v1_only"), m.get("v2_only"), m.get("both_same"), m.get("both_conflict"), m.get("custom"))
                  == (1, 1, 1, 1, 1), "matrix counts %s" % m)
        res.check(not v["migration"]["run"], "a build run started before the conflict was decided")
        st, out = _http("POST", srv.url + "/api/migrations/%s/answers" % mid,
                        {"answers": [{"conflict": "C1", "choice": "v2"}], "who": "e2e"})
        res.check(st == 200 and out.get("resume"), "answers: %s %s" % (st, out))
        v = wait(("green", "escalated", "analysed"), 600)
    finally:
        srv.stop()
    mrow = v["migration"]
    res.check(mrow["state"] == "green", "migration not green: %s" % mrow)
    run = mrow.get("run") or ""
    res.run = run
    d = os.path.join(cfg.workroot, "migrations", mid)
    for name in ("inventory-v1.json", "inventory-v2.json", "confirm.json", "matrix.md", "blast.json", "baseline.json",
                 "verify.json", "decisions.jsonl", "report.md", os.path.join("backup", "C1-v1.md"),
                 os.path.join("pack", "spec.md")):
        res.check(os.path.isfile(os.path.join(d, name)), "artefact missing: %s" % name)
    def jload(name: str) -> Any:
        with open(os.path.join(d, name), encoding="utf-8") as fh:
            return json.load(fh)
    inv1 = jload("inventory-v1.json")
    pre = "v1.shop_srv_order." if estate else "v1."
    res.check([f["id"] for f in inv1["unproven"]] == [pre + "loyalty-points"], "unproven %s" % inv1["unproven"])
    conf = jload("confirm.json")
    exp_id = "v1.shop_srv_export.export-csv" if estate else "v1.export-csv"
    res.check(any(c["feature"] == exp_id and c["hits"] and c["verdict"] == "absent" for c in conf),
              "confirmation pass did not re-check the export: %s" % conf)
    if estate:
        scan = jload("scan-v1.json")
        res.check([(r["repo"], r["status"]) for r in scan["repos"]] == [(n, "ok") for n in sorted(REPOS)],
                  "per-repo scan %s" % scan["repos"])
        add = [f for f in inv1["features"] if f["name"] == "Add an item"]
        res.check(len(add) == 1 and add[0]["repos"] == ["shop_db_order", "shop_srv_order"]
                  and len(add[0].get("merged_from") or []) == 2, "cross-repo merge %s" % add)
        res.check(all(e["path"].split("/")[0] in REPOS for f in inv1["features"] for e in f["evidence"]),
                  "evidence paths not prefixed by the repository")
        with open(os.path.join(d, "report.md"), encoding="utf-8") as fh:
            rep_text = fh.read()
        res.check("## Repositories scanned" in rep_text and "shop_srv_export" in rep_text, "no per-repo table")
        nrepo = len([e for e in store.events_after(0, run=mid, limit=100000) if e.kind == codes.MIGRATION_REPO])
        res.check(nrepo == 3, "%d migration.repo events, want 3" % nrepo)
        res.numbers["repos"] = len(REPOS)
    ver = jload("verify.json")
    res.check(ver["regressions"] == [] and ver["passed"] == 5, "verify %s" % ver)
    out = subprocess.run([_pyexe(), "-m", "store", "--file", os.path.join(work, "book.json"), "export"],
                         cwd=pair["v2"], capture_output=True, text=True)
    res.check(out.returncode == 0 and out.stdout.startswith("name,price"), "v2 main has no export: %r" % out.stderr)
    c1 = [c for c in v["conflicts"] if c["id"] == "C1"]
    res.check(c1 and c1[0]["choice"] == "v2" and c1[0]["who"] == "e2e", "C1 decision %s" % c1)
    kinds = [e.kind for e in store.events_after(0, run=mid, limit=100000)]
    for k in (codes.MIGRATION_ADMITTED, codes.MIGRATION_MATRIX, codes.MIGRATION_PARKED, codes.MIGRATION_DECIDED,
              codes.MIGRATION_BASELINE, codes.MIGRATION_BUILD, codes.MIGRATION_VERIFIED, codes.MIGRATION_DONE):
        res.check(k in kinds, "no %s event" % k)
    res.numbers["matrix"] = "1/1/1/1"
    return run


def check_rag(res: Result, store: Any, p: Any, remote: Any) -> None:
    rag = p.rag
    evs = store.events_after(0, limit=1000000)
    deg = [e for e in evs if e.kind == codes.RAG_DEGRADED_KIND]
    res.check(deg, "no rag.degraded event during the outage")
    res.check(any(e.env.run == p.run for e in deg), "no run-level rag.degraded mirror on the run")
    queued = len(store.outbox_peek(100000))
    res.numbers["outbox_during_outage"] = queued
    res.check(queued > 0, "nothing queued in the outbox during the outage")
    remote.down = False
    rag.probe()
    rag.sync_events()
    left = len(store.outbox_peek(100000))
    res.numbers["outbox_after_restore"] = left
    res.check(left == 0, "outbox not drained after restore: %d left" % left)
    res.check(any(e.kind == codes.RAG_RESTORED for e in store.events_after(0, limit=1000000)), "no rag.restored")
    seqs = [int(e.get("seq", 0)) for e in remote.events]
    last = store.last_seq()
    synced_upto = max(seqs) if seqs else 0
    res.check(seqs == sorted(seqs) and len(seqs) == len(set(seqs)), "remote got events out of order or twice")
    res.check(set(seqs) == set(range(1, synced_upto + 1)), "remote event log has holes")
    res.check(synced_upto >= last - 5, "remote behind: %d of %d" % (synced_upto, last))
    res.numbers["remote_events"] = len(seqs)


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    verbose = "-v" in args
    names = [a for a in args if not a.startswith("-")] or list(VARIANTS)
    results = []
    for v in names:
        print("== %s" % v, flush=True)
        r = run_variant(v, log=(lambda m: print("   " + m, flush=True)) if verbose else None)
        results.append(r)
        print(r.line(), flush=True)
        print("   run %s  work %s" % (r.run, r.work), flush=True)
    bad = [r.variant for r in results if not r.ok]
    print("e2e: %d/%d variants passed%s" % (len(results) - len(bad), len(results), (" (failed: %s)" % ", ".join(bad)) if bad else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
