"""Tests for hook commands every shell can run (tools/kh-helper 1.18.1), 2026-10-26.

WHAT IS UNDER TEST
  1. THE HOOK COMMAND RUNS IN POWERSHELL. Claude Code on Windows runs hooks with PowerShell when Git for
     Windows is missing. The old command started with a quoted path, which PowerShell reads as a string:
     every hook failed with "Unexpected token '-m'". Now a path without spaces is written unquoted with
     forward slashes; a path with spaces takes its 8.3 name, and only when that fails is the shell guessed.
  2. SETUP CHECKS IT. setup reports hook_shells, one "ok" or "failed: ..." per shell found here.
  3. OLD QUOTED HOOKS ARE NOTICED. hooks_note asks for setup when our hook still has the old form, and the
     MCP server (started without a shell, so it works even when the hooks do not) carries that note.
  4. A REAL RUN. On Windows the written command starts python in PowerShell and in Git Bash when present.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_kh_helper_hookshell.py

No network: the MCP registration and the KH calls are replaced.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools" / "kh-helper"))

from kh_helper import hooks  # noqa: E402

hooks._claude_mcp = lambda kh_url, remove: "skipped (test)"   # never touch the real Claude Code MCP list
hooks._claude_companions = lambda remove: {}

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


def with_exe(exe, fn, git_bash=None, short=None):
    saved = (sys.executable, hooks.os.name, hooks._git_bash, hooks._short_path)
    sys.executable = exe
    hooks._git_bash = lambda: git_bash
    hooks._short_path = (lambda p: short) if short else (lambda p: p)
    try:
        return fn()
    finally:
        sys.executable, _, hooks._git_bash, hooks._short_path = saved


def test_forms():
    if os.name != "nt":
        print("skip forms: Windows only")
        return
    plain = r"C:\Users\laidonit\.claude\kh-helper\Scripts\python.exe"
    got = with_exe(plain, lambda: hooks._hook_command("Stop"))
    check("1 no spaces: unquoted, forward slashes",
          got == "C:/Users/laidonit/.claude/kh-helper/Scripts/python.exe -m kh_helper.cli hook Stop", got)
    spaced = r"C:\Users\Anh Tu\.claude\kh-helper\Scripts\python.exe"
    got = with_exe(spaced, hooks.hook_exe, short=r"C:\Users\ANHTU~1\.claude\kh-helper\Scripts\python.exe")
    check("1 spaces: 8.3 name", got == "C:/Users/ANHTU~1/.claude/kh-helper/Scripts/python.exe", got)
    got = with_exe(spaced, hooks.hook_exe, git_bash=r"C:\Program Files\Git\bin\bash.exe")
    check("1 spaces, no 8.3, Git Bash: quoted", got == '"C:/Users/Anh Tu/.claude/kh-helper/Scripts/python.exe"', got)
    got = with_exe(spaced, hooks.hook_exe)
    check("1 spaces, no 8.3, PowerShell: call operator",
          got == '& "C:/Users/Anh Tu/.claude/kh-helper/Scripts/python.exe"', got)


def test_setup_and_note():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "settings.json"
        old = f'"{sys.executable}" -m kh_helper.cli hook '
        path.write_text(json.dumps({"hooks": {e: [{"matcher": s["matcher"]} if s.get("matcher") else {}]
                                              for e, s in hooks.HOOKS.items()}}), encoding="utf-8")
        settings = json.loads(path.read_text(encoding="utf-8"))
        for event, groups in settings["hooks"].items():
            groups[0]["hooks"] = [{"type": "command", "command": old + event, "timeout": 30}]
        path.write_text(json.dumps(settings), encoding="utf-8")
        saved = hooks.claude_settings_path
        hooks.claude_settings_path = lambda: path
        try:
            note = hooks.hooks_note("claude-code")
            if os.name == "nt":
                check("3 old quoted hooks are noticed", "KH HOOKS OUT OF DATE" in note, note)
            result = hooks.setup_claude(path, "http://kh.test")
            check("2 setup reports hook_shells", isinstance(result.get("hook_shells"), dict) and result["hook_shells"],
                  result.get("hook_shells"))
            check("2 every shell found starts the hook", all(v == "ok" for v in result["hook_shells"].values()),
                  result["hook_shells"])
            check("3 after setup nothing is stale", hooks.hooks_note("claude-code") == "")
            written = json.loads(path.read_text(encoding="utf-8"))["hooks"]["Stop"][-1]["hooks"][0]["command"]
            check("3 the new form is written", written == hooks._hook_command("Stop"), written)
        finally:
            hooks.claude_settings_path = saved


def test_real_run():
    if os.name != "nt":
        print("skip real run: Windows only")
        return
    probe = f"{hooks.hook_exe()} -c \"print('kh-ok')\""
    for shell in ("pwsh", "powershell"):
        exe = hooks.shutil.which(shell)
        if exe:
            done = subprocess.run([exe, "-NoProfile", "-NonInteractive", "-Command", probe],
                                  capture_output=True, text=True, timeout=60)
            check(f"4 {shell} runs the command", "kh-ok" in done.stdout, done.stderr.strip()[:200])
    bash = hooks._git_bash()
    if bash:
        done = subprocess.run([bash, "-c", probe], capture_output=True, text=True, timeout=60)
        check("4 Git Bash runs the command", "kh-ok" in done.stdout, done.stderr.strip()[:200])


if __name__ == "__main__":
    test_forms()
    test_setup_and_note()
    test_real_run()
    print("\nALL PASSED" if not FAILURES else f"\n{len(FAILURES)} FAILED: {FAILURES}")
    sys.exit(1 if FAILURES else 0)
