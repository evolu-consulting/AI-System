"""WRK-FR-04 · WRK-FR-05 · AC-W03 · AC-W10 · Provider giả `fake-cli` — phần PY-06 (plan-runtime-fake
§7): chỉ thị `#fake:sleep=<s>` (progress mỗi 1 s) và `#fake:spawn-child` (`sleep 300` cùng group),
không chỉ thị → echo. Chạy trong job host như provider thật.

TODO(WRK-FR-10): PY-09 — `msg` theo `<message>` cho Orchestrator, `FAKE_TAIL`, delegate/ask/partial/
need_input, read/tool (hook), ratelimit, badjson, crash, usage, session, env.
"""

from __future__ import annotations

import asyncio
import re

from agent_runtime.providers.base import Emit, Final, Progress, ProviderJob

KEY = "fake-cli"
_DIRECTIVE = re.compile(r"#fake:([a-z-]+)(?:=(\S+))?")


def directives(msg: str) -> dict[str, str]:
    return {m.group(1): m.group(2) or "" for m in _DIRECTIVE.finditer(msg)}


def clean(msg: str) -> str:
    return " ".join(_DIRECTIVE.sub(" ", msg).split())


def _seconds(raw: str | None) -> float:
    try:
        return max(0.0, float(raw or 0))
    except ValueError:
        return 0.0


async def _sleep(total_s: float, emit: Emit) -> None:
    done = 0.0
    while done < total_s:
        step = min(1.0, total_s - done)
        await asyncio.sleep(step)
        done += step
        await emit(Progress(label=f"fake sleep {int(done)}s"))


def _final(job: ProviderJob, text: str) -> Final:
    if job.payload.output == "agent_result":
        return Final(kind="agent_result", structured={"status": "done", "text": text})
    return Final(kind="text", text=text)


class FakeProvider:
    key = KEY

    async def run(self, job: ProviderJob, emit: Emit) -> None:
        msg = job.payload.prompt
        found = directives(msg)
        if "spawn-child" in found:
            # Cùng process group với job host (không start_new_session) — AC-W10.
            await asyncio.create_subprocess_exec(
                "sleep",
                "300",
                cwd=job.work_dir,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,  # không giữ pipe giao thức của job host
            )
        if "sleep" in found:
            await _sleep(_seconds(found["sleep"]), emit)
        await emit(_final(job, f"echo: {clean(msg)}".strip()))
