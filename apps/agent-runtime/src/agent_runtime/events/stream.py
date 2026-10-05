"""WRK-FR-03 · XADD `run:<run_id>` (plan.md §2.3, plan-db.md §5.4).

Chỉ gọi SAU commit; 0 dòng cập nhật thì không gọi (plan-db §8 R2). `job.progress` chỉ mang
`message`/`percent`, không đường dẫn/nội dung (R7): người gọi chịu trách nhiệm chuỗi message.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from agent_runtime.contracts.hub import RunEvent

if TYPE_CHECKING:
    from redis.asyncio import Redis

RUN_STREAM_FIELD: Final = "e"  # = RUN_STREAM_FIELD của packages/contracts hub/notify.ts
RUN_STREAM_MAXLEN: Final = 10_000
RUN_STREAM_TTL_S: Final = 86_400


def stream_key(run_id: str) -> str:
    return f"run:{run_id}"


def encode_event(event: RunEvent) -> str:
    """H2c F10: `job.result.outputs` (C2, tuỳ chọn) chỉ có khoá khi ≠ ∅ — không dump `null`
    (sự kiện giữ y hệt H2b khi job không có output). Nhận `job.result` theo `type` (review H2c v1
    #5), không theo tên lớp codegen `RunEventN` (đổi khi thứ tự `oneOf` đổi)."""
    root = event.root
    if root.type == "job.result" and root.outputs is None:
        return root.model_dump_json(exclude={"outputs"})
    return event.model_dump_json()


async def publish_run_event(client: Redis, run_id: str, event: RunEvent) -> None:
    """XADD `run:<run_id>` MAXLEN ~ 10000 field `e` + EXPIRE 86400 trong một pipeline."""
    key = stream_key(run_id)
    async with client.pipeline(transaction=False) as pipe:
        pipe.xadd(
            key,
            {RUN_STREAM_FIELD: encode_event(event)},
            maxlen=RUN_STREAM_MAXLEN,
            approximate=True,
        )
        pipe.expire(key, RUN_STREAM_TTL_S)
        await pipe.execute()
