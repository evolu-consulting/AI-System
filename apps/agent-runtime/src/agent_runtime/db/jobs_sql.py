"""WRK-FR-01 · WRK-FR-02 · WRK-FR-20 · WRK-FR-23 · WRK-FR-24 · WRK-BR-04 · WRK-BR-05 · H1-R20 ·
AC-W06 · H2a-RT1 · RT4 — SQL `hub.jobs` của Runtime, nguyên văn `plan-db.md` §5.4–5.5 (tham số
asyncpg) + H2a: claim ghi `token_hash` (RT1), requeue orphan `workflow.async` (H2a `plan-db` §2).

Chỉ đánh lại số tham số cho liền mạch (asyncpg không suy được kiểu tham số bị bỏ trống) và đổi hằng
`interval '60 seconds'` của quét orphan thành `$1` giây (`AGENT_RT_ORPHAN_S`).
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass, field
from typing import Any

from agent_runtime.db.pool import Conn, Row
from agent_runtime.probe import probe

# CR-114 hub-claim-scale: khoá claim **theo provider** (2 khoá, `$1` = provider_key) thay cho một
# khoá toàn cục ⇒ worker của các provider khác nhau claim song song. Mọi chỗ đổi slot/trạng thái
# provider (claim, "Kết thúc" làm hỏng provider, probe) giữ đúng khoá của provider đó. Job
# `subscription` của tenant có giới hạn: thêm `K_CLAIM_TENANT` (sau hàng `jobs`) rồi `TENANT_OK`.
# Thứ tự khoá: `K_CLAIM(provider)` → hàng `jobs` → `K_CLAIM_TENANT` → `provider_state`.
K_CLAIM = "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'), hashtext($1::text));"
K_CLAIM_TENANT = (
    "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim.tenant'), hashtext($1::text));"
)
# Slot sandbox (P-c1/P-c2) đếm theo worker: claim tự-sửa và claim `source.apply` cùng worker giữ
# khoá này trước (thứ tự: `K_CLAIM_SANDBOX` → `K_CLAIM(provider)` → …).
K_CLAIM_SANDBOX = (
    "SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim.sandbox'), hashtext($1::text));"
)
TENANT_OK = """SELECT hub.tenant_sub_limit($1::uuid) IS NULL
  OR (SELECT count(*) FROM hub.jobs r JOIN hub.providers rp ON rp.key = r.provider_key
      WHERE r.status = 'running' AND r.tenant_id = $1::uuid AND rp.kind = 'subscription')
     < hub.tenant_sub_limit($1::uuid) AS ok;"""

# plan-db §5.4 "Claim", cùng điều kiện; CR-114 (Luật 4c) đếm `running` theo provider / tenant MỘT
# lần mỗi câu (CTE) thay vì một subquery mỗi hàng ứng viên (O(queued × running): 28.8 ms → xem
# `claim_scale_int_test.py`); trả thêm provider/tenant/kind/giới hạn cho bước khoá tenant.
_CLAIM_BODY = """WITH pr AS MATERIALIZED (SELECT r.provider_key, count(*) AS n FROM hub.jobs r
    WHERE r.status = 'running' AND r.provider_key = ANY($1::text[]) GROUP BY r.provider_key),
  tr AS MATERIALIZED (SELECT r.tenant_id, count(*) AS n FROM hub.jobs r
    JOIN hub.providers rp ON rp.key = r.provider_key AND rp.kind = 'subscription'
    WHERE r.status = 'running' GROUP BY r.tenant_id)
SELECT j.id, j.provider_key, j.tenant_id::text AS tenant_id, p.kind,
  hub.tenant_sub_limit(j.tenant_id) AS sub_limit
