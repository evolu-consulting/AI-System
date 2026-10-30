"""Build a kh-helper release apart from KH (1.17.0, fen 2026-10-20).

    python tools/kh-helper/build_release.py --out <folder>

Writes <out>/kh-helper-<version>/ (the wheel, install.ps1, install.sh, README.txt), <out>/kh-helper-<version>.zip
and <out>/release.json (version, zip name, sha256). The zip also carries release.json at its root (1.17.1), so the
assistant installing it reads the version and wheel sha256 there; that copy has no zip sha256, which a file
cannot hold of the archive it sits in, so take the KH row's sha256 from <out>/release.json. Publishing: upload the zip to a public link (e.g. Google
Drive, anyone with the link), then overwrite KH row ver_kh-helper (project orchestrator, scope versions) with
metadata version, download_url and sha256 of the zip. Every helper then offers the upgrade; KH is not redeployed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    version = tomllib.loads((HERE / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    name = f"kh-helper-{version}"
    folder = args.out / name
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    # A clean build: no build/ or egg-info left over from an editable install leaks old files into the wheel.
    for stale in ("build", "kh_helper.egg-info"):
        shutil.rmtree(HERE / stale, ignore_errors=True)
    subprocess.run([sys.executable, "-m", "pip", "wheel", str(HERE), "--no-deps", "--quiet", "-w", str(folder)],
                   check=True)
    wheel = next(folder.glob("kh_helper-*.whl"))
    wheel_sha = hashlib.sha256(wheel.read_bytes()).hexdigest()
    for item in ("install.ps1", "install.sh"):
        shutil.copy(HERE / "release" / item, folder / item)
    readme = (HERE / "release" / "README.txt").read_text(encoding="utf-8")
    (folder / "README.txt").write_text(readme.format(version=version, wheel_sha256=wheel_sha), encoding="utf-8")
    archive = args.out / f"{name}.zip"
    archive.unlink(missing_ok=True)
    inner = {"module": "kh-helper", "version": version, "zip": archive.name,
             "wheel": wheel.name, "wheel_sha256": wheel_sha}
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):
            z.write(f, f"{name}/{f.name}")
        z.writestr("release.json", json.dumps(inner, indent=2))
    zip_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    info = {**inner, "sha256": zip_sha}
    (args.out / "release.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps(info, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
