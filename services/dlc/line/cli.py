"""Command line of the SDLC line (run from Slaves/SDLC).

    python -m line.cli run <pack> [--target <repo>]   admit + drive one run in this process
    python -m line.cli resume <run>                   drive a stopped non-final run from its persisted state
    python -m line.cli status [run]                   runs, or one run's units / escalations / spend
    python -m line.cli board [run]                    the board projection as JSON
    python -m line.cli serve [--resume]               the board server (127.0.0.1:8796); --resume (or
                                                      LINE_AUTO_RESUME=1) resumes every non-final run at start
    python -m line.cli migrate --v1 R --v2 R [...]    feature migration v1 -> v2 (docs/dlc/feature-migration.md)
    python -m line.cli migrate-answer M C v2|v1       decide one conflict of a parked migration, then continue

Settings come from LINE_* (line.config): LINE_LLM=fake|cli|api, LINE_DRY_PACK, LINE_RAG=off|http,
LINE_MAX_USD_RUN, LINE_MAX_USD_CALL, LINE_WORKROOT, LINE_DB ...
Exit code of `run` / `resume`: 0 green, 1 escalated, 2 usage/config error (also: run unknown, final,
or driven by another live process). `migrate`: 0 green or analysed, 3 parked on conflicts, 1 escalated.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, List, Optional

from .codes import LineError
from .config import load_config
from .contracts import E_ESCALATION, E_LLM_CALL, E_RUN, E_UNIT, RunState


def _store(cfg: Any) -> Any:
    from .store import open_store
    return open_store(cfg)


def cmd_run(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline
    cfg = load_config()
    store = _store(cfg)
    p = Pipeline(store, cfg, log=lambda m: print("[line] " + m, flush=True))
    run = p.admit(args.pack, args.target or "")
    extra = {k: getattr(args, k) for k in ("flow", "lane", "level", "rag_project") if getattr(args, k, "")}
    if extra:                                  # as POST /api/runs stores them
        from .statemachine import update_row
        row = store.get(E_RUN, run) or {}
        update_row(store, E_RUN, run, {"detail": dict(row.get("detail") or {}, **extra)})
    print("[line] run %s admitted (llm=%s model=%s rag=%s max_usd_run=%.2f)"
          % (run, cfg.llm, cfg.model, cfg.rag, cfg.max_usd_run), flush=True)
    row = p.drive(run)
    _print_status(store, run)
    return 0 if row.get("state") == RunState.GREEN.value else 1


def cmd_resume(args: argparse.Namespace) -> int:
    from .pipeline import Pipeline
    cfg = load_config()
    store = _store(cfg)
    row = store.get(E_RUN, args.run)
    if row is None:
        print("error: no run %s" % args.run, file=sys.stderr)
        return 2
    if row.get("state") in (RunState.GREEN.value, RunState.ESCALATED.value):
        print("error: run %s is already %s" % (args.run, row["state"]), file=sys.stderr)
        _print_status(store, args.run)
        return 2
    print("[line] resuming run %s from %s (llm=%s model=%s rag=%s)" % (args.run, row["state"], cfg.llm, cfg.model,
                                                                      cfg.rag), flush=True)
    p = Pipeline(store, cfg, log=lambda m: print("[line] " + m, flush=True))
    row = p.drive(args.run)
    _print_status(store, args.run)
    return 0 if row.get("state") == RunState.GREEN.value else 1


def _print_status(store: Any, run: str) -> None:
    row = store.get(E_RUN, run)
    if row is None:
        print("no run %s" % run)
        return
    spent = sum(float(c.get("usd") or 0) for c in store.query(E_LLM_CALL, run=run))
    print("run %s: %s   spent $%.4f of $%.2f   spec %s" % (run, row["state"], spent, float(row.get("budget_usd") or 0),
                                                          (row.get("spec_hash") or "")[:12]))
    print("  target %s" % (row.get("detail") or {}).get("target", ""))
    for u in store.query(E_UNIT, run=run):
        print("  %-10s %-9s wave %d attempt %d rung %d %s" % (u["id"], u["state"], int(u.get("wave") or 0),
                                                             int(u.get("attempt") or 0), int(u.get("rung") or 0),
                                                             u.get("title", "")))
    for e in store.query(E_ESCALATION, run=run):
        print("  escalation %s: %s" % (e.get("code"), e.get("message")))


def cmd_status(args: argparse.Namespace) -> int:
    cfg = load_config()
    store = _store(cfg)
    if args.run:
        _print_status(store, args.run)
        return 0
    from .server import _runs, run_summary
    for r in _runs(store):
        s = run_summary(store, r)
        print("%-24s %-13s units %-3d %s" % (s["id"], s["state"], s["units"], s["pack_path"]))
    return 0


def cmd_board(args: argparse.Namespace) -> int:
    cfg = load_config()
    store = _store(cfg)
    from .budget import SqliteBudget
    from .server import board
    print(json.dumps(board(store, args.run, SqliteBudget(store, emit=False)), indent=1, default=str))
    return 0


def _print_migration(store: Any, mid: str) -> None:
    from .migrate import view
    v = view(store, mid)
    m = v["migration"]
    print("migration %s: %s%s   mode %s   build run %s" % (m["id"], m["state"], (" (%s)" % m["code"]) if m["code"] else "",
                                                        m["mode"], m["run"] or "-"))
    print("  matrix %s" % json.dumps((m.get("counts") or {}).get("matrix") or {}))
    for q in v["questions"]:
        print("  open %s %s: v2 = %s | v1 = %s" % (q["conflict"], q["feature"], q["options"][0]["label"],
                                                q["options"][1]["label"]))
    if m["report"]:
        print("  report %s" % m["report"])


def cmd_migrate(args: argparse.Namespace) -> int:
    cfg = load_config()
    store = _store(cfg)
    from .migrate import Migrator
    m = Migrator(store, cfg, log=lambda msg: print("[migrate] " + msg, flush=True))
    mid = m.admit({"v1": args.v1, "v1_ref": args.v1_ref, "v1_base": args.v1_base, "v2": args.v2,
                   "v2_ref": args.v2_ref, "notes": args.notes, "mode": args.mode, "scope": args.scope or [],
                   "build": not args.no_build, "v1_repos": args.v1_repos, "v2_repos": args.v2_repos})
    row = m.drive(mid)
    _print_migration(store, mid)
    return 0 if row.get("state") in ("green", "analysed") else (3 if row.get("state") == "parked" else 1)


def cmd_migrate_answer(args: argparse.Namespace) -> int:
    cfg = load_config()
    store = _store(cfg)
    from .migrate import Migrator
    m = Migrator(store, cfg, log=lambda msg: print("[migrate] " + msg, flush=True))
    res = m.answer(args.migration, [{"conflict": args.conflict, "choice": args.choice}], who=args.who)
    if res["resume"]:
        m.drive(args.migration)
    _print_migration(store, args.migration)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from . import server
    return server.main((["-v"] if args.verbose else []) + (["--resume"] if args.resume else []))


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m line.cli", description="SDLC autonomous line (dev)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("run", help="admit and drive one spec pack")
    p.add_argument("pack")
    p.add_argument("--target", default="", help="git repo with branch main (default: fresh repo under LINE_WORKROOT)")
    p.add_argument("--flow", default="", help="new | enhancement | bug-fix (the request's process)")
    p.add_argument("--lane", default="", choices=["", "solo", "trivial", "small", "full"],
                   help="solo = one agent and the gates; the others = the multi-agent line (default: by level)")
    p.add_argument("--rag-project", default="", help="the project's knowledge-store id (context of its requests)")
    p.add_argument("--level", default="", choices=["", "1", "2", "3", "4"],
                   help="1-2 one agent (2 with a reviewer), 3-4 the team (default: the change sizer decides)")
    p.set_defaults(fn=cmd_run)
    p = sub.add_parser("resume", help="drive a stopped non-final run from its persisted state")
    p.add_argument("run")
    p.set_defaults(fn=cmd_resume)
    p = sub.add_parser("status", help="runs, or one run")
    p.add_argument("run", nargs="?", default="")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("board", help="board projection (JSON)")
    p.add_argument("run", nargs="?", default=None)
    p.set_defaults(fn=cmd_board)
    p = sub.add_parser("migrate", help="feature migration v1 -> v2 (flow 4)")
    p.add_argument("--v1", required=True,
                   help="v1: a git repository, or a folder of git repositories (estate: scanned per repository)")
    p.add_argument("--v1-repos", default="", help="v1 repository list file (JSON or one 'path [ref]' per line)")
    p.add_argument("--v1-ref", default="", help="v1 commit/branch/tag to read (default: working tree; estate: "
                                                    "used in every repository that has it, else HEAD)")
    p.add_argument("--v1-base", default="", help="ref of the vanilla v1, to flag customer custom features")
    p.add_argument("--v2", required=True, help="v2 git repository = target (branch main, clean); a folder of "
                                               "repositories is analysed only (TARGET_ESTATE)")
    p.add_argument("--v2-repos", default="", help="v2 repository list file")
    p.add_argument("--v2-ref", default="", help="expected commit of v2 main")
    p.add_argument("--notes", default="", help="customer notes (.md)")
    p.add_argument("--mode", default="ask", choices=["ask", "decide"])
    p.add_argument("--scope", nargs="*", default=[], help="only features matching these words / path prefixes")
    p.add_argument("--no-build", action="store_true", help="analysis and report only")
    p.set_defaults(fn=cmd_migrate)
    p = sub.add_parser("migrate-answer", help="decide one conflict of a parked migration, then continue")
    p.add_argument("migration")
    p.add_argument("conflict")
    p.add_argument("choice", choices=["v2", "v1"])
    p.add_argument("--who", default="person")
    p.set_defaults(fn=cmd_migrate_answer)
    p = sub.add_parser("serve", help="board server")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument("--resume", action="store_true", help="resume every non-final run at start (LINE_AUTO_RESUME)")
    p.set_defaults(fn=cmd_serve)
    args = ap.parse_args(argv)
    try:
        return int(args.fn(args))
    except LineError as e:
        print("error: %s" % e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