FROM hub.jobs j
JOIN hub.providers p ON p.key = j.provider_key AND p.enabled
LEFT JOIN hub.provider_state s ON s.provider_key = p.key
LEFT JOIN pr ON pr.provider_key = j.provider_key
LEFT JOIN tr ON tr.tenant_id = j.tenant_id
WHERE j.status = 'queued' AND j.cancel_requested_at IS NULL
  AND j.provider_key = ANY($1::text[])
  AND (s.status IS NULL OR s.status IN ('ok','busy') OR (s.status = 'cooldown' AND s.cooldown_until <= now()))
  AND coalesce(pr.n, 0) < p.max_concurrency
  AND (p.kind <> 'subscription' OR hub.tenant_sub_limit(j.tenant_id) IS NULL
       OR coalesce(tr.n, 0) < hub.tenant_sub_limit(j.tenant_id))
  AND NOT EXISTS (SELECT 1 FROM hub.jobs b
       WHERE b.conversation_id = j.conversation_id AND b.agent_id = j.agent_id
         AND (b.status = 'running' OR (b.status = 'queued'
              AND (b.priority, b.created_at, b.id) < (j.priority, j.created_at, j.id))))
ORDER BY j.priority, j.created_at, j.id
LIMIT 1"""  # noqa: E501
_LOCK_ROW = "\nFOR UPDATE OF j SKIP LOCKED;"
CLAIM_SELECT = _CLAIM_BODY + _LOCK_ROW
# PEEK: cùng điều kiện, không khoá hàng/advisory — chỉ để chọn provider của job đứng đầu hàng đợi.
CLAIM_PEEK = _CLAIM_BODY + ";"

# P-c1 plan-runtime §5.1 (`RUNTIME_SANDBOX_MAX`): job tự-sửa (`payload.autofix` là object) chỉ
# claim khi số job tự-sửa `running` của worker này < $3 ($2 = worker_id); job thường không đổi.
# P-c2 C22/C38: slot đếm thêm job `source.apply` đang chạy (Áp rebase dựng container test như
# tự-sửa) ⇒ claim tự-sửa thấy được job Áp đang chiếm slot và ngược lại (`db/apply_sql.py`).
SANDBOX_SLOT = """  AND (jsonb_typeof(j.payload->'autofix') IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM hub.jobs a WHERE a.status = 'running' AND a.worker_id = $2
           AND (jsonb_typeof(a.payload->'autofix') = 'object' OR a.type = 'source.apply')) < $3)
"""
CLAIM_SELECT_SANDBOX = CLAIM_SELECT.replace("ORDER BY", SANDBOX_SLOT + "ORDER BY", 1)
CLAIM_PEEK_SANDBOX = CLAIM_PEEK.replace("ORDER BY", SANDBOX_SLOT + "ORDER BY", 1)

# H2a RT1: thêm `token_hash = $3` (sha256 của token claim, mọi job — `plan-runtime` §3.3 bước 0).
CLAIM_UPDATE = """UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(), heartbeat_at = now(), attempts = attempts + 1, token_hash = $3
WHERE id = $1 AND status = 'queued'
RETURNING payload;"""  # noqa: E501 — nguyên văn plan-db §5.4 ($3 → $1) + RT1

SET_PGID = (
    """UPDATE hub.jobs SET pgid = $3 WHERE id = $1 AND worker_id = $2 AND status = 'running';"""  # noqa: E501
)

FINISH = """UPDATE hub.jobs SET status = $3, result = $4, error_code = $5, error_reason = $6, error_message = $7,
  finished_at = now(), pgid = NULL
