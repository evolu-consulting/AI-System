"""Artifacts: files KH hands out (the kh-helper wheel first), stored as data, not in the deploy (fen 2026-10-19).

Until 1.14.0 the helper wheel was built into the app by deploy/btp/push.ps1, so every helper release was a
full KH redeploy. Now a maintainer uploads it (POST /artifacts) and /auth/download serves it from here.

WHERE THE BYTES LIVE is a setting, not code: one row in artifact_settings names the active mode and its
config, changed with PUT /artifacts/backend, so moving to a VPS or a file store needs no redeploy.

  hana   the bytes, base64, in artifact_blob (KH's own relational store). Needs no config. The default.
  http   a plain file server, e.g. nginx WebDAV on a VPS: PUT/GET/DELETE <base_url><name>.
         config {base_url, get_url?, headers?, serve?}
  s3     any S3-compatible object store (BTP Object Store, AWS S3, MinIO).
         config {bucket, region?, endpoint_url?, prefix?, access_key_id, secret_access_key, serve?}

serve: "proxy" (default; KH streams the file, the bucket can stay private and the URL never changes) or
"redirect" (302 to the store: a presigned URL for s3, get_url for http).

A switch first writes, reads back and deletes a probe file in the new store, then copies every artifact
(checked by sha256), and only then flips the setting and the rows in one transaction. The old copies stay
where they were, so switching back is the same call. Secrets in the config never leave KH: reads mask them.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import RedirectResponse, Response

from app import config, sqldb

logger = logging.getLogger(__name__)

FILES = "artifact_file"
BLOBS = "artifact_blob"
SETTINGS = "artifact_settings"
ACTIVE = "active"
MODES = ("hana", "http", "s3")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+-]{0,199}$")
WHEEL = re.compile(r"^(?P<dist>[A-Za-z0-9_.]+)-(?P<version>\d[^-]*)-.+\.whl$")
MAX_BYTES = int(config._env("KH_ARTIFACT_MAX_MB", "50")) * 1024 * 1024
MASK = "***"
_SECRET_KEY = re.compile(r"(?i)secret|password|token|authorization|access_key|api[_-]?key")
PROBE = "_kh_probe.txt"

_LOCK = threading.Lock()
_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def init() -> None:
    """Create the tables if absent. Safe on every startup."""
    global _ready
    with _LOCK, sqldb.connect() as c:
        sqldb.create_table(
            c, FILES,
            f"""CREATE TABLE IF NOT EXISTS {FILES} (
                name TEXT PRIMARY KEY, module TEXT NOT NULL, version TEXT NOT NULL, sha256 TEXT NOT NULL,
                size INTEGER NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL)""",
            f"""CREATE COLUMN TABLE {FILES} (
                name NVARCHAR(200) PRIMARY KEY, module NVARCHAR(64) NOT NULL, version NVARCHAR(64) NOT NULL,
                sha256 NVARCHAR(64) NOT NULL, size BIGINT NOT NULL, mode NVARCHAR(16) NOT NULL,
                created_at NVARCHAR(32) NOT NULL, created_by NVARCHAR(256) NOT NULL)""")
        sqldb.create_table(
            c, BLOBS,
            f"CREATE TABLE IF NOT EXISTS {BLOBS} (name TEXT PRIMARY KEY, content TEXT NOT NULL)",
            f"CREATE COLUMN TABLE {BLOBS} (name NVARCHAR(200) PRIMARY KEY, content NCLOB NOT NULL)")
        sqldb.create_table(
            c, SETTINGS,
            f"""CREATE TABLE IF NOT EXISTS {SETTINGS} (
                id TEXT PRIMARY KEY, mode TEXT NOT NULL, config TEXT NOT NULL, updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL)""",
            f"""CREATE COLUMN TABLE {SETTINGS} (
                id NVARCHAR(16) PRIMARY KEY, mode NVARCHAR(16) NOT NULL, config NCLOB NOT NULL,
                updated_at NVARCHAR(32) NOT NULL, updated_by NVARCHAR(256) NOT NULL)""")
    _ready = True


# ── stores ───────────────────────────────────────────────────────────────────

class HanaStore:
    """Bytes as base64 text in artifact_blob: no file storage needed."""

    def __init__(self, cfg: dict):
        self.serve = "proxy"

    def put(self, name: str, data: bytes) -> None:
        with sqldb.connect() as c:
            sqldb.upsert(c, BLOBS, ["name"], {"name": name, "content": base64.b64encode(data).decode("ascii")})

    def get(self, name: str) -> bytes:
        with sqldb.connect() as c:
            row = c.execute(f"SELECT content FROM {BLOBS} WHERE name=?", [name]).fetchone()
        if row is None:
            raise FileNotFoundError(name)
        return base64.b64decode(row[0])

    def delete(self, name: str) -> None:
        with sqldb.connect() as c:
            c.execute(f"DELETE FROM {BLOBS} WHERE name=?", [name])

    def url(self, name: str) -> str | None:
        return None


class HttpStore:
    """A plain file server (a VPS with nginx WebDAV, Caddy, ...): PUT, GET and DELETE on <base_url><name>."""

    def __init__(self, cfg: dict):
        base = str(cfg.get("base_url") or "").strip()
        if not base.startswith(("https://", "http://")):
            raise ValueError("http mode needs base_url (https://...)")
        self.base = base if base.endswith("/") else base + "/"
        get_url = str(cfg.get("get_url") or "").strip()
        self.get_base = (get_url if get_url.endswith("/") else get_url + "/") if get_url else self.base
        self.headers = {str(k): str(v) for k, v in (cfg.get("headers") or {}).items()}
        self.serve = cfg.get("serve") or "proxy"
        self.timeout = float(cfg.get("timeout_s") or 60)

    def _check(self, resp, ok=(200, 201, 204)):
        if resp.status_code not in ok:
            raise RuntimeError(f"{resp.request.method} {resp.url} answered {resp.status_code}")
        return resp

    def put(self, name: str, data: bytes) -> None:
        import requests
        self._check(requests.put(self.base + name, data=data, headers=self.headers, timeout=self.timeout))

    def get(self, name: str) -> bytes:
        import requests
        resp = requests.get(self.base + name, headers=self.headers, timeout=self.timeout)
        if resp.status_code == 404:
            raise FileNotFoundError(name)
        return self._check(resp, (200,)).content

    def delete(self, name: str) -> None:
        import requests
        self._check(requests.delete(self.base + name, headers=self.headers, timeout=self.timeout), (200, 202, 204, 404))

    def url(self, name: str) -> str | None:
        return self.get_base + name


class S3Store:
    """Any S3-compatible object store, through boto3."""

    def __init__(self, cfg: dict, client=None):
        self.bucket = str(cfg.get("bucket") or "").strip()
        if not self.bucket:
            raise ValueError("s3 mode needs bucket")
        self.prefix = str(cfg.get("prefix") or "").strip().strip("/")
        self.serve = cfg.get("serve") or "proxy"
        if client is None:
            import boto3
            client = boto3.client("s3", region_name=cfg.get("region") or None,
                                  endpoint_url=cfg.get("endpoint_url") or None,
                                  aws_access_key_id=cfg.get("access_key_id") or None,
                                  aws_secret_access_key=cfg.get("secret_access_key") or None)
        self.client = client

    def _key(self, name: str) -> str:
        return f"{self.prefix}/{name}" if self.prefix else name

    def put(self, name: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self._key(name), Body=data)

    def get(self, name: str) -> bytes:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=self._key(name))["Body"].read()
        except Exception as exc:  # noqa: BLE001 - botocore's NoSuchKey is generated per client
            if "NoSuchKey" in type(exc).__name__ or "NoSuchKey" in str(exc) or "404" in str(exc):
                raise FileNotFoundError(name) from exc
            raise

    def delete(self, name: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(name))

    def url(self, name: str) -> str | None:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": self._key(name)},
                                                  ExpiresIn=600)


STORES = {"hana": HanaStore, "http": HttpStore, "s3": S3Store}


def store_for(mode: str, cfg: dict):
    if mode not in STORES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    if (cfg.get("serve") or "proxy") not in ("proxy", "redirect"):
        raise ValueError("serve must be proxy or redirect")
    return STORES[mode](cfg)


# ── settings ─────────────────────────────────────────────────────────────────

def settings() -> dict:
    """{mode, config, updated_at, updated_by}; hana with no config until someone switches."""
    with sqldb.connect() as c:
        row = c.execute(f"SELECT mode, config, updated_at, updated_by FROM {SETTINGS} WHERE id=?", [ACTIVE]).fetchone()
    if row is None:
        return {"mode": "hana", "config": {}, "updated_at": None, "updated_by": None}
    return {"mode": row[0], "config": json.loads(row[1] or "{}"), "updated_at": row[2], "updated_by": row[3]}


def masked(cfg: dict) -> dict:
    """The config with every secret replaced by MASK, also inside headers."""
    out = {}
    for k, v in (cfg or {}).items():
        if isinstance(v, dict):
            out[k] = masked(v) if k != "headers" else {hk: MASK for hk in v}
        else:
            out[k] = MASK if _SECRET_KEY.search(k) and v else v
    return out


def _unmask(new: dict, old: dict) -> dict:
    """A value sent back as MASK keeps the stored one, so a maintainer never has to retype a secret."""
    out = {}
    for k, v in (new or {}).items():
        if isinstance(v, dict):
            out[k] = _unmask(v, (old or {}).get(k) or {})
        else:
            out[k] = (old or {}).get(k) if v == MASK else v
    return out


def switch(mode: str, cfg: dict, by: str, store_factory=store_for) -> dict:
    """Probe the new store, copy every artifact into it, then make it the active one."""
    current = settings()
    cfg = _unmask(cfg or {}, current["config"] if current["mode"] == mode else {})
    new = store_factory(mode, cfg)
    new.put(PROBE, b"kh probe")
    if new.get(PROBE) != b"kh probe":
        raise RuntimeError("the new store did not give the probe file back")
    new.delete(PROBE)
    copied = []
    same_store = mode == current["mode"] and cfg == current["config"]
    for row in list_files():
        if same_store or (row["mode"] == mode == "hana"):
            continue                           # already there (a new http/s3 config is a new place: copy)
        data = _store_of(row["mode"]).get(row["name"])
        new.put(row["name"], data)
        if hashlib.sha256(new.get(row["name"])).hexdigest() != row["sha256"]:
            raise RuntimeError(f"{row['name']} came back different from the new store")
        copied.append(row["name"])
    with sqldb.connect() as c:
        sqldb.upsert(c, SETTINGS, ["id"], {"id": ACTIVE, "mode": mode, "config": json.dumps(cfg),
                                           "updated_at": _now(), "updated_by": by})
        c.execute(f"UPDATE {FILES} SET mode=?", [mode])
    logger.info("artifacts: store switched %s -> %s by %s, %d copied", current["mode"], mode, by, len(copied))
    return {"mode": mode, "config": masked(cfg), "copied": copied, "previous": current["mode"]}


def _store_of(mode: str):
    """The store a row's bytes are in: hana always; the active mode with its config; nothing else."""
    if mode == "hana":
        return HanaStore({})
    active = settings()
    if active["mode"] != mode:
        raise RuntimeError(f"artifact stored in '{mode}', but the active store is '{active['mode']}'")
    return store_for(mode, active["config"])


