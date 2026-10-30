"""Stage the local docker test stack: KH (sign-in on, local stores) + the HANA-enabled Keycloak fork.

Copies what each image needs into deploy/docker/.stage (git-ignored), the way deploy/btp/push.ps1
stages KH for Cloud Foundry, and writes .stage/.env with the Keycloak database credentials read from
a Cloud Foundry service key. Then run:  docker compose -f deploy/docker/docker-compose.yml up -d --build

Usage (from Slaves/KnowledgeHub):
    python deploy/docker/stage.py --keycloak-repo C:/Workspaces/Keycloak \
        --service-key <keycloak-docker-hana key.json> --bootstrap-password-file <file>

--keycloak-repo           checkout of the Keycloak fork; needs quarkus/dist/target/keycloak-<ver>.zip
                          and kh/keycloak-kh-extension/target/keycloak-kh-extension-1.0.0.jar built.
--service-key             'cf service-key <hana schema instance> <key>' output (JSON); never copied
                          anywhere but .stage/.env.
--bootstrap-password-file temporary master admin password, used only on Keycloak's first start.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KH_ROOT = HERE.parent.parent
STAGE = HERE / ".stage"
MODEL = "bge-small-en-v1.5"
NGDBC_VERSION = "2.30.11"       # same pin as the Keycloak repo's deploy/btp/assemble.sh
NGDBC_URL = f"https://repo1.maven.org/maven2/com/sap/cloud/db/jdbc/ngdbc/{NGDBC_VERSION}/ngdbc-{NGDBC_VERSION}.jar"


def stage_kh(out: Path) -> None:
    out.mkdir(parents=True)
    for f in ("main.py", "preflight.py", "VERSION"):
        shutil.copy2(KH_ROOT / f, out / f)
    for d in ("app", "seeds"):
        shutil.copytree(KH_ROOT / d, out / d, ignore=shutil.ignore_patterns("__pycache__"))
    # The distil worker's job runs in-process for /home > Lesson learn > Learn back (app/learnback.py).
    shutil.copytree(KH_ROOT / "worker" / "kh_worker", out / "worker" / "kh_worker",
                    ignore=shutil.ignore_patterns("__pycache__", "tests"))
    shutil.copytree(KH_ROOT / "models" / MODEL, out / "models" / MODEL)
    subprocess.run([sys.executable, "-m", "pip", "wheel", str(KH_ROOT / "tools" / "kh-helper"), "--no-deps",
                    "--quiet", "-w", str(out / "downloads")], check=True)
    # Same rules as push.ps1: CPU-only torch, no system tray in a headless container.
    lines = ["--extra-index-url https://download.pytorch.org/whl/cpu"]
    for line in (KH_ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        if re.match(r"^\s*pystray", line):
            continue
        m = re.match(r"^\s*torch==([^\s#+]+)", line)
        lines.append(f"torch=={m.group(1)}+cpu" if m else line)
    (out / "requirements.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def stage_keycloak(repo: Path, out: Path) -> None:
    out.mkdir(parents=True)
    version = re.search(r"<version>(.*?)</version>", (repo / "pom.xml").read_text(encoding="utf-8")).group(1)
    dist = repo / "quarkus" / "dist" / "target" / f"keycloak-{version}.zip"
    ext = repo / "kh" / "keycloak-kh-extension" / "target" / "keycloak-kh-extension-1.0.0.jar"
    for f in (dist, ext):
        if not f.exists():
            raise SystemExit(f"missing {f} - build it in the Keycloak repo first")
    shutil.copy2(dist, out / "keycloak.zip")
    providers = out / "providers"
    providers.mkdir()
    shutil.copy2(ext, providers / ext.name)
    subprocess.run(["curl", "-fsSL", "-o", str(providers / f"ngdbc-{NGDBC_VERSION}.jar"), NGDBC_URL], check=True)
    # Fork modules rebuilt after the distribution zip: their jars replace the ones inside it.
    overrides = out / "lib-overrides"
    overrides.mkdir()
    for module, name in (("model/jpa", "keycloak-model-jpa"),):
        jar = repo / module / "target" / f"{name}-{version}.jar"
        if jar.exists() and jar.stat().st_mtime > dist.stat().st_mtime:
            shutil.copy2(jar, overrides / f"org.keycloak.{name}-{version}.jar")
    (out / "VERSION").write_text(version, encoding="ascii")


def write_env(service_key: Path, bootstrap_password_file: Path) -> None:
    key = json.loads(service_key.read_text(encoding="utf-8"))
    key = key.get("credentials", key)
    password = bootstrap_password_file.read_text(encoding="utf-8").strip()
    if len(password) < 12:
        raise SystemExit("bootstrap password must be at least 12 characters")
    env = {
        "KC_DB_URL": key["url"],
        "KC_DB_USERNAME": key["user"],
        "KC_DB_PASSWORD": key["password"],
        "KC_DB_SCHEMA": key["schema"],
        "KC_BOOTSTRAP_ADMIN_USERNAME": "tmp-bootstrap-admin",
        "KC_BOOTSTRAP_ADMIN_PASSWORD": password,
    }
    (STAGE / ".env").write_text("".join(f"{k}={v}\n" for k, v in env.items()), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keycloak-repo", required=True, type=Path)
    parser.add_argument("--service-key", required=True, type=Path)
    parser.add_argument("--bootstrap-password-file", required=True, type=Path)
    args = parser.parse_args()
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir()
    (STAGE / ".gitignore").write_text("*\n", encoding="ascii")
    stage_kh(STAGE / "kh")
    stage_keycloak(args.keycloak_repo, STAGE / "keycloak")
    write_env(args.service_key, args.bootstrap_password_file)
    print(f"staged {STAGE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