WHERE id = $1 AND worker_id = $2 AND status = 'running';"""  # noqa: E501 — nguyên văn plan-db §5.4 "Kết thúc"

# Review 1 C1 (job `workflow.async` có thể requeue rồi chính worker này claim lại cùng `id`): câu
# ghi của lần claim cũ phải rào theo `token_hash` của lần claim đó, không chỉ `worker_id`.
FINISH_FENCED = FINISH.removesuffix(";") + " AND token_hash = $8;"

HEARTBEAT = """UPDATE hub.jobs SET heartbeat_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, cancel_requested_at IS NOT NULL AS cancel;"""  # noqa: E501

SWEEP_ORPHANS = """UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $1) RETURNING id, run_id, worker_id, pgid;"""  # noqa: E501

# H2a R7 · RT4 (`plan-db` §2 "Requeue orphan", nguyên văn): `workflow.async` mồ côi còn lượt →
# `queued`; chạy **trước** `SWEEP_ORPHANS`/`RESTART_ORPHANS` cùng kết nối (không cột `requeued`).
_REQUEUE_SET = """UPDATE hub.jobs SET status = 'queued', worker_id = NULL, pgid = NULL, heartbeat_at = NULL, started_at = NULL,
  token_hash = NULL, dispatched_at = NULL, queued_at = now()"""  # noqa: E501
_REQUEUE_WHERE = """AND attempts < 3 AND cancel_requested_at IS NULL
  AND NOT (coalesce((payload->>'side_effect')::boolean, false) AND dispatched_at IS NOT NULL)
RETURNING id, run_id, worker_id, pgid;"""
REQUEUE_ORPHANS = f"""{_REQUEUE_SET}
WHERE status = 'running' AND type = 'workflow.async' AND heartbeat_at < now() - make_interval(secs => $1)
  {_REQUEUE_WHERE}"""  # noqa: E501
# Bản "khởi động lại" (plan-runtime §3.8): điều kiện heartbeat thay bằng `worker_id = $1`.
REQUEUE_RESTART = f"""{_REQUEUE_SET}
WHERE status = 'running' AND type = 'workflow.async' AND worker_id = $1
  {_REQUEUE_WHERE}"""
NOTIFY_ENQUEUED = "SELECT pg_notify('job_enqueued', $1);"
TOKEN_BYTES = 32

RESTART_ORPHANS = """UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, run_id, pgid;"""  # noqa: E501

# Biến thể "Khởi động lại" cho một job (review H1 #1): job `running` của mình mà process không còn
# giữ (ghi kết thúc lỗi DB) → `orphaned`; điều kiện `worker_id` + `running` như câu gốc.
ORPHAN_ONE = """UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE id = $1 AND worker_id = $2 AND status = 'running' RETURNING id, run_id, pgid;"""  # noqa: E501

# Mất ack của "Kết thúc" (review H1 v2 M2): lần thử sau 0 dòng → job đã ở đúng trạng thái kết thúc
# mình định ghi (cùng `worker_id`, status, mã, lý do; sweeper ghi `orphaned` nên không trùng).
FINISHED_AS = """SELECT 1 FROM hub.jobs WHERE id = $1 AND worker_id = $2 AND status = $3 AND error_code IS NOT DISTINCT FROM $4 AND error_reason IS NOT DISTINCT FROM $5;"""  # noqa: E501

FINISHED_AS_FENCED = FINISHED_AS.removesuffix(";") + " AND token_hash = $6;"

RESET_PROVIDERS = """UPDATE hub.provider_state SET status = 'ok', consecutive_errors = 0, cooldown_until = NULL, updated_at = now() WHERE provider_key = ANY($1::text[]) AND status IN ('error','logged_out');"""  # noqa: E501


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    payload: dict[str, Any]
    # RT1 · token claim (`plan-runtime` §3.3): chỉ trong bộ nhớ cha, không repr/log; PY-03 sinh.
    token: str = field(default="", repr=False)

    @property
    def run_id(self) -> str:
        return str(self.payload.get("run_id", ""))

    @property
    def fence(self) -> bytes:
        """`token_hash` của lần claim này (C1) — rào câu ghi theo lần claim, không chỉ `id`."""
        return token_hash(self.token)


@dataclass(frozen=True)
class OrphanRow:
    id: str
    run_id: str
    pgid: int | None
    worker_id: str | None = None


def _payload(raw: object) -> dict[str, Any]:
    value: object = json.loads(raw) if isinstance(raw, str | bytes) else raw
    return dict(value) if isinstance(value, dict) else {}  # pyright: ignore[reportUnknownArgumentType]


def new_token() -> tuple[str, bytes]:
    """RT1 · token claim (32 byte CSPRNG, base64url không padding, 43 ký tự) + sha256 (32 byte,
    = `hashJobToken` TS). Token rõ chỉ trong bộ nhớ cha — không log, không vào payload/DB/XADD."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, token_hash(token)


