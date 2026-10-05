"""H2c · WRK-FR-18 · R25 — đẩy file `out/` của job agent lên Hub (plan-runtime H2c §5).

Stub PY-00: chữ ký; thân ở PY-03.
"""

from pathlib import Path

from agent_runtime.runtimes.cli.files.fetch import FilesCall


async def send_outputs(call: FilesCall, out: Path) -> tuple[str, ...]:
    """`pick_outputs` → POST `/internal/jobs/{id}/outputs` từng file; trả id (≤ 5). Không làm job
    `failed`; huỷ/hết hạn ⇒ ngừng, giữ id đã có."""
    raise NotImplementedError
