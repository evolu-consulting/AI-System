"""Download sources: where /auth/download takes each module from is data, not code (fen 2026-10-24).

One row per module (kh-helper first) in kh_download_source, set by a maintainer with PUT /downloads/{module}:

  type local   path is a file on the app's own host, relative to the app folder (e.g. downloads/kh_helper-1.18.0-
               py3-none-any.whl). GET /auth/download/<module or file name> streams that file.
  type https   path is a public https link (e.g. the Google Drive share link of the release zip).
               GET /auth/download/<module> answers JSON: the link, a direct-download form of it, version, sha256 and
               plain download-and-install steps an assistant follows.

Without a row nothing changes: /auth/download serves an uploaded artifact or the wheel the deploy bundled, as
before (app/artifacts.py). A local path may not leave the app folder, and the route never lists a directory.
"""
from __future__ import annotations

import logging
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from app import sqldb

logger = logging.getLogger(__name__)

TABLE = "kh_download_source"
LOCAL, HTTPS = "local", "https"
TYPES = (LOCAL, HTTPS)
APP_ROOT = Path(__file__).resolve().parent.parent
MODULE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,199}$")

_LOCK = threading.Lock()
_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _m1(c) -> None:
    sqldb.create_table(
        c, TABLE,
        f"""CREATE TABLE IF NOT EXISTS {TABLE} (
                module     TEXT PRIMARY KEY,
                type       TEXT NOT NULL,
                path       TEXT NOT NULL,
                version    TEXT,
                sha256     TEXT,
                file_name  TEXT,
                notes      TEXT,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL)""",
        f"""CREATE COLUMN TABLE {TABLE} (
                module     NVARCHAR(64)   PRIMARY KEY,
                type       NVARCHAR(16)   NOT NULL,
                path       NVARCHAR(2000) NOT NULL,
                version    NVARCHAR(64),
                sha256     NVARCHAR(64),
                file_name  NVARCHAR(200),
                notes      NVARCHAR(2000),
                updated_at NVARCHAR(32)   NOT NULL,
                updated_by NVARCHAR(256)  NOT NULL)""")


def init() -> None:
    global _ready
    with _LOCK, sqldb.connect() as c:
        sqldb.migrate(c, "download_source", [(1, _m1)])
    _ready = True


_KEYS = ("module", "type", "path", "version", "sha256", "file_name", "notes", "updated_at", "updated_by")


def sources() -> list[dict]:
    if not _ready:
        return []
    with sqldb.connect() as c:
        rows = c.execute(f"SELECT {', '.join(_KEYS)} FROM {TABLE} ORDER BY module").fetchall()
    return [dict(zip(_KEYS, tuple(r))) for r in rows]


def find(name: str) -> dict | None:
    """The source a request names: by module, or by the file name a local source serves."""
    for row in sources():
        if name == row["module"] or (row["file_name"] and name == row["file_name"]):
            return row
    return None


def local_file(row: dict) -> Path:
    """The file of a local source; ValueError when the path leaves the app folder or is not a file."""
    path = (APP_ROOT / row["path"]).resolve()
    if APP_ROOT != path and APP_ROOT not in path.parents:
        raise ValueError("path must stay inside the app folder")
    if not path.is_file():
        raise ValueError(f"no file at {row['path']}")
    return path


def set_source(module: str, body: dict, by: str) -> dict:
    module = (module or "").strip().lower()
    if not MODULE.match(module):
        raise ValueError("module: lower-case letters, digits, . _ - only")
    kind = str(body.get("type") or "").strip().lower()
    if kind not in TYPES:
        raise ValueError(f"type must be one of {', '.join(TYPES)}")
    path = str(body.get("path") or "").strip()
    if not path:
        raise ValueError("path is required")
    sha = str(body.get("sha256") or "").strip().lower() or None
    if sha and not SHA.match(sha):
        raise ValueError("sha256 must be 64 hex characters")
    file_name = str(body.get("file_name") or "").strip() or None
    if kind == HTTPS:
        if not path.lower().startswith("https://"):
            raise ValueError("an https source needs an https:// link")
    else:
        if "://" in path or path.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", path):
            raise ValueError("a local path is relative to the app folder, e.g. downloads/<file>")
        row = {"path": path}
        local_file(row)                               # refuse a path that does not resolve to a file in the app
        file_name = file_name or Path(path).name
    if file_name and not FILE_NAME.match(file_name):
        raise ValueError("file_name: letters, digits, . _ + - only")
    row = {"module": module, "type": kind, "path": path, "version": str(body.get("version") or "").strip() or None,
           "sha256": sha, "file_name": file_name, "notes": str(body.get("notes") or "").strip()[:2000] or None,
           "updated_at": _now(), "updated_by": by}
    with sqldb.connect() as c:
        sqldb.upsert(c, TABLE, ["module"], row)
    return row


