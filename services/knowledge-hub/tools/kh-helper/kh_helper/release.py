"""Where the newest helper is published, and upgrading this copy to it (1.17.0, fen 2026-10-20).

The helper is released apart from KH, the way App Session Manager is: a zip (the wheel plus install.ps1 and
install.sh) on a public link, e.g. Google Drive, and one row in KH that names it - project orchestrator, scope
versions, id ver_kh-helper, metadata ``version`` and ``download_url`` (``sha256`` optional). A release is: build
the zip (tools/kh-helper/build_release.py), upload it, overwrite that row. Nothing in KH is redeployed.

``latest`` reads that row, and falls back to KH's own /auth/config (the artifact store or the bundled wheel) for a
row without a link. ``upgrade`` downloads the zip, checks it, installs the wheel inside into this copy's Python
and connects the CLI again.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import requests

VERSIONS_ROW = "ver_kh-helper"
TIMEOUT = 120
_DRIVE_ID = re.compile(r"(?:/file/d/|[?&]id=)([A-Za-z0-9_-]{20,})")


def _version_key(version: str) -> tuple:
    return tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[.+-]", version or "0"))


def newer(published: str, installed: str) -> bool:
    return _version_key(published) > _version_key(installed)


def installed_version() -> str:
    from importlib.metadata import version
    return version("kh-helper")


def latest(session) -> dict | None:
    """{version, url, sha256, source} of the newest published helper, or None when KH names none."""
    status, body = session.call("POST", "/vector/scroll", {"scope": "versions", "project": "orchestrator",
                                                            "ids": [VERSIONS_ROW]})
    hits = body.get("hits") if status < 300 and isinstance(body, dict) else None
    meta = (hits[0].get("metadata") or {}) if hits else {}
    if meta.get("version") and meta.get("download_url"):
        return {"version": str(meta["version"]), "url": str(meta["download_url"]),
                "sha256": str(meta.get("sha256") or "") or None, "source": "versions"}
    status, body = session.call("GET", "/auth/config")
    if status < 300 and isinstance(body, dict) and body.get("helper_version") and body.get("helper"):
        return {"version": str(body["helper_version"]), "url": str(body["helper"]), "sha256": None, "source": "kh"}
    return None


def direct_url(url: str) -> str:
    """A Google Drive share link turned into its download link; any other URL as it is."""
    if "drive.google.com" in url or "drive.usercontent.google.com" in url:
        found = _DRIVE_ID.search(url)
        if found:
            return f"https://drive.usercontent.google.com/download?id={found.group(1)}&export=download&confirm=t"
    return url


def fetch(url: str, folder: Path) -> Path:
    """Download the release (a zip or a bare wheel) into ``folder``; ValueError when it is neither."""
    resp = requests.get(direct_url(url), timeout=TIMEOUT, allow_redirects=True)
    resp.raise_for_status()
    data = resp.content
    if data[:2] != b"PK":                           # Drive answers an HTML page for a link that is not public
        raise ValueError("the download is not a zip or wheel; is the link public?")
    name = "release.whl" if url.split("?")[0].endswith(".whl") else "release.zip"
    path = folder / name
    path.write_bytes(data)
    return path


def wheel_in(path: Path, folder: Path) -> Path:
    """The kh-helper wheel of a downloaded release: the file itself, or the one inside the zip."""
    if path.suffix == ".whl":
        target = folder / "kh_helper-0-py3-none-any.whl"        # pip needs a wheel file name
        path.rename(target)
        return target
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if re.search(r"(^|/)kh_helper-[^/]+\.whl$", n)]
        if len(names) != 1:
            raise ValueError("the zip must hold exactly one kh_helper wheel")
        out = folder / Path(names[0]).name
        out.write_bytes(z.read(names[0]))
        return out


def upgrade(session, source: str | None = None, force: bool = False) -> dict:
    """Install the newest published helper (or ``source``: a URL, zip or wheel path) into this Python."""
    current = installed_version()
    found = None if source else latest(session)
    if not source and not found:
        return {"upgraded": False, "installed": current, "reason": "KH names no published helper"}
    if found and not force and not newer(found["version"], current):
        return {"upgraded": False, "installed": current, "published": found["version"], "reason": "up to date"}
    with tempfile.TemporaryDirectory(prefix="kh-helper-") as tmp:
        folder = Path(tmp)
        where = source or found["url"]
        if Path(where).exists():
            path = folder / Path(where).name
            path.write_bytes(Path(where).read_bytes())
        else:
            path = fetch(where, folder)
        if found and found.get("sha256"):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != found["sha256"].lower():
                raise ValueError(f"sha256 mismatch: got {digest[:12]}, KH names {found['sha256'][:12]}")
        wheel = wheel_in(path, folder)
        done = subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "--quiet", str(wheel)],
                              capture_output=True, text=True)
        if done.returncode != 0:
            raise RuntimeError("pip install failed: " + (done.stderr or done.stdout).strip()[-500:])
    # The new code connects the CLI (hooks, MCP): run it in a fresh process, not this one's old modules.
    setup = subprocess.run([sys.executable, "-m", "kh_helper.cli", "setup"], capture_output=True, text=True)
    return {"upgraded": True, "from": current, "to": installed_version_fresh(),
            "setup": "ok" if setup.returncode == 0 else (setup.stderr or setup.stdout).strip()[-300:],
            "next": "restart this app so the new version loads"}


def installed_version_fresh() -> str:
    done = subprocess.run([sys.executable, "-c", "from importlib.metadata import version; print(version('kh-helper'))"],
                          capture_output=True, text=True)
    return done.stdout.strip() or "?"
