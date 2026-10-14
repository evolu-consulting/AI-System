"""P-b · PF-S2 · PB-R05/R15 · Resolve host: claim job `source.resolve`, resolve từng item, báo Hub,
kết thúc. Chạy trong process cha (như Dify host — HTTP + DB). library tải tài liệu qua internal H2c
bằng job-token (C15), git/local thuần (`sources.resolve`).
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, cast

import httpx2

from agent_runtime.db import resolve_sql
from agent_runtime.db.pool import Pool
from agent_runtime.log import get_logger
from agent_runtime.runtimes.cli.files.fetch import job_url
from agent_runtime.runtimes.hub_http import (
    SourceCredentialError,
    make_hub_client,
    source_credential,
)
from agent_runtime.sources import resolve, snapshot
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.git_driver import GitAuth

_HTTP_OK = 200
_LIB_TIMEOUT = httpx2.Timeout(60.0)
_NAME_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _s(v: object) -> str:
    """Chuỗi an toàn từ giá trị payload thô (None ⇒ "")."""
    return str(v) if v is not None else ""


def _asdict(v: object) -> dict[str, Any]:
    return cast("dict[str, Any]", v) if isinstance(v, dict) else {}


def _aslist(v: object) -> list[Any]:
    return cast("list[Any]", v) if isinstance(v, list) else []


def _safe_name(raw: str) -> str:
    base = raw.replace("\\", "/").rsplit("/", 1)[-1].strip()
    cleaned = _NAME_SAFE.sub("-", base).strip("-.") or "document"
    return cleaned[:200]


class ResolveHost:
    def __init__(  # noqa: PLR0913
        self,
        pool: Pool,
        cfg: SourceConfig,
        hub_url: str | None,
        worker_id: str,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._pool = pool
        self._cfg = cfg
        self._hub_url = hub_url
        self._worker_id = worker_id
        self._transport = transport

    async def run_loop(self, poll_s: float) -> None:
        log = get_logger()
        while True:
            try:
                while await self.claim_and_run():
                    pass
            except Exception as err:  # noqa: BLE001 — một job lỗi không được kéo sập vòng
                log.error("resolve.loop_error", error=type(err).__name__)
            await asyncio.sleep(poll_s)

    async def claim_and_run(self) -> bool:
        async with self._pool.acquire() as conn:
            job = await resolve_sql.claim_resolve(conn, self._worker_id)
        if job is None:
            return False
        await self._process(job)
        return True

    async def _process(self, job: resolve_sql.ResolveJob) -> None:
        log = get_logger()
        payload = job.payload  # dict thô: KHÔNG qua contract (config "độc" SQL-chèn làm fail parse)
        items = _aslist(payload.get("items"))
        tenant = _s(payload.get("tenant_id"))
        if not items:
            await self._finish(job, "failed", "INTERNAL_ERROR")
            return
        results: list[dict[str, Any]] = []
        for raw in items:
            results.append(await self._resolve_item(job, tenant, _asdict(raw)))
        await self._report(job, results)
        ok = all(r["status"] == "ok" for r in results)
        await self._finish(job, "succeeded", None)
        snapshot.enforce_lru(self._cfg, await self._active_runs())
        log.info("resolve.done", items=len(results), ok=ok)

    async def _resolve_item(
        self, job: resolve_sql.ResolveJob, tenant: str, raw: dict[str, Any]
    ) -> dict[str, Any]:
        kind = raw.get("kind")
        config = _asdict(raw.get("config"))
        allow = [_s(a) for a in _aslist(raw.get("allowlist_union"))]
        sid = _s(raw.get("source_id"))
        caps = snapshot.as_caps(raw.get("caps"))  # P-c1 PC-R04: `autofix` ⇒ trần + cache riêng
        try:
            if kind == "git_remote":
                url, branch = _s(config.get("url")), _s(config.get("branch"))
                has_cred = config.get("credential_secret_id") is not None
                auth = await self._git_auth(job, sid) if has_cred else None
                pin, files, size = resolve.resolve_git(
                    self._cfg, tenant, url, branch, allow, caps, sid, has_cred, auth
                )
            elif kind == "local_path":
                pin, files, size = resolve.resolve_local(
                    self._cfg, tenant, _s(config.get("path")), allow, caps
                )
            elif kind == "library":
                pin, files, size = await self._resolve_library(
                    job, tenant, _s(config.get("document_id")), allow
                )
            else:
                raise SourceError("SOURCE_UNRESOLVABLE", "loại nguồn không hỗ trợ")
        except SourceError as err:
            return {
                "status": "error",
                "source_id": sid,
                "code": err.code,
                "message": err.message[:500],
            }
        return {"status": "ok", "source_id": sid, "pin": pin, "files": files, "bytes": size}

    async def _git_auth(self, job: resolve_sql.ResolveJob, source_id: str) -> GitAuth:
        """PC2-R11: lấy khoá nguồn qua kênh nội bộ (Bearer token job), giữ trong bộ nhớ, truyền cho
        git qua `auth_env`. Thất bại ⇒ `SOURCE_UNRESOLVABLE` (không rơi về mirror khác, PC2-R12)."""
        if not self._hub_url:
            raise SourceError("SOURCE_UNRESOLVABLE", "không có hub_url")
        try:
            username, token = await source_credential(
                self._hub_url, job.id, job.token, source_id, self._transport
            )
        except SourceCredentialError as err:
            raise SourceError("SOURCE_UNRESOLVABLE", "không lấy được khoá nguồn") from err
        return GitAuth(username=username, token=token)

    async def _resolve_library(
        self, job: resolve_sql.ResolveJob, tenant: str, document_id: str, allow: list[str]
    ) -> tuple[dict[str, Any], int, int]:
        version = document_id  # LB-02 (bản tài liệu) hoãn: version = id tài liệu
        data, name = await self._fetch_library(job, document_id)
        safe = _safe_name(name)
        final = snapshot.library_dir(self._cfg, tenant, document_id, version, allow)
        snapshot.ensure(
            self._cfg, final, lambda tmp: snapshot.build_single(self._cfg, tmp, safe, data)
        )
        files, size = snapshot.count_snapshot(final)
        pin = {"kind": "library", "document_id": document_id, "version": version}
        return pin, files, size

    async def _fetch_library(
        self, job: resolve_sql.ResolveJob, document_id: str
    ) -> tuple[bytes, str]:
        if not self._hub_url:
            raise SourceError("SOURCE_UNRESOLVABLE", "không có hub_url")
        url = job_url(self._hub_url, job.id, f"attachments/{document_id}")
        headers = {"Authorization": f"Bearer {job.token}"}
        try:
            async with make_hub_client(self._transport) as client:
                resp = await client.get(url, headers=headers, timeout=_LIB_TIMEOUT)
        except httpx2.HTTPError as err:
            raise SourceError("SOURCE_UNRESOLVABLE", "tải tài liệu lỗi") from err
        if resp.status_code != _HTTP_OK:
            raise SourceError("SOURCE_UNRESOLVABLE", "tài liệu không khả dụng")
        name = resp.headers.get("X-Filename") or f"{document_id}.bin"
        return resp.content, name

    async def _report(self, job: resolve_sql.ResolveJob, results: list[dict[str, Any]]) -> None:
        if not self._hub_url:
            return
        url = job_url(self._hub_url, job.id, "sources-resolved")
        headers = {"Authorization": f"Bearer {job.token}"}
        try:
            async with make_hub_client(self._transport) as client:
                resp = await client.post(url, json={"results": results}, headers=headers)
            if resp.status_code not in (200, 201):
                get_logger().warning("resolve.report_rejected", status=resp.status_code)
        except httpx2.HTTPError as err:
            get_logger().warning("resolve.report_failed", error=type(err).__name__)

    async def _finish(
        self, job: resolve_sql.ResolveJob, status: str, error_code: str | None
    ) -> None:
        async with self._pool.acquire() as conn:
            await resolve_sql.finish_resolve(conn, job.id, self._worker_id, status, error_code)

    async def _active_runs(self) -> set[str]:
        run_ids = snapshot.all_ref_run_ids(self._cfg)
        if not run_ids:
            return set()
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id::text AS id FROM hub.runs "
                "WHERE id = ANY($1::uuid[]) AND status = 'running'",
                list(run_ids),
            )
        return {str(r["id"]) for r in rows}