def delete_source(module: str) -> bool:
    with sqldb.connect() as c:
        return bool(sqldb.update(c, f"DELETE FROM {TABLE} WHERE module=?", [module]))


def direct_url(url: str) -> str:
    """A download link a plain GET can fetch: a Google Drive share link becomes its direct-download form."""
    if "drive.google.com" in url or "drive.usercontent.google.com" in url:
        found = re.search(r"/d/([A-Za-z0-9_-]{10,})", url) or re.search(r"[?&]id=([A-Za-z0-9_-]{10,})", url)
        if found:
            return f"https://drive.usercontent.google.com/download?id={found.group(1)}&export=download&confirm=t"
    return url


def steps(row: dict, kh_url: str) -> list[str]:
    """Plain download-and-install steps for an assistant (kh-helper: the release zip of build_release.py)."""
    link = direct_url(row["path"])
    name = row["file_name"] or (f"{row['module']}-{row['version']}.zip" if row["version"] else f"{row['module']}.zip")
    out = [f"Download the file with a plain GET that follows redirects, never a page summariser: "
           f"curl -L -o \"{name}\" \"{link}\"   (PowerShell: Invoke-WebRequest -Uri \"{link}\" -OutFile \"{name}\").",
           "Check it: a zip starts with the two bytes PK; an HTML page means the link is not public any more."]
    if row["sha256"]:
        out.append(f"Check its sha256 is {row['sha256']} (sha256sum, or Get-FileHash -Algorithm SHA256). "
                   "A different value: stop and tell the person.")
    if row["module"] == "kh-helper":
        out += ["Unzip it. Already have the helper in YOUR CLI's profile (PROFILE/kh-helper): run  \"KH\" -m pip "
                "install --upgrade \"<unzipped folder>/kh_helper-<version>-py3-none-any.whl\"  then  \"KH\" -m "
                "kh_helper.cli setup , check every value of its hook_shells is ok, and restart the CLI.",
                "New install: follow " + kh_url.rstrip("/") + "/auth/help ; in its step 1 install that same wheel "
                "file instead of a URL. Or run the zip's installer: Windows  powershell -ExecutionPolicy Bypass "
                "-File install.ps1 ; macOS/Linux  bash install.sh  (it installs into PROFILE/kh-helper, signs in "
                "if needed and runs setup)."]
    if row["notes"]:
        out.append(row["notes"])
    return out


def answer(row: dict, kh_url: str) -> dict:
    """The JSON an https source answers with."""
    return {"module": row["module"], "type": HTTPS, "version": row["version"], "url": row["path"],
            "direct_url": direct_url(row["path"]), "sha256": row["sha256"], "file_name": row["file_name"],
            "steps": steps(row, kh_url), "updated_at": row["updated_at"]}


def attach(app) -> None:
    from fastapi import HTTPException

    from app import auth

    init()
    TAG = ["Downloads"]

    def _by() -> str:
        principal = auth.current()
        return principal.email if principal is not None else "local"

    @app.get("/downloads", tags=TAG, summary="Where /auth/download takes each module from (maintainers)")
    async def downloads_list() -> dict:
        rows = sources()
        return {"count": len(rows), "sources": rows, "types": list(TYPES)}

    @app.put("/downloads/{module}", tags=TAG, summary="Set a module's download source: local file or https link")
    async def downloads_set(module: str, body: dict) -> dict:
        """Body {type: local|https, path, version?, sha256?, file_name?, notes?}. local: a path relative to the
        app folder; https: a public link (a Google Drive share link is turned into a direct download)."""
        try:
            return set_source(module, body or {}, _by())
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.delete("/downloads/{module}", tags=TAG, summary="Remove a module's download source (maintainers)")
    async def downloads_delete(module: str) -> dict:
        return {"module": module, "deleted": delete_source(module)}

    logger.info("Download source routes attached (/downloads)")
