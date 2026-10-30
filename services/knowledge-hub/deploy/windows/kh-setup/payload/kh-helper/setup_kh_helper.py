"""Connect Claude Code on this machine to a KH install: kh-helper in the Claude profile, sign-in, hooks + MCP.

Started by setup-kh-helper.cmd with the small bundled Python, as the person who uses Claude Code (no
administrator rights). Steps, safe to repeat:
  1. find Python 3.10+, or install the bundled Python 3.12 for this user only
  2. kh-helper in its own venv inside the Claude profile (offline from wheels\\ when that Python is 3.12,
     otherwise from the KH server's /auth/download link plus PyPI)
  3. check that KH answers and where it signs in
  4. kh login: a browser opens on the KH Keycloak; the PERSON signs in there (never in a chat)
  5. kh setup: KH hooks and the 'knowledge-hub' MCP server in Claude Code
  6. check: who is signed in, and that the seeded kernel is there

Usage: setup-kh-helper.cmd --kh-url http://<host>:9000 [--claude-profile <dir>] [--no-login]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALLER = HERE / "python-3.12.10-amd64.exe"


def step(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def info(text: str) -> None:
    print(f"    {text}", flush=True)


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def probe(cmd: list[str]) -> tuple[str, str] | None:
    try:
        out = subprocess.run(cmd + ["-c", "import sys; print(sys.executable); print('%d.%d' % sys.version_info[:2])"],
                             capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = out.stdout.split()
    if out.returncode != 0 or len(lines) < 2:
        return None
    major, minor = map(int, lines[1].split("."))
    return (lines[0], lines[1]) if (major, minor) >= (3, 10) else None


def find_python() -> tuple[str, str] | None:
    candidates = [["py", "-3.12"], ["py", "-3"]]
    for name in ("python", "python3"):
        found = shutil.which(name)
        if found and "WindowsApps" not in found:     # the Microsoft Store alias is not a real Python
            candidates.append([found])
    candidates.append([str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "python.exe")])
    for cmd in candidates:
        found = probe(cmd)
        if found:
            return found
    return None


# kh-helper finds its Claude profile in CLAUDE_CONFIG_DIR (Claude Code's own variable), so every kh call gets the
# profile chosen here; otherwise 'kh setup' would write into whatever profile the calling shell points at.
KH_ENV: dict[str, str] = {}


def kh(venv_python: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run([str(venv_python), "-m", "kh_helper.cli", *args], text=True, capture_output=True, env=KH_ENV)
    if check and result.returncode != 0:
        raise SystemExit(f"kh {' '.join(args)} failed ({result.returncode}): {(result.stderr or result.stdout).strip()}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kh-url", default="http://localhost:9000")
    parser.add_argument("--claude-profile", type=Path,
                        default=Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude"))
    parser.add_argument("--no-login", action="store_true", help="the person runs 'kh login' themselves")
    args = parser.parse_args()
    kh_url = args.kh_url.rstrip("/")
    KH_ENV.update(os.environ, CLAUDE_CONFIG_DIR=str(args.claude_profile))

    step("1/6 Python")
    found = find_python()
    if not found:
        info("no Python 3.10+ found: installing Python 3.12.10 for this user")
        subprocess.run([str(INSTALLER), "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_launcher=1",
                        "Include_test=0"], check=True)
        found = find_python()
        if not found:
            raise SystemExit("Python still not found after installing it")
    info(f"{found[0]} ({found[1]})")

    step(f"2/6 kh-helper in {args.claude_profile / 'kh-helper'}")
    venv = args.claude_profile / "kh-helper"
    venv_python = venv / "Scripts" / "python.exe"
    args.claude_profile.mkdir(parents=True, exist_ok=True)
    if not venv_python.exists():
        subprocess.run([found[0], "-m", "venv", str(venv)], check=True)
    version = subprocess.run([str(venv_python), "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
                             capture_output=True, text=True, check=True).stdout.strip()
    if version == "3.12" and (HERE / "wheels").is_dir():
        pip = ["--no-index", "--find-links", str(HERE / "wheels"), "kh-helper"]
    else:
        info(f"Python {version}: installing from {kh_url} (dependencies from PyPI)")
        pip = [get_json(f"{kh_url}/auth/config")["helper"]]
    subprocess.run([str(venv_python), "-m", "pip", "install", "-q", "--upgrade", *pip], check=True)
    info("kh-helper " + subprocess.run([str(venv_python), "-c", "import importlib.metadata as m; print(m.version('kh-helper'))"],
                                       capture_output=True, text=True).stdout.strip())

    step(f"3/6 KH at {kh_url}")
    get_json(f"{kh_url}/health")
    info(f"answers; sign-in at {get_json(f'{kh_url}/auth/config').get('issuer')}")

    step("4/6 Sign in")
    if args.no_login:
        info(f'skipped: the person runs  "{venv_python}" -m kh_helper.cli login --kh-url {kh_url}')
    else:
        info("a browser opens: sign in there with your KH account (first time: the one-time password, then a new one)")
        if subprocess.run([str(venv_python), "-m", "kh_helper.cli", "login", "--kh-url", kh_url], env=KH_ENV).returncode != 0:
            raise SystemExit("kh login failed")

    step("5/6 Claude Code hooks + MCP server")
    print(kh(venv_python, "--kh-url", kh_url, "setup").stdout.rstrip())

    step("6/6 Check")
    status = kh(venv_python, "--kh-url", kh_url, "me", check=False)
    if status.returncode != 0:
        info("not signed in yet: run kh login (step 4), then this script again")
        return 0
    print(status.stdout.rstrip())
    hooks = json.loads(kh(venv_python, "--kh-url", kh_url, "call", "GET", "/hooks/list").stdout)["count"]
    actions = json.loads(kh(venv_python, "--kh-url", kh_url, "call", "GET", "/policy/actions").stdout)["count"]
    info(f"kernel hook rules: {hooks} (expected 5)   policy actions: {actions} (expected 18)")
    print("\nDone. Restart Claude Code: the first prompt shows the KH kernel.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
