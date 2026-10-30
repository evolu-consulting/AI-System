"""Small JSON documents KH keeps beside its tables: files locally, a HANA table in the cloud.

A few pieces of state were always plain JSON files - the SA-1 feedback counter
(projects/<id>/counter.json), the project descriptor (projects/<id>/bundle.json) and the
orchestrator manifest (orch_manifest.json). On a Cloud Foundry container those files
live on a disk that is wiped on every restart, so with KH_STORE_BACKEND=hana they move
into one table in the same schema as the rest of KH's state:

    kh_docs (path PK, body NCLOB, updated_at)

``path`` is the file path relative to the app root with forward slashes, so a document
keeps the name it had on disk and the two backends stay one mental model. With the
SQLite backend (the local default) every function here reads and writes the real file,
exactly as the callers did before.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time

from app import config, sqldb

_LOCK = threading.Lock()
_READY = False
#: The table documents live in; KH_DOCS_TABLE, default "kh_docs".
_T = config.DOCS_TABLE


def _key(path: str) -> str:
    """The document key: the path relative to the app root, forward slashes."""
    root = config._APP_ROOT
    if not os.path.isabs(path):
        return path.replace("\\", "/")
    try:
        rel = os.path.relpath(os.path.abspath(path), root)
    except ValueError:                       # Windows: another drive than the app root -> keep it absolute
        rel = os.path.abspath(path)
    return rel.replace("\\", "/")


def _init(c) -> None:
    global _READY
    if _READY:
        return
    sqldb.create_table(
        c, _T,
        f"CREATE TABLE IF NOT EXISTS {_T} (path TEXT PRIMARY KEY, body TEXT NOT NULL, "
        "updated_at TEXT NOT NULL)",
        f"CREATE COLUMN TABLE {_T} (path NVARCHAR(1024) PRIMARY KEY, body NCLOB NOT NULL, "
        "updated_at NVARCHAR(32) NOT NULL)",
    )
    _READY = True


def read_json(path: str, default=None):
    """The parsed document at ``path``, or ``default`` when it does not exist."""
    if not sqldb.is_hana():
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except OSError:
            return default
    with _LOCK, sqldb.connect() as c:
        _init(c)
        row = c.execute(f"SELECT body FROM {_T} WHERE path=?", (_key(path),)).fetchone()
    return json.loads(row["body"]) if row else default


def write_json(path: str, obj) -> None:
    """Replace the document at ``path``. Locally: atomic temp-file-then-rename."""
    if not sqldb.is_hana():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return
    body = json.dumps(obj, ensure_ascii=False, indent=2)
    with _LOCK, sqldb.connect() as c:
        _init(c)
        sqldb.upsert(c, _T, ("path",), {
            "path": _key(path), "body": body,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })


def exists(path: str) -> bool:
    if not sqldb.is_hana():
        return os.path.exists(path)
    with _LOCK, sqldb.connect() as c:
        _init(c)
        return c.execute(f"SELECT 1 FROM {_T} WHERE path=?", (_key(path),)).fetchone() is not None


def delete_tree(directory: str) -> bool:
    """Remove every document under ``directory``. True when something was removed."""
    if not sqldb.is_hana():
        if not os.path.isdir(directory):
            return False
        shutil.rmtree(directory)
        return True
    prefix = _key(directory).rstrip("/") + "/"
    with _LOCK, sqldb.connect() as c:
        _init(c)
        return c.execute(f"DELETE FROM {_T} WHERE path LIKE ? ESCAPE '\\'",
                         (prefix.replace("%", "\\%").replace("_", "\\_") + "%",)).rowcount > 0
