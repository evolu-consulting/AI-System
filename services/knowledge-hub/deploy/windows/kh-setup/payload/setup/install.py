"""Install Knowledge Hub (KH) + its Keycloak sign-in on a Windows machine and seed the Prod kernel.

Started by install-kh.cmd with the bundled Python, so it works where PowerShell is locked down
(ConstrainedLanguage). Nothing is downloaded. Steps, each skipped when already done (run it again after a
failure):
  1. copy payload\\ to --install-dir
  2. PostgreSQL 17 cluster for Keycloak (Windows service "kh-postgres")
  3. Keycloak first start, realm 'knowledge-hub', accounts, tenant, KH access tables
  4. KH server settings (kh\\.env)
  5. start at boot: scheduled tasks "KH Keycloak" and "KH Server" (SYSTEM), started now, and the KH status tray
     at every sign-in (HKLM Run "KnowledgeHub Tray" = KnowledgeHub.exe --tray), since a SYSTEM task has no desktop
  6. the Prod kernel into KH: hook rules, action policy table, shared projects
Secrets go to <install dir>\\secrets (Administrators and SYSTEM only); none is printed.

--no-services runs everything as the current user without services or tasks (no administrator rights; for a
trial or a test). bin\\kh-start.cmd / uninstall-kh.cmd start and stop such an install.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PAYLOAD = Path(__file__).resolve().parent.parent
PY = Path(sys.executable)
CREATE_NO_WINDOW = 0x08000000
DETACHED = 0x00000008 | 0x00000200          # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def step(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def info(text: str) -> None:
    print(f"    {text}", flush=True)


def new_secret() -> str:
    # Letters and digits only, so the value is safe in SQL, .conf and JSON alike.
    return base64.b64encode(secrets.token_bytes(24)).decode().translate(str.maketrans("", "", "+/="))


def run(*args, check: bool = True, quiet: bool = False, **kw) -> subprocess.CompletedProcess:
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, **kw)
    if check and result.returncode != 0:
        raise SystemExit(f"{Path(str(args[0])).name} failed ({result.returncode}): {(result.stderr or result.stdout).strip()}")
    if not quiet and result.stdout.strip():
        print(result.stdout.rstrip(), flush=True)
    return result


def python(script: Path, *args) -> None:
    subprocess.run([str(PY), str(script), *map(str, args)], check=True)


def wait_http(url: str, seconds: int) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return
        except Exception:
            pass
        time.sleep(3)
    raise SystemExit(f"no answer from {url} after {seconds} s")


def is_admin() -> bool:
    return subprocess.run(["net", "session"], capture_output=True, creationflags=CREATE_NO_WINDOW).returncode == 0


def restrict(path: Path) -> None:
    """Administrators and SYSTEM only (plus the current user in --no-services mode, who runs the programs)."""
    grants = ["*S-1-5-32-544:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"] if path.is_dir() else ["*S-1-5-32-544:F", "*S-1-5-18:F"]
    if not ARGS.services:
        grants.append(f"{os.environ['USERDOMAIN']}\\{os.environ['USERNAME']}:" + ("(OI)(CI)F" if path.is_dir() else "F"))
    run("icacls", path, "/inheritance:r", *sum((["/grant:r", g] for g in grants), []), quiet=True)


def start_detached(cmd: Path, log: Path) -> None:
    """Starts a start-*.cmd in its own hidden console. Not DETACHED_PROCESS: without a console the
    'echo ... | findstr' pipes inside kc.bat hang and Keycloak never starts (2026-10-16)."""
    hidden = subprocess.STARTUPINFO()
    hidden.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    hidden.wShowWindow = 0      # SW_HIDE
    with open(log, "ab") as out:
        subprocess.Popen(["cmd.exe", "/c", str(cmd)], stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
                         startupinfo=hidden, close_fds=True)


def stop_processes_under(folder: Path, names: tuple[str, ...]) -> None:
    """Stops the programs of this install (java.exe of its Keycloak, KnowledgeHub.exe) by their path."""
    # Get-CimInstance is a plain cmdlet, so this works in ConstrainedLanguage too (wmic is gone from new Windows).
    for name in names:
        result = run("powershell", "-NoProfile", "-Command",
                     f"Get-CimInstance Win32_Process -Filter \"Name='{name}'\" | "
                     "ForEach-Object { [string]$_.ProcessId + '|' + $_.CommandLine }", check=False, quiet=True)
        for line in result.stdout.splitlines():
            pid, _, command = line.partition("|")
            if str(folder).lower() in command.lower() and pid.strip().isdigit():
                run("taskkill", "/F", "/T", "/PID", pid.strip(), check=False, quiet=True)


TASK_XML = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>{description}</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>5</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c "{command}"</Arguments>
    <WorkingDirectory>{workdir}</WorkingDirectory></Exec></Actions>
</Task>
"""