def token_hash(token: str) -> bytes:
    """sha256(ASCII) 32 byte = `hashJobToken` TS = `hub.jobs.token_hash`."""
    return hashlib.sha256(token.encode("ascii")).digest()


def _orphan(row: Row) -> OrphanRow:
    pgid = row["pgid"]
    return OrphanRow(
        id=str(row["id"]),
        run_id=str(row["run_id"]),
        pgid=int(pgid) if pgid else None,
        worker_id=row.get("worker_id"),
    )


async def claim_one(
    conn: Conn, providers: list[str], worker_id: str, sandbox_max: int | None = None
) -> ClaimedJob | None:
    """CR-114: PEEK (không khoá) chọn provider của job đứng đầu → `_claim_in` (transaction READ
    COMMITTED dưới `K_CLAIM` của provider đó). Provider hết job claim được bị bỏ khỏi lượt PEEK sau;
    trượt khoá tenant ⇒ thử lại (có chặn). `sandbox_max` (P-c1) ⇒ slot tự-sửa."""
    with probe("claim.one"):  # CR-116 điểm đo (tắt ⇒ không làm gì)
        return await _claim_one(conn, providers, worker_id, sandbox_max)


async def _claim_one(
    conn: Conn, providers: list[str], worker_id: str, sandbox_max: int | None
) -> ClaimedJob | None:
    extra: tuple[object, ...] = () if sandbox_max is None else (worker_id, sandbox_max)
    peek = CLAIM_PEEK if sandbox_max is None else CLAIM_PEEK_SANDBOX
    left = list(dict.fromkeys(providers))
    for _ in range(len(left) + TENANT_RETRIES):
        hit = await conn.fetchrow(peek, left, *extra) if left else None
        if hit is None:
            return None
        key = str(hit["provider_key"])
        got = await _claim_in(conn, key, worker_id, extra)
        if got is _EMPTY:
            left.remove(key)
        elif isinstance(got, ClaimedJob):
            return got
    return None


TENANT_RETRIES = 3
_EMPTY, _RACE = object(), object()


async def _claim_in(
    conn: Conn, key: str, worker_id: str, extra: tuple[object, ...]
) -> ClaimedJob | object:
    """`K_CLAIM(key)` → SELECT … SKIP LOCKED (1 provider) → [tenant giới hạn: `K_CLAIM_TENANT` →
    `TENANT_OK`, câu mới thấy claim đã commit của provider khác] → `running` + `token_hash` (RT1,
    mọi job; claim lại sau requeue → token mới). `_EMPTY` = provider hết job; `_RACE` = thử lại."""
    token, digest = new_token()
    select = CLAIM_SELECT if not extra else CLAIM_SELECT_SANDBOX
    async with conn.transaction():
        if extra:  # slot tự-sửa đếm theo worker: chung khoá với claim `source.apply` (apply_sql)
            await conn.execute(K_CLAIM_SANDBOX, worker_id)
        await conn.execute(K_CLAIM, key)
        row = await conn.fetchrow(select, [key], *extra)
        if row is None:
            return _EMPTY
        if row["kind"] == "subscription" and row["sub_limit"] is not None:
            await conn.execute(K_CLAIM_TENANT, row["tenant_id"])
            ok = await conn.fetchrow(TENANT_OK, row["tenant_id"])
            if ok is None or not ok["ok"]:
                return _RACE
        done = await conn.fetchrow(CLAIM_UPDATE, row["id"], worker_id, digest)
        if done is None:
            return _RACE
        return ClaimedJob(id=str(row["id"]), payload=_payload(done["payload"]), token=token)


async def set_pgid(conn: Conn, job_id: str, worker_id: str, pgid: int) -> bool:
    return await conn.execute(SET_PGID, job_id, worker_id, pgid) == "UPDATE 1"