# ── files ────────────────────────────────────────────────────────────────────

def parse_wheel(name: str) -> tuple[str, str]:
    """(module, version) from a wheel file name: kh_helper-1.15.0-py3-none-any.whl -> (kh-helper, 1.15.0)."""
    m = WHEEL.match(name)
    if not m:
        return "", ""
    return m.group("dist").replace("_", "-").lower(), m.group("version")


def version_key(version: str) -> tuple:
    return tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[.+-]", version or "0"))


def upload(name: str, data: bytes, by: str, module: str = "", version: str = "") -> dict:
    if not NAME.match(name or "") or name == PROBE:
        raise ValueError("name: letters, digits, . _ + - only, no paths")
    if not data:
        raise ValueError("the file is empty")
    if len(data) > MAX_BYTES:
        raise ValueError(f"the file is larger than {MAX_BYTES // (1024 * 1024)} MB")
    wheel_module, wheel_version = parse_wheel(name)
    module = (module or wheel_module).strip().lower()
    version = (version or wheel_version).strip()
    if not module or not version:
        raise ValueError("module and version are needed when the name is not a wheel file name")
    active = settings()
    store_for(active["mode"], active["config"]).put(name, data)
    row = {"name": name, "module": module, "version": version, "sha256": hashlib.sha256(data).hexdigest(),
           "size": len(data), "mode": active["mode"], "created_at": _now(), "created_by": by}
    with sqldb.connect() as c:
        sqldb.upsert(c, FILES, ["name"], row)
    return row