def register_task(name: str, command: Path, description: str, root: Path) -> None:
    xml = root / "logs" / f"{name.replace(' ', '-')}.task.xml"
    xml.write_text(TASK_XML.format(description=description, command=command, workdir=root), encoding="utf-16")
    run("schtasks", "/Create", "/TN", name, "/XML", xml, "/F", quiet=True)
    xml.unlink()


TRAY_RUN_KEY = r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
TRAY_VALUE = "KnowledgeHub Tray"


def register_tray(exe: Path, port: int) -> None:
    """The KH status tray for everyone who signs in here (a SYSTEM task shows no tray), and started now."""
    run("reg", "add", TRAY_RUN_KEY, "/v", TRAY_VALUE, "/t", "REG_SZ", "/d", f'"{exe}" --tray --port {port}', "/f",
        quiet=True)
    subprocess.Popen([str(exe), "--tray", "--port", str(port)], creationflags=DETACHED, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    info(f"status tray registered ('{TRAY_VALUE}' at sign-in) and started")


def main() -> int:
    global ARGS
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--admin-email", required=True, help="the first maintainer (you)")
    parser.add_argument("--admin-first", default="KH")
    parser.add_argument("--admin-last", default="Admin")
    parser.add_argument("--tenant", default="", help="company name (default: from the e-mail domain)")
    parser.add_argument("--tenant-domain", default="", help="e-mail domain of the tenant (default: the admin's)")
    parser.add_argument("--install-dir", default=r"C:\KH", type=Path)
    parser.add_argument("--public-host", default="localhost",
                        help="name other machines use to reach this one; 'localhost' = this machine only")
    parser.add_argument("--pg-port", type=int, default=5433)
    parser.add_argument("--keycloak-port", type=int, default=8180)
    parser.add_argument("--keycloak-management-port", type=int, default=9180)
    parser.add_argument("--kh-port", type=int, default=9000)
    parser.add_argument("--no-services", dest="services", action="store_false",
                        help="run as the current user, without the Windows service and scheduled tasks")
    ARGS = args = parser.parse_args()

    if args.services and not is_admin():
        raise SystemExit("Run install-kh.cmd from an elevated prompt (Run as administrator), or add --no-services.")
    email = args.admin_email.strip().lower()
    tenant_domain = args.tenant_domain or email.split("@")[1]
    tenant = args.tenant or tenant_domain.split(".")[0]
    root = args.install_dir.resolve()
    keycloak_url = f"http://{args.public_host}:{args.keycloak_port}"
    kh_url = f"http://{args.public_host}:{args.kh_port}"
    mgmt = f"http://localhost:{args.keycloak_management_port}"

    # -- 1. files ---------------------------------------------------------------------------------
    step(f"1/6 Copy files to {root}")
    root.mkdir(parents=True, exist_ok=True)
    if root != PAYLOAD:
        stop_processes_under(root, ("java.exe", "KnowledgeHub.exe"))
        rc = subprocess.run(["robocopy", str(PAYLOAD), str(root), "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
                             "/XD", "pgdata", "secrets", "logs", "__pycache__", "/XF", ".env", "keycloak.conf"],
                            creationflags=CREATE_NO_WINDOW).returncode
        if rc >= 8:
            raise SystemExit(f"robocopy failed ({rc})")
        conf = root / "keycloak" / "conf" / "keycloak.conf"
        if not conf.exists():
            shutil.copy2(PAYLOAD / "keycloak" / "conf" / "keycloak.conf", conf)
    sec = root / "secrets"
    if not sec.exists():
        sec.mkdir()
        restrict(sec)
    (root / "logs").mkdir(exist_ok=True)
    pg_bin = root / "pgsql" / "bin"
    psql = pg_bin / "psql.exe"
    py = root / "python" / "python.exe"
    setup = root / "setup"
    info("done")

    # -- 2. PostgreSQL ----------------------------------------------------------------------------
    step(f"2/6 PostgreSQL (port {args.pg_port})")
    pg_data = root / "pgdata"
    super_file = sec / "postgres-superuser.txt"
    db_file = sec / "keycloak-db.json"
    if not (pg_data / "PG_VERSION").exists():
        super_file.write_text(new_secret(), encoding="ascii")
        # initdb.exe re-runs itself with a restricted token that drops the Administrators group, so in services
        # mode it could not read the password file in secrets\ (Permission denied, 2026-10-20). The running user
        # may read that one file while initdb runs, and only then.
        me = f"{os.environ['USERDOMAIN']}\\{os.environ['USERNAME']}"
        if args.services:
            run("icacls", super_file, "/grant", f"{me}:R", quiet=True)
        try:
            run(pg_bin / "initdb.exe", "-D", pg_data, "-U", "postgres", f"--pwfile={super_file}", "-E", "UTF8",
                "--locale=C", "-A", "scram-sha-256", quiet=True)
        finally:
            if args.services:
                run("icacls", super_file, "/remove:g", me, check=False, quiet=True)
        with open(pg_data / "postgresql.conf", "a", encoding="utf-8") as f:
            f.write(f"\nport = {args.pg_port}\nlisten_addresses = 'localhost'\n")
        if args.services:   # the service runs as NETWORK SERVICE, which must own its data folder
            run("icacls", pg_data, "/grant", "*S-1-5-20:(OI)(CI)F", "/T", quiet=True)
        info("cluster created")
    if args.services:
        if run("sc", "query", "kh-postgres", check=False, quiet=True).returncode != 0:
            run(pg_bin / "pg_ctl.exe", "register", "-N", "kh-postgres", "-D", pg_data, "-S", "auto",
                "-U", r"NT AUTHORITY\NetworkService", quiet=True)
        run("net", "start", "kh-postgres", check=False, quiet=True)
    elif run(pg_bin / "pg_ctl.exe", "status", "-D", pg_data, check=False, quiet=True).returncode != 0:
        subprocess.Popen([str(pg_bin / "pg_ctl.exe"), "start", "-D", str(pg_data), "-l", str(root / "logs" / "postgres.log")],
                         creationflags=DETACHED | CREATE_NO_WINDOW, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env = dict(os.environ, PGPASSWORD=super_file.read_text(encoding="ascii").strip())
    for _ in range(60):
        if run(pg_bin / "pg_isready.exe", "-h", "127.0.0.1", "-p", args.pg_port, check=False, quiet=True).returncode == 0:
            break
        time.sleep(1)
    else:
        raise SystemExit(f"PostgreSQL does not answer on port {args.pg_port}")
    if not db_file.exists():
        db_password = new_secret()
        for sql in (f"CREATE ROLE keycloak LOGIN PASSWORD '{db_password}'",
                    "CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8'"):
            run(psql, "-X", "-q", "-h", "127.0.0.1", "-p", args.pg_port, "-U", "postgres", "-d", "postgres",
                "-c", sql, env=env, quiet=True)
        db_file.write_text(json.dumps({"host": "127.0.0.1", "port": args.pg_port, "database": "keycloak",
                                       "user": "keycloak", "password": db_password, "schema": "public"}, indent=2),
                           encoding="ascii")
        info("database keycloak created")
    db = json.loads(db_file.read_text(encoding="ascii"))

    # -- 3. Keycloak ------------------------------------------------------------------------------
    step(f"3/6 Keycloak ({keycloak_url})")
    conf = root / "keycloak" / "conf" / "keycloak.conf"
    logdir = str(root / "logs").replace("\\", "/")
    conf.write_text(
        "# Written by install.py. Build-time options (db=postgres, health, cache=local) are baked into the package.\n"
        f"db=postgres\ndb-url=jdbc:postgresql://127.0.0.1:{args.pg_port}/keycloak\n"
        f"db-username=keycloak\ndb-password={db['password']}\n"
        f"http-enabled=true\nhttp-port={args.keycloak_port}\nhttp-management-port={args.keycloak_management_port}\n"
        f"hostname={keycloak_url}\nlog=console,file\nlog-file={logdir}/keycloak-server.log\n", encoding="ascii")
    restrict(conf)
    start_kc = root / "bin" / "start-keycloak.cmd"
    start_kh = root / "bin" / "start-kh.cmd"
    client_secret = sec / "keycloak-admin-client.txt"
    if not client_secret.exists():
        # First start: Keycloak creates its schema and a temporary bootstrap admin, which local_setup.py deletes.
        boot = sec / "bootstrap-admin.txt"
        boot.write_text(new_secret(), encoding="ascii")
        os.environ.update(KC_BOOTSTRAP_ADMIN_USERNAME="tmp-bootstrap-admin",
                          KC_BOOTSTRAP_ADMIN_PASSWORD=boot.read_text(encoding="ascii"))
        start_detached(start_kc, root / "logs" / "keycloak-first-start.log")
        del os.environ["KC_BOOTSTRAP_ADMIN_USERNAME"], os.environ["KC_BOOTSTRAP_ADMIN_PASSWORD"]
        info("first start (creates the database schema, 1-3 minutes)")
        wait_http(f"{mgmt}/health/ready", 600)
        python(setup / "local_setup.py", "--url", f"http://localhost:{args.keycloak_port}",
               "--bootstrap-password-file", boot, "--secrets-dir", sec, "--db-file", db_file, "--psql", psql,
               "--admin-email", email, "--admin-first", args.admin_first, "--admin-last", args.admin_last,
               "--tenant", tenant, "--tenant-domain", tenant_domain)
        boot.unlink()
        if args.services:   # the scheduled task runs it from now on
            stop_processes_under(root / "keycloak", ("java.exe",))
    else:
        info("already set up (secrets\\keycloak-admin-client.txt exists)")

    # -- 4. KH settings ---------------------------------------------------------------------------
    step(f"4/6 KH settings ({kh_url})")
    bind = "127.0.0.1" if args.public_host == "localhost" else "0.0.0.0"
    (root / "kh" / ".env").write_text(
        "# Written by install.py. KH keeps everything in local files beside the exe (SQLite, Chroma, Kuzu).\n"
        "# No KH_NO_TRAY: KH sees by itself that the SYSTEM task has no desktop (app/desktop.py).\n"
        f"KH_HOST={bind}\nKH_PORT={args.kh_port}\nKH_DB_BACKEND=local\nGRAPH_BACKEND=kuzu\n"
        f"KH_AUTH_ISSUER={keycloak_url}/realms/knowledge-hub\n"
        "KH_PRELOAD_VISION=false\nHF_HUB_OFFLINE=1\nTRANSFORMERS_OFFLINE=1\n", encoding="ascii")
    info("kh\\.env written")

    # -- 5. start ---------------------------------------------------------------------------------
    if args.services:
        step("5/6 Start at boot (scheduled tasks, SYSTEM)")
        register_task("KH Keycloak", start_kc, "Keycloak for Knowledge Hub sign-in", root)
        register_task("KH Server", start_kh, "Knowledge Hub server", root)
        run("schtasks", "/Run", "/TN", "KH Keycloak", quiet=True)
    else:
        step("5/6 Start (current user, no services)")
        try:
            urllib.request.urlopen(f"{mgmt}/health/ready", timeout=5)
        except Exception:
            start_detached(start_kc, root / "logs" / "keycloak-run.log")
    wait_http(f"{mgmt}/health/ready", 300)
    info("Keycloak ready")
    if args.services:
        run("schtasks", "/Run", "/TN", "KH Server", quiet=True)
    else:
        try:
            urllib.request.urlopen(f"http://localhost:{args.kh_port}/health", timeout=5)
        except Exception:
            start_detached(start_kh, root / "logs" / "kh-run.log")
    info("KH starting (loads the embedding model, up to a few minutes)")
    wait_http(f"http://localhost:{args.kh_port}/health", 900)
    info("KH ready")
    if args.services:
        register_tray(root / "kh" / "KnowledgeHub.exe", args.kh_port)
    if args.services and args.public_host != "localhost":
        for port in (args.keycloak_port, args.kh_port):
            run("netsh", "advfirewall", "firewall", "delete", "rule", f"name=KH port {port}", check=False, quiet=True)
            run("netsh", "advfirewall", "firewall", "add", "rule", f"name=KH port {port}", "dir=in", "action=allow",
                "protocol=TCP", f"localport={port}", quiet=True)
        info(f"firewall open for {args.keycloak_port} and {args.kh_port}")

    # -- 6. Prod kernel ---------------------------------------------------------------------------
    step("6/6 Seed the Prod kernel into KH")
    python(setup / "seed_kh.py", "--keycloak", f"http://localhost:{args.keycloak_port}",
           "--kh", f"http://localhost:{args.kh_port}", "--secrets-dir", sec, "--seed-dir", root / "seed")
    # Again now that the shared projects exist: lesson-learned gets its default level (readonly for everyone).
    python(setup / "deploy" / "kh-auth" / "seed_postgres.py", "--db-file", db_file, "--psql", psql, "--maintainer", email)

    print("\nKnowledge Hub is installed.", flush=True)
    info(f"KH:              {kh_url}   (Swagger: {kh_url}/docs)")
    info(f"Keycloak admin:  {keycloak_url}/admin/   sign in as {email}")
    info(f"One-time password: {sec / 'kh-accounts.json'} -> accounts.admin.one_time_password")
    info(f"Connect Claude Code: {root / 'kh-helper' / 'CLAUDE_CONNECT.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
