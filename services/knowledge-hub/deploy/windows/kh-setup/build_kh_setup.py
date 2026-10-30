"""Build the offline Windows install package of KH + Keycloak (KH_Setup), 2026-10-20.

The package is install-kh.cmd + INSTALL.html + payload\\. This folder holds the parts made here (installer,
start scripts, kh-helper setup, seed); the large runtimes that do not change between KH releases (embeddable
Python 3.12, PostgreSQL 17, Keycloak fork build, Java 21, kh-helper's Python and dependency wheels) are taken
from an earlier package (--base). KH itself comes from a PyInstaller build of a clean checkout (--kh-dist).

    .venv\\Scripts\\python deploy\\windows\\kh-setup\\build_kh_setup.py --base E:\\STTTemp\\KH_Setup ^
        --kh-dist <clean checkout>\\Slaves\\KnowledgeHub\\dist\\KnowledgeHub --helper-wheel <kh_helper-X-py3-none-any.whl> ^
        --commit <sha> --out E:\\STTTemp\\khub-setup [--refresh-seed]

--refresh-seed reads the Prod kernel (hook rules, every-project policy table) through the signed-in kh-helper
(KH_HELPER_PYTHON, default the ~/.claude_kh profile) before copying it into the package.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KH_ROOT = HERE.parents[2]                         # Slaves/KnowledgeHub
RUNTIMES = ("python", "pgsql", "keycloak", "jre")
KH_EXCLUDE_DIRS = ("logs", "chroma_data", "kuzu_data", "kuzu_projects", "__pycache__")
KH_EXCLUDE_FILES = (".env", "hooks.db", "hooks.db-shm", "hooks.db-wal", "kuzu_data.wal")


def step(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def robocopy(src: Path, dst: Path, *extra: str) -> None:
    rc = subprocess.run(["robocopy", str(src), str(dst), "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", *extra]).returncode
    if rc >= 8:
        raise SystemExit(f"robocopy {src} -> {dst} failed ({rc})")


def kh_call(py: str, method: str, path: str) -> dict:
    env = dict(os.environ, PYTHONIOENCODING="utf-8", MSYS_NO_PATHCONV="1")
    out = subprocess.run([py, "-m", "kh_helper.cli", "call", method, path], capture_output=True, text=True,
                         encoding="utf-8", env=env)
    if out.returncode != 0:
        raise SystemExit(f"kh {method} {path} failed: {(out.stderr or out.stdout).strip()[:400]}")
    return json.loads(out.stdout)


def refresh_seed(seed: Path, py: str) -> None:
    """The Prod kernel, in the shape seed_kh.py reads: hook rules, and the every-project actions with their rules."""
    hooks = kh_call(py, "GET", "/hooks/list")
    (seed / "kernel_hooks.json").write_text(json.dumps({"source": "KH Prod GET /hooks/list", "rules": hooks["rules"]},
                                                       indent=2, ensure_ascii=False), encoding="utf-8")
    actions = kh_call(py, "GET", "/policy/actions")["actions"]
    rules = []
    for a in actions:
        plan = kh_call(py, "GET", "/policy/plan?action=" + a["action"].replace(" ", "%20"))
        rules += [{k: r.get(k, "") for k in ("action", "sub_action", "content", "seq", "clauses")}
                  for r in plan["rules"] if r.get("project") == "every project"]
    keep = ("action", "description", "source_policy", "priority")
    (seed / "policy_actions_every_project.json").write_text(json.dumps(
        {"source": "KH Prod GET /policy/actions + /policy/plan (every-project tier)", "replace": True,
         "actions": [{k: a.get(k) for k in keep} for a in actions], "rules": rules}, indent=2, ensure_ascii=False),
        encoding="utf-8")
    print(f"    seed: {len(hooks['rules'])} hook rules, {len(actions)} actions, {len(rules)} rules", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, type=Path, help="an earlier KH_Setup (its runtimes are reused)")
    ap.add_argument("--kh-dist", required=True, type=Path, help="PyInstaller output folder holding KnowledgeHub.exe")
    ap.add_argument("--helper-wheel", required=True, type=Path)
    ap.add_argument("--commit", required=True, help="the KH commit the exe was built from")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--refresh-seed", action="store_true")
    args = ap.parse_args()

    out, payload, base = args.out.resolve(), args.out.resolve() / "payload", args.base.resolve() / "payload"
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; give an empty or new folder")
    if not (args.kh_dist / "KnowledgeHub.exe").exists():
        raise SystemExit(f"no KnowledgeHub.exe in {args.kh_dist}")
    m = re.match(r"kh_helper-(\d+\.\d+\.\d+)-py3-none-any\.whl$", args.helper_wheel.name)
    if not m or not args.helper_wheel.exists():
        raise SystemExit(f"--helper-wheel must be an existing kh_helper-<x.y.z>-py3-none-any.whl")
    helper_version = m.group(1)
    kh_version = (KH_ROOT / "VERSION").read_text(encoding="utf-8").strip()

    step("1/5 Runtimes from the base package")
    for name in RUNTIMES:
        robocopy(base / name, payload / name, "/XD", "pgdata", "logs", "__pycache__")
        print(f"    {name}", flush=True)
    conf = payload / "keycloak" / "conf" / "keycloak.conf"
    if conf.exists() and "Written by install.py" in conf.read_text(encoding="utf-8", errors="replace"):
        raise SystemExit("the base package's keycloak.conf was written by an install; use a clean package")

    step(f"2/5 KH {kh_version} ({args.commit}) from {args.kh_dist}")
    robocopy(args.kh_dist, payload / "kh", "/XD", *KH_EXCLUDE_DIRS, "/XF", *KH_EXCLUDE_FILES)

    step(f"3/5 kh-helper {helper_version}")
    # Its Python, the Python installer for client machines and the dependency wheels; the scripts come in step 4.
    robocopy(base / "kh-helper", payload / "kh-helper", "/XF", "kh_helper-*.whl", "/XD", "__pycache__")
    shutil.copy2(args.helper_wheel, payload / "kh-helper" / "wheels" / args.helper_wheel.name)

    step("4/5 Installer, start scripts, seed")
    robocopy(HERE / "payload", payload, "/XD", "__pycache__")
    for name in ("install-kh.cmd", "INSTALL.html"):
        shutil.copy2(HERE / name, out / name)
    if args.refresh_seed:
        py = os.environ.get("KH_HELPER_PYTHON") or str(Path.home() / ".claude_kh" / "kh-helper" / "Scripts" / "python.exe")
        refresh_seed(payload / "seed", py)
    values = {"KH_VERSION": kh_version, "KH_COMMIT": args.commit[:7], "HELPER_VERSION": helper_version,
              "BUILT": time.strftime("%Y-%m-%d")}
    for doc in (out / "INSTALL.html", payload / "kh-helper" / "CLAUDE_CONNECT.md"):
        text = doc.read_text(encoding="utf-8")
        for k, v in values.items():
            text = text.replace("{{%s}}" % k, v)
        if "{{" in text:
            raise SystemExit(f"unfilled placeholder in {doc}")
        doc.write_text(text, encoding="utf-8", newline="")

    step("5/5 Check")
    leftovers = [p for p in payload.rglob("*") if p.name in ("pgdata", "secrets", ".env", "hooks.db", "chroma_data")]
    if leftovers:
        raise SystemExit(f"install data in the package: {leftovers[:5]}")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"    {out}  {size / 2**30:.2f} GB, KH {kh_version} {args.commit[:7]}, kh-helper {helper_version}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