@dataclass(frozen=True)
class Finish:
    """Câu đầu của transaction "Kết thúc" (usage/cli_sessions/provider_state: PY-11/PY-12)."""

    status: str
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_reason: str | None = None
    error_message: str | None = None


async def finish_job(conn: Conn, job_id: str, worker_id: str, f: Finish) -> bool:
    """True nếu job còn `running` của mình và đã chuyển trạng thái (0 dòng → không XADD, R2)."""
    result = json.dumps(f.result) if f.result is not None else None
    status = await conn.execute(
        FINISH, job_id, worker_id, f.status, result, f.error_code, f.error_reason, f.error_message
    )
    return status == "UPDATE 1"


async def finish_job_fenced(conn: Conn, job: ClaimedJob, worker_id: str, f: Finish) -> bool:
    """Như `finish_job` + `token_hash` của đúng lần claim `job` (review 1 C1)."""
    result = json.dumps(f.result) if f.result is not None else None
    args = (job.id, worker_id, f.status, result, f.error_code, f.error_reason, f.error_message)
    return await conn.execute(FINISH_FENCED, *args, job.fence) == "UPDATE 1"


async def finished_as(conn: Conn, job_id: str, worker_id: str, f: Finish) -> bool:
    """True nếu job của `worker_id` đã ở đúng trạng thái kết thúc `f` (commit trước đó mất ack)."""
    row = await conn.fetchrow(
        FINISHED_AS, job_id, worker_id, f.status, f.error_code, f.error_reason
    )
    return row is not None


async def finished_as_fenced(conn: Conn, job: ClaimedJob, worker_id: str, f: Finish) -> bool:
    """Như `finished_as` + `token_hash` của đúng lần claim `job` (review 1 C1)."""
    args = (job.id, worker_id, f.status, f.error_code, f.error_reason, job.fence)
    return await conn.fetchrow(FINISHED_AS_FENCED, *args) is not None


async def heartbeat(conn: Conn, worker_id: str) -> dict[str, bool]:
    """`{job_id: cancel}` cho mọi job `running` của `worker_id`."""
    rows = await conn.fetch(HEARTBEAT, worker_id)
    return {str(r["id"]): bool(r["cancel"]) for r in rows}


async def sweep_orphans(conn: Conn, orphan_s: float) -> list[OrphanRow]:
    return [_orphan(r) for r in await conn.fetch(SWEEP_ORPHANS, float(orphan_s))]


async def _requeue(conn: Conn, sql: str, arg: object) -> list[OrphanRow]:
    """Requeue + NOTIFY `job_enqueued{provider_key:"dify"}` mỗi dòng trong một transaction (NOTIFY
    gửi khi COMMIT). Không XADD (job chưa kết thúc)."""
    async with conn.transaction():
        rows = [_orphan(r) for r in await conn.fetch(sql, arg)]
        for row in rows:
            note = {"v": 1, "job_id": row.id, "provider_key": "dify"}
            await conn.execute(NOTIFY_ENQUEUED, json.dumps(note))
    return rows


async def requeue_orphans(conn: Conn, orphan_s: float) -> list[OrphanRow]:
    return await _requeue(conn, REQUEUE_ORPHANS, float(orphan_s))


async def requeue_restart(conn: Conn, worker_id: str) -> list[OrphanRow]:
    return await _requeue(conn, REQUEUE_RESTART, worker_id)


async def restart_orphans(conn: Conn, worker_id: str) -> list[OrphanRow]:
    return [_orphan(r) for r in await conn.fetch(RESTART_ORPHANS, worker_id)]


async def orphan_one(conn: Conn, job_id: str, worker_id: str) -> OrphanRow | None:
    row = await conn.fetchrow(ORPHAN_ONE, job_id, worker_id)
    return _orphan(row) if row is not None else None


async def reset_providers(conn: Conn, providers: list[str]) -> None:
    await conn.execute(RESET_PROVIDERS, providers)