def list_files(module: str | None = None) -> list[dict]:
    sql = f"SELECT name, module, version, sha256, size, mode, created_at, created_by FROM {FILES}"
    with sqldb.connect() as c:
        rows = c.execute(sql + (" WHERE module=?" if module else ""), [module] if module else []).fetchall()
    keys = ("name", "module", "version", "sha256", "size", "mode", "created_at", "created_by")
    return [dict(zip(keys, tuple(r))) for r in rows]


def find(name: str) -> dict | None:
    return next((r for r in list_files() if r["name"] == name), None)


def latest(module: str) -> dict | None:
    rows = list_files(module)
    return max(rows, key=lambda r: version_key(r["version"])) if rows else None


def delete(name: str) -> bool:
    row = find(name)
    if row is None:
        return False
    try:
        _store_of(row["mode"]).delete(name)
    except Exception as exc:  # noqa: BLE001 - the row goes anyway; a stray copy only costs space
        logger.warning("artifacts: could not delete %s from %s: %s", name, row["mode"], exc)
    with sqldb.connect() as c:
        c.execute(f"DELETE FROM {FILES} WHERE name=?", [name])
    return True


def response(name: str):
    """The download of one stored artifact: its bytes, or a redirect to the store; None when unknown."""
    row = find(name)
    if row is None:
        return None
    store = _store_of(row["mode"])
    link = store.url(name) if store.serve == "redirect" else None
    if link:
        return RedirectResponse(link, status_code=302)
    return Response(store.get(name), media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ── routes ───────────────────────────────────────────────────────────────────

def attach(app) -> None:
    from app import auth

    TAG = ["Artifacts"]
    init()

    def _by() -> str:
        principal = auth.current()
        return principal.email if principal is not None else "local"

    @app.post("/artifacts", tags=TAG, summary="Upload a file KH hands out, e.g. a kh-helper wheel (maintainers)")
    async def artifacts_upload(body: dict) -> dict:
        """Body {name, content_b64, module?, version?}. A wheel name gives module and version itself."""
        try:
            data = base64.b64decode(str(body.get("content_b64") or ""), validate=True)
            return upload(str(body.get("name") or ""), data, _by(), str(body.get("module") or ""),
                          str(body.get("version") or ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/artifacts", tags=TAG, summary="List the stored artifacts (maintainers)")
    async def artifacts_list(module: str | None = None) -> dict:
        rows = sorted(list_files(module), key=lambda r: (r["module"], version_key(r["version"])))
        return {"count": len(rows), "artifacts": rows, "store": settings()["mode"]}

    @app.delete("/artifacts/{name}", tags=TAG, summary="Delete one stored artifact (maintainers)")
    async def artifacts_delete(name: str) -> dict:
        return {"deleted": delete(name), "name": name}

    @app.get("/artifacts/backend", tags=TAG, summary="Where artifacts are stored now (maintainers; secrets masked)")
    async def artifacts_backend() -> dict:
        s = settings()
        return {**s, "config": masked(s["config"]), "modes": list(MODES)}

    @app.put("/artifacts/backend", tags=TAG, summary="Switch the artifact store: hana, http (VPS) or s3 (maintainers)")
    async def artifacts_backend_set(body: dict) -> dict:
        """Body {mode, config}. Probes the new store, copies every artifact, then switches; no redeploy."""
        import asyncio
        try:
            return await asyncio.to_thread(switch, str(body.get("mode") or ""), body.get("config") or {}, _by())
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        except Exception as exc:  # noqa: BLE001 - the store's own error, shown to the maintainer
            raise HTTPException(502, f"the new store failed, nothing switched: {exc}")


def bundled(downloads: Path, module: str = "kh-helper") -> Path | None:
    """The newest wheel a deploy put next to the app (before artifacts existed); None when none."""
    wheels = [p for p in downloads.glob("*.whl")] if downloads.is_dir() else []
    wheels = [p for p in wheels if parse_wheel(p.name)[0] == module]
    return max(wheels, key=lambda p: version_key(parse_wheel(p.name)[1])) if wheels else None
