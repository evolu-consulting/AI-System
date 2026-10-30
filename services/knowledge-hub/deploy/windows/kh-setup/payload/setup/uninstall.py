"""Remove a KH install made by install.py: scheduled tasks, the kh-postgres service, the status tray at sign-in,
firewall rules, running programs. Data stays in --install-dir unless --delete-data is given.

Usage: <install dir>\\uninstall-kh.cmd [--delete-data]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from install import TRAY_RUN_KEY, TRAY_VALUE, run, stop_processes_under  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def points_here(text: str) -> bool:
    """True when a task XML, service config or registry value names a path inside ROOT."""
    return str(ROOT).lower().rstrip("\\") + "\\" in (text or "").lower().replace("/", "\\")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delete-data", action="store_true")
    args = parser.parse_args()
    # Tasks, service and tray value carry fixed names, so another KH install on this machine (a --no-services
    # trial next to a services install) has the same ones: only those pointing into ROOT are removed (2026-10-20).
    owned = False
    for task in ("KH Server", "KH Keycloak"):
        found = run("schtasks", "/Query", "/TN", task, "/XML", check=False, quiet=True)
        if found.returncode == 0 and points_here(found.stdout):
            run("schtasks", "/End", "/TN", task, check=False, quiet=True)
            run("schtasks", "/Delete", "/TN", task, "/F", quiet=True)
            print(f"removed task {task}")
            owned = True
        elif found.returncode == 0:
            print(f"kept task {task}: it belongs to another KH install")
    found = run("reg", "query", TRAY_RUN_KEY, "/v", TRAY_VALUE, check=False, quiet=True)
    if found.returncode == 0 and points_here(found.stdout):
        run("reg", "delete", TRAY_RUN_KEY, "/v", TRAY_VALUE, "/f", check=False, quiet=True)
        print(f"removed {TRAY_VALUE} from sign-in")
    stop_processes_under(ROOT, ("java.exe", "KnowledgeHub.exe"))      # the status tray too (same exe)
    pg_ctl = ROOT / "pgsql" / "bin" / "pg_ctl.exe"
    found = run("sc", "qc", "kh-postgres", check=False, quiet=True)
    if found.returncode == 0 and points_here(found.stdout):
        run("net", "stop", "kh-postgres", check=False, quiet=True)
        run(pg_ctl, "unregister", "-N", "kh-postgres", check=False, quiet=True)
        print("removed service kh-postgres")
    elif (ROOT / "pgdata").exists():
        run(pg_ctl, "stop", "-D", ROOT / "pgdata", "-m", "fast", check=False, quiet=True)
    if owned:                       # the firewall rules are named by port only; a services install made them
        for port in ("8180", "9000"):
            run("netsh", "advfirewall", "firewall", "delete", "rule", f"name=KH port {port}", check=False, quiet=True)
    if args.delete_data:
        # The running Python lives inside ROOT, so the folder is removed by a detached cmd after this exits.
        # ping, not timeout: timeout needs a console, which a detached cmd does not have.
        subprocess.Popen(["cmd.exe", "/c", f'ping -n 4 127.0.0.1 >nul & rmdir /s /q "{ROOT}"'], creationflags=0x00000008)
        print(f"deleting {ROOT}")
    else:
        print(f"data kept in {ROOT} (run again with --delete-data to remove it)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
