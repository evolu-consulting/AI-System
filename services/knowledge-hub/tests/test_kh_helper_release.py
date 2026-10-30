"""Tests for kh-helper releases apart from KH (kh_helper/release.py, 1.17.0, 2026-10-20).

WHAT IS UNDER TEST

  1. WHERE THE RELEASE IS. The versions row ver_kh-helper (version + download_url, e.g. a public Drive zip)
     wins; without a link KH's /auth/config (artifact store or bundled wheel) is used.
  2. DRIVE LINKS. A share link becomes the download link; an HTML answer (a link that is not public) is refused.
  3. THE ZIP. Exactly one kh_helper wheel inside is taken; a sha256 named in the row is checked.

Run from the repo root with the project venv:
    .venv\Scripts\python tests\test_kh_helper_release.py
"""
import io
import os
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "kh-helper"))
os.environ["KH_HELPER_HOME"] = tempfile.mkdtemp(prefix="kh_release_home_")

from kh_helper import release  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class KH:
    def __init__(self, row=None, config=None):
        self.row, self.config = row, config

    def call(self, method, path, body=None, params=None):
        if path == "/vector/scroll":
            ok = body == {"scope": "versions", "project": "orchestrator", "ids": ["ver_kh-helper"]}
            return (200, {"hits": [{"metadata": self.row}] if self.row else []}) if ok else (400, {})
        return (200, self.config) if self.config else (404, {})


# ── 1. where ──
row = {"version": "1.17.0", "download_url": "https://drive.google.com/file/d/ABCDEFGHIJKLMNOPQRSTUV/view?usp=sharing",
       "sha256": "AB"}
check("the versions row is the release", release.latest(KH(row, {"helper_version": "9", "helper": "u"}))
      == {"version": "1.17.0", "url": row["download_url"], "sha256": "AB", "source": "versions"})
check("a row without a link falls back to /auth/config",
      release.latest(KH({"version": "1.17.0"}, {"helper_version": "1.16.1", "helper": "https://kh/w.whl"}))["source"] == "kh")
check("nothing published gives None", release.latest(KH()) is None)
check("newer compares numerically", release.newer("1.17.0", "1.9.9") and not release.newer("1.16.1", "1.16.1"))

# ── 2. drive ──
check("a Drive share link becomes its download link", release.direct_url(row["download_url"]) ==
      "https://drive.usercontent.google.com/download?id=ABCDEFGHIJKLMNOPQRSTUV&export=download&confirm=t")
check("an open?id= link too", "id=ABCDEFGHIJKLMNOPQRSTUV" in
      release.direct_url("https://drive.google.com/open?id=ABCDEFGHIJKLMNOPQRSTUV"))
check("another URL is left alone", release.direct_url("https://x.test/a.zip") == "https://x.test/a.zip")


class Resp:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        pass


tmp = Path(tempfile.mkdtemp(prefix="kh_release_"))
release.requests.get = lambda *a, **k: Resp(b"<html>sign in</html>")
try:
    release.fetch("https://drive.google.com/file/d/ABCDEFGHIJKLMNOPQRSTUV/view", tmp)
    check("an HTML answer is refused", False)
except ValueError as e:
    check("an HTML answer is refused", "public" in str(e), e)

# ── 3. the zip ──
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    z.writestr("kh-helper-1.17.0/kh_helper-1.17.0-py3-none-any.whl", b"PKwheel")
    z.writestr("kh-helper-1.17.0/install.ps1", "x")
(tmp / "r.zip").write_bytes(buf.getvalue())
w = release.wheel_in(tmp / "r.zip", tmp)
check("the wheel inside the zip is taken", w.name == "kh_helper-1.17.0-py3-none-any.whl" and w.read_bytes() == b"PKwheel")
buf2 = io.BytesIO()
with zipfile.ZipFile(buf2, "w") as z:
    z.writestr("a/install.ps1", "x")
(tmp / "bad.zip").write_bytes(buf2.getvalue())
try:
    release.wheel_in(tmp / "bad.zip", tmp)
    check("a zip without a wheel is refused", False)
except ValueError:
    check("a zip without a wheel is refused", True)

release.requests.get = lambda *a, **k: Resp(buf.getvalue())
release.installed_version = lambda: "1.16.1"
try:
    release.upgrade(KH({**row, "sha256": "00" * 32}))
    check("a sha256 mismatch stops the upgrade", False)
except ValueError as e:
    check("a sha256 mismatch stops the upgrade", "sha256" in str(e), e)
check("an up-to-date copy is left alone",
      release.upgrade(KH({**row, "version": "1.16.1"}))["reason"] == "up to date")

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
