"""`dlc`: the one command of the delivered DLC application.

    dlc version
    dlc serve [--resume] [-v]                 HTTP API + board (LINE_HOST / LINE_PORT, default 127.0.0.1:8796)
    dlc run <pack> [--target <repo>]          admit and drive one run in this process
    dlc resume <run> | status [run] | board [run]
    dlc cancel <run> [--reason R] [--url U]   ask a running server to cancel a run
    dlc migrate --v1 ... --v2 ... [...]       feature migration (same options as the API)
    dlc migrate-answer <migration> <conflict> v2|v1
    dlc mcp                                   stdio MCP server for an agent of a run (started by the engine)
    dlc hook guard                            PreToolUse hook: refuses push to main, deletes outside the work folder, prod deploys
    dlc [--env-file F] [--log-file F] <cmd>   load the environment from F / append output to F (scheduled-task mode)
    dlc tray [--engine U] [--fe U] [--kh U]   Windows tray icon: red while the stack starts, green when ready, click opens it
    dlc selfcheck                             offline self-test: dry runs with the bundled samples (fake model)
    dlc rag-manifest apply                    apply the engine's manifest to the configured RAG system
    dlc doc <file.pdf|file.docx> [out.md]      a PDF / Word document as markdown (line.docread)
    dlc import-flows --url U --dir D          load delivery workflow documents into a workflow tool
    dlc flow <new|enhance|bug|wait|migrate|migwait|migresume>   helper for workflow shell steps (env inputs)

Data location: DLC_HOME (default ~/dlc). In the built application LINE_DB and LINE_WORKROOT default to
DLC_HOME/line.db and DLC_HOME/work when not set.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from typing import List, Optional

from . import __version__
from .runtime import frozen, hide_child_consoles


def _defaults() -> None:
    home = os.environ.get("DLC_HOME") or os.path.join(os.path.expanduser("~"), "dlc")
    if frozen():
        os.environ.setdefault("LINE_DB", os.path.join(home, "line.db"))
        os.environ.setdefault("LINE_WORKROOT", os.path.join(home, "work"))
        os.makedirs(home, exist_ok=True)


def _selfcheck() -> int:
    """Dry end-to-end runs with the bundled samples and the fake model: no network, no cost."""
    from .e2e import run_line_e2e
    work = tempfile.mkdtemp(prefix="dlc-selfcheck-")
    saved = {k: os.environ.get(k) for k in ("LINE_WORKROOT", "LINE_DB", "LINE_LLM", "LINE_RAG")}
    os.environ["LINE_WORKROOT"] = work
    os.environ.pop("LINE_DB", None)
    os.environ["LINE_LLM"], os.environ["LINE_RAG"] = "fake", "off"
    try:
        rc = run_line_e2e.main(["base", "migrate"])
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    print("selfcheck: %s" % ("PASS" if rc == 0 else "FAIL"), flush=True)
    return 0 if rc == 0 else 1


def _rag_manifest(argv: List[str]) -> int:
    if argv[:1] != ["apply"]:
        print("usage: dlc rag-manifest apply", file=sys.stderr)
        return 2
    from .config import load_config
    from .rag.http_adapter import HttpRagAdapter
    res = HttpRagAdapter.from_config(load_config(rag="http")).apply_manifest()
    print(json.dumps(res, default=str))
    return 0


def _cancel(argv: List[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="dlc cancel")
    ap.add_argument("run")
    ap.add_argument("--reason", default="")
    ap.add_argument("--url", default=os.environ.get("DLC_LINE_URL", "http://127.0.0.1:8796"))
    a = ap.parse_args(argv)
    req = urllib.request.Request("%s/api/runs/%s:cancel" % (a.url.rstrip("/"), a.run),
                                 json.dumps({"reason": a.reason}).encode(), {"Content-Type": "application/json"},
                                 method="POST")
    try:
        print(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace"))
        return 0
    except urllib.error.HTTPError as e:
        print(e.read().decode("utf-8", "replace"), file=sys.stderr)
        return 1
    except (OSError, urllib.error.URLError) as e:
        print("error: %s" % e, file=sys.stderr)
        return 2


def _global_options(args: List[str]) -> List[str]:
    """--env-file F (KEY=VALUE lines or a JSON object, loaded before anything else) and --log-file F (stdout and
    stderr appended there): how the engine runs from a scheduled task under a person's account, where there is
    no service wrapper to set the environment or keep the log."""
    out, i = [], 0
    while i < len(args):
        a = args[i]
        if a in ("--env-file", "--log-file") and i + 1 < len(args):
            val = args[i + 1]
            if a == "--env-file":
                with open(val, encoding="utf-8-sig") as fh:
                    text = fh.read()
                pairs = json.loads(text) if text.lstrip().startswith("{") else dict(
                    l.split("=", 1) for l in text.splitlines() if "=" in l and not l.lstrip().startswith("#"))
                for k, v in pairs.items():
                    os.environ[str(k).strip()] = os.path.expandvars(str(v))
            else:
                os.makedirs(os.path.dirname(os.path.abspath(val)), exist_ok=True)
                log = open(val, "a", encoding="utf-8", buffering=1)
                sys.stdout = sys.stderr = log
            i += 2
            continue
        out.append(a)
        i += 1
    return out


def _utf8_output() -> None:
    """stdout / stderr in UTF-8 whatever the console or pipe says. The built application ignores PYTHONIOENCODING
    (PyInstaller isolates it from PYTHON* variables), so `dlc suite` run by the QAS deploy through a pipe wrote
    with cp1252 and died on the first test runner's check mark (UnicodeEncodeError on U+2713): every solo run
    failed its QAS smoke with a green suite (runs R20261025-123732-8c48, -124714-1c99)."""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def main(argv: Optional[List[str]] = None) -> int:
    _utf8_output()
    args = _global_options(list(sys.argv[1:] if argv is None else argv))
    _defaults()
    hide_child_consoles()
    if not args or args[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0 if args else 2
    cmd, rest = args[0], args[1:]
    if cmd in ("version", "--version"):
        print("dlc %s" % __version__)
        return 0
    if cmd == "hook" and rest[:1] == ["guard"]:   # PreToolUse hook of the agents' shell commands (line.agent_guard)
        from .agent_guard import main as guard_main
        return guard_main()
    if cmd == "mcp":                      # the stdio MCP server an agent gets during a run (line.agent_mcp)
        from .agent_mcp import main as mcp_main
        return mcp_main()
    if cmd == "doc":                      # a PDF / Word document as markdown (line.docread)
        from .docread import main as doc_main
        return doc_main(rest)
    if cmd == "suite":                    # the solo lane's QAS smoke: the whole test suite of the cwd (line.solo)
        from .solo import main as suite_main
        return suite_main(rest)
    if cmd == "tray":                     # the tray icon of the local stack: red starting, green ready (line.tray)
        from .tray import main as tray_main
        return tray_main(rest)
    if cmd == "selfcheck":
        return _selfcheck()
    if cmd == "rag-manifest":
        return _rag_manifest(rest)
    if cmd == "cancel":
        return _cancel(rest)
    if cmd == "import-flows":
        from .tools import import_dlc_flows
        return int(import_dlc_flows.main(rest))
    if cmd == "flow":
        from . import flowhelper
        if not rest:
            print("usage: dlc flow <%s>" % "|".join(flowhelper.MODES), file=sys.stderr)
            return 2
        return flowhelper.main(rest[0])
    if cmd in ("serve", "run", "resume", "status", "board", "migrate", "migrate-answer"):
        from . import cli
        return int(cli.main(args))
    print("unknown command: %s (dlc help)" % cmd, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
