"""WRK-FR-28 · P-c1 · `FakeOci` — giả lập container cho test (`RUNTIME_SANDBOX=fake`, chỉ
APP_ENV=test; spec §7, plan-runtime §5.8). KHÔNG cô lập gì: lệnh chạy `sh -c` thẳng trên host trong
thư mục workspace, HOME = `<workdir>/tmp`. Cùng giao diện `Oci` (`run/exec/rm/ps`).
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from agent_runtime.autofix.oci import ExecReq, ExecResult, OciError, run_proc
from agent_runtime.autofix.rules import GIT_PATH, Phase, SandboxSpec, container_name


class FakeOci:
    engine = "fake"

    def __init__(self, workdir: Path) -> None:
        self._dir = workdir
        self._boxes: dict[str, Path] = {}

    async def run(self, spec: SandboxSpec, phase: Phase) -> str:
        name = container_name(spec.job_id, phase)
        if name in self._boxes:
            raise OciError("run_failed", "name in use")
        ws = Path(spec.host_workspace)
        await asyncio.to_thread(self._prepare, ws)
        self._boxes[name] = ws
        return name

    def _prepare(self, ws: Path) -> None:
        if not ws.is_dir():
            raise OciError("run_failed", "workspace missing")
        (self._dir / "tmp").mkdir(parents=True, exist_ok=True)

    async def exec(self, name: str, req: ExecReq) -> ExecResult:
        ws = self._boxes.get(name)
        if ws is None:
            raise OciError("no_container", name)
        env = {
            "PATH": os.environ.get("PATH", GIT_PATH),
            "HOME": str(self._dir / "tmp"),
            "CI": "1",
            "LANG": "C.UTF-8",
        }
        return await run_proc(["sh", "-c", req.cmd, "_", *req.args], req, env, ws)

    async def rm(self, name: str) -> None:
        self._boxes.pop(name, None)

    async def ps(self) -> list[str]:
        return sorted(self._boxes)
