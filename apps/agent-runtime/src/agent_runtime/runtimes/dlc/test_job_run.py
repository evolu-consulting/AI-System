"""DLC-R03…R09 · `DlcRun` trên một engine DLC giả (`httpx2.MockTransport`): New System → xong + app,
run đỗ → câu hỏi → trả lời, Enhancement / Bug Fix sau khi xong, hết giờ job, engine không tới
được."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, cast

import httpx2

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.runtimes.dlc.client import DlcClient
from agent_runtime.runtimes.dlc.host import DlcConfig, DlcJobHost
from agent_runtime.runtimes.dlc.job_run import UNREACHABLE, DlcRun, DlcState, project_name

SPEC = "# Thư viện\n\n## F1 Mượn sách\n\n`borrow ID` ghi nhận lượt mượn.\n"


@dataclass
class Engine:
    """Engine DLC giả: mỗi `GET /api/runs/{r}` đi tiếp một bước của `script`."""

    script: list[str] = field(default_factory=lambda: ["understanding", "building", "green"])
    questions: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    has_code: bool = False
    calls: list[tuple[str, str, Any]] = field(default_factory=list[tuple[str, str, Any]])
    step: int = 0
    down: bool = False

    def state(self) -> str:
        return self.script[min(self.step, len(self.script) - 1)]

    def summary(self) -> dict[str, Any]:
        merged = 2 if self.state() == "green" else 1
        return {
            "id": "R1",
            "state": self.state(),
            "units": 2,
            "unit_states": {"merged": merged},
            "detail": {"spent_usd": 1.25},
            "paused": False,
        }

    def handle(self, req: httpx2.Request) -> httpx2.Response:
        if self.down:
            raise httpx2.ConnectError("down", request=req)
        body = json.loads(req.content) if req.content else None
        path = req.url.path
        self.calls.append((req.method, path, body))
        status, data = self._route(req.method, path, body)
        return httpx2.Response(status, json=data)

    def _route(self, method: str, path: str, body: Any) -> tuple[int, Any]:
        routes: dict[tuple[str, str], Any] = {
            ("POST", "/api/projects"): (201, {"id": "thu-vien", "name": "Thư viện"}),
            ("GET", "/api/projects/thu-vien"): (
                200,
                {"project": {"id": "thu-vien", "has_code": self.has_code}},
            ),
            ("POST", "/api/packs"): (201, {"pack": "/packs/p1"}),
            ("POST", "/api/runs"): (202, {"run": "R1", "state": "admitted"}),
            ("GET", "/api/runs/R1/attention"): (200, self._attention()),
            ("GET", "/api/runs/R1/questions"): (200, self._questions()),
            ("POST", "/api/runs/R1/app:start"): (
                200,
                {"state": "running", "url": "http://h:9100/"},
            ),
            ("POST", "/api/runs/R1:retry"): (202, {"run": "R2", "state": "admitted"}),
            ("POST", "/api/runs/R1:pause"): (200, {"run": "R1", "paused": True}),
        }
        if (method, path) == ("GET", "/api/runs/R1"):
            got = (200, {"run": self.summary()})
            self.step += 1
            return got
        if (method, path) == ("POST", "/api/runs/R1/answers"):
            self.questions = []
            return 200, {"remaining": 0, "resume": True}
        return routes.get((method, path), (404, {"code": "NOT_FOUND", "message": path}))

    def _attention(self) -> dict[str, Any]:
        return {"needed": True, "kind": "questions"} if self.questions else {"kind": "none"}

    def _questions(self) -> dict[str, Any]:
        return {"parked": bool(self.questions), "questions": self.questions}


@dataclass
class Events:
    deltas: list[str] = field(default_factory=list[str])

    async def delta(self, job: ClaimedJob, kind: str, text: str) -> None:
        assert kind == "done"
        self.deltas.append(text)


PRESETS: dict[str, dict[str, Any]] = {
    "quick-fix": {
        "key": "quick-fix",
        "process": "bug-fix",
        "human_mode": "decide",
        "lane": "trivial",
    },
    "dlc-new": {"key": "dlc-new", "process": "new-system", "human_mode": None, "lane": "full"},
}


class Conn:
    async def fetchrow(self, query: str, *args: object) -> dict[str, Any] | None:
        if "WHERE key" in query:
            return PRESETS.get(str(args[0]))
        return next((p for p in PRESETS.values() if p["process"] == args[0]), None)


class Pool:
    @asynccontextmanager
    async def acquire(self) -> AsyncGenerator[Conn]:
        yield Conn()


class Host:
    def __init__(self, engine: Engine) -> None:
        self.pool = Pool()
        self.events = Events()
        self.cfg = DlcConfig("w", "http://dlc", poll_s=0.001, human_mode="ask")
        self._transport = httpx2.MockTransport(engine.handle)

    def client(self) -> DlcClient:
        return DlcClient(self.cfg.base_url, None, self._transport)


def payload(prompt: str, *, stream: bool = True, timeout_s: int = 60) -> JobPayload1:
    ids = {k: str(uuid.uuid4()) for k in ("job_id", "run_id", "step_id", "tenant_id", "user_id")}
    data: dict[str, Any] = {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        **ids,
        "conversation_id": str(uuid.uuid4()),
        "flow_id": str(uuid.uuid4()),
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {"id": str(uuid.uuid4()), "key": "dlc", "role": "agent"},
        "provider_key": "dlc",
        "model": None,
        "step_index": 0,
        "max_turns": 30,
        "profile_steps": [{"provider_key": "dlc", "model": None, "on": []}],
        "system_prompt": "",
        "prompt": prompt,
        "history": [],
        "use_session": True,
        "allowed_tools": [],
        "output": "agent_result",
        "timeout_s": timeout_s,
        "stream": stream,
    }
    return JobPayload1.model_validate(data)


async def run_once(engine: Engine, prompt: str, state: DlcState | None = None, **kw: Any):
    host = Host(engine)
    p = payload(prompt, **kw)
    job = ClaimedJob(str(p.job_id), p.model_dump(mode="json"), token="t")
    run = DlcRun(cast(DlcJobHost, host), job, p, state or DlcState())
    return await run.execute(), host.events


def posted(engine: Engine, path: str) -> list[Any]:
    return [b for m, p, b in engine.calls if m == "POST" and p == path]


async def test_dlc_r05_new_system_runs_to_green_and_starts_app() -> None:
    engine = Engine()
    out, events = await run_once(engine, SPEC)
    assert out.failure is None and out.state == DlcState("thu-vien", "R1")
    assert posted(engine, "/api/packs") == [
        {"kind": "new", "name": "Thư viện", "spec": SPEC.strip()}
    ]
    run_body = posted(engine, "/api/runs")[0]
    # workflow mặc định của new-system (`dlc-new`): lane full; human_mode vắng → env Runtime
    assert run_body["flow"] == "new-system" and run_body["human_mode"] == "ask"
    assert run_body["lane"] == "full" and "#dlc-new" in out.text
    assert "✅ **Xong**" in out.text and "http://h:9100/" in out.text and "1.25 USD" in out.text
    assert "".join(events.deltas) == out.text  # câu trả lời cuối = đúng phần đã stream


async def test_dlc_r05_no_spec_and_no_project_gives_help() -> None:
    engine = Engine()
    out, _ = await run_once(engine, "trạng thái")
    assert out.failure is None and "Chưa có dự án" in out.text and engine.calls == []


async def test_dlc_r06_parked_run_lists_questions_then_answer_resumes() -> None:
    q = {
        "qid": "Q1",
        "state": "open",
        "decision": "Thời hạn mượn?",
        "options": [{"id": "a", "text": "14 ngày"}, {"id": "b", "text": "30 ngày"}],
        "recommended": "a",
    }
    engine = Engine(script=["understanding"], questions=[q])
    out, _ = await run_once(engine, SPEC)
    assert "❓" in out.text and "`a` 14 ngày _(đề xuất)_" in out.text
    engine.script = ["building", "green"]
    engine.step = 0
    out2, _ = await run_once(engine, "1: b", out.state)
    assert posted(engine, "/api/runs/R1/answers")[0]["answers"] == [{"qid": "Q1", "option": "b"}]
    assert "✔ Đã ghi câu trả lời" in out2.text and "✅ **Xong**" in out2.text


async def test_dlc_r07_after_green_content_starts_enhancement_and_bug_fix() -> None:
    engine = Engine(script=["green"], has_code=True)
    out, _ = await run_once(
        engine, "# Xuất CSV\n\n## F1 Xuất danh sách ra CSV", DlcState("thu-vien", "R1")
    )
    assert posted(engine, "/api/runs")[0]["flow"] == "enhancement" and out.failure is None
    engine.calls.clear()
    await run_once(engine, "lỗi: mượn sách quá hạn không báo", DlcState("thu-vien", "R1"))
    assert posted(engine, "/api/packs")[0]["kind"] == "bug"
    assert posted(engine, "/api/runs")[0]["flow"] == "bug-fix"


async def test_dlc_r07_retry_with_hint_follows_new_run() -> None:
    engine = Engine(script=["escalated"])
    out, _ = await run_once(engine, "thử lại: dùng sqlite", DlcState("thu-vien", "R1"))
    assert posted(engine, "/api/runs/R1:retry") == [{"hint": "dùng sqlite"}]
    assert out.state == DlcState("thu-vien", "R2")


async def test_dlc_r08_job_deadline_answers_still_running() -> None:
    engine = Engine(script=["building"])
    t0 = time.monotonic()
    out, _ = await run_once(engine, "trạng thái", DlcState("thu-vien", "R1"), timeout_s=10)
    assert "vẫn đang chạy" in out.text and time.monotonic() - t0 < 9


async def test_dlc_r08_pause_command() -> None:
    engine = Engine(script=["building"])
    out, _ = await run_once(engine, "tạm dừng", DlcState("thu-vien", "R1"))
    assert posted(engine, "/api/runs/R1:pause") and "`pause`" in out.text


async def test_dlc_r09_engine_unreachable_fails_job() -> None:
    engine = Engine(down=True)
    out, _ = await run_once(engine, SPEC)
    assert out.failure == UNREACHABLE


def test_dlc_r09_state_roundtrip_and_bad_json() -> None:
    s = DlcState("p", "R1")
    assert DlcState.decode(s.encode()) == s
    assert DlcState.decode("not json") == DlcState() and DlcState.decode(None) == DlcState()


def test_dlc_r05_project_name_from_heading_or_first_line() -> None:
    assert project_name(SPEC, "abcdef123") == "Thư viện"
    assert project_name("Quản lý kho\nchi tiết", "c") == "Quản lý kho"
    assert project_name("", "abcdef123") == "chat-abcdef12"


async def test_dlc_r14_hash_key_picks_workflow_process_and_options() -> None:
    engine = Engine(script=["green"], has_code=True)
    out, _ = await run_once(
        engine, "#quick-fix list --priority sai thứ tự", DlcState("thu-vien", "R1")
    )
    assert posted(engine, "/api/packs")[0]["kind"] == "bug"
    body = posted(engine, "/api/runs")[0]
    assert (
        body["flow"] == "bug-fix" and body["human_mode"] == "decide" and body["lane"] == "trivial"
    )
    assert "#quick-fix" in out.text


async def test_dlc_r14_unknown_workflow_key() -> None:
    engine = Engine()
    out, _ = await run_once(engine, "#khong-co " + SPEC)
    assert "Không có workflow DLC `#khong-co`" in out.text and engine.calls == []
