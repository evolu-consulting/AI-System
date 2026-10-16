"""DLC-R03…R09 · Một lần claim job `agent.cli` của provider `dlc`: tin chat → việc trên engine DLC →
theo dõi run tới khi xong / cần người / hết giờ job → `Outcome` (chữ trả lời + trạng thái hội
thoại).

Trạng thái hội thoại (dự án + run DLC hiện tại) giữ ở `hub.cli_sessions` (khoá hội thoại + agent +
provider + tenant, WRK-FR-14) dưới dạng JSON `DlcState` — Hub không đổi. Run DLC sống lâu hơn job:
hết `timeout_s` thì trả "vẫn đang chạy", tin sau (`trạng thái`) theo dõi tiếp. Huỷ job chat
**không** huỷ run DLC (lệnh `huỷ` mới huỷ).
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db import dlc_workflows_sql as presets
from agent_runtime.db.dlc_workflows_sql import DlcPreset
from agent_runtime.db.jobs_sql import ClaimedJob
from agent_runtime.events.job_events import Failure
from agent_runtime.runtimes.dlc import texts
from agent_runtime.runtimes.dlc.client import DlcClient, DlcError, Json
from agent_runtime.runtimes.dlc.intent import (
    Intent,
    answers_for,
    message_of,
    parse,
    split_preset,
)
from agent_runtime.runtimes.dlc.spec import SpecSource

if TYPE_CHECKING:
    from agent_runtime.runtimes.dlc.host import DlcJobHost

FINAL = frozenset({"green", "escalated"})
DEADLINE_MARGIN_S = 20.0  # trả lời trước khi Hub/Runtime coi job hết giờ
POLL_ERRORS_MAX = 5
DELTA_MAX = 1_900
UNREACHABLE = Failure("failed", "UPSTREAM_ERROR", "upstream", "DLC engine is not reachable")
_HEADING = re.compile(r"^\s*#\s+(.+?)\s*$", re.MULTILINE)
_NAME_MAX = 60

Say = Callable[[str], Awaitable[None]]


@dataclass
class DlcState:
    """Dự án + run DLC của một hội thoại (JSON trong `cli_sessions.session_id`)."""

    project: str | None = None
    run: str | None = None

    def encode(self) -> str:
        return json.dumps({"p": self.project, "r": self.run}, separators=(",", ":"))

    @classmethod
    def decode(cls, raw: str | None) -> DlcState:
        try:
            data = json.loads(raw or "{}")
        except ValueError:
            return cls()
        if not isinstance(data, dict):
            return cls()
        d = cast(dict[str, Any], data)
        p, r = d.get("p"), d.get("r")
        return cls(p if isinstance(p, str) else None, r if isinstance(r, str) else None)


@dataclass(frozen=True)
class Outcome:
    """`failure` None = thành công (`text`, `state` ghi vào session)."""

    failure: Failure | None
    text: str = ""
    state: DlcState | None = None


@dataclass
class Transcript:
    """Chữ đã nói (stream `job.delta` khi job có `stream`); câu trả lời cuối bắt đầu bằng đúng chữ
    này (Hub đối chiếu tiền tố)."""

    publish: Say | None
    text: str = ""

    async def say(self, chunk: str) -> None:
        if not chunk:
            return
        self.text += chunk
        if self.publish is None:
            return
        for i in range(0, len(chunk), DELTA_MAX):  # `job.delta.text` ≤ 4 000 (UTF-16 ≤ 2 × ký tự)
            await self.publish(chunk[i : i + DELTA_MAX])


def project_name(spec: str, conversation_id: str) -> str:
    m = _HEADING.search(spec)
    if m:
        return m.group(1)[:_NAME_MAX]
    first = next((ln.strip() for ln in spec.splitlines() if ln.strip()), "")
    return first[:_NAME_MAX] if first else f"chat-{conversation_id[:8]}"


class DlcRun:
    def __init__(
        self, host: DlcJobHost, job: ClaimedJob, payload: JobPayload1, state: DlcState
    ) -> None:
        self.host, self.job, self.p, self.state = host, job, payload, state
        self.out = Transcript(self._publish if payload.stream else None)
        self.deadline = time.monotonic() + max(payload.timeout_s - DEADLINE_MARGIN_S, 5.0)
        self.who = f"ai-system:{payload.user_id}"
        self.preset: DlcPreset | None = None  # DLC-R14: workflow chọn bằng `#key` ở đầu tin

    async def _publish(self, text: str) -> None:
        await self.host.events.delta(self.job, "done", text)

    async def execute(self) -> Outcome:
        async with self.host.client() as client:
            try:
                await self._dispatch(client)
            except DlcError as err:
                if err.retryable and not self.out.text:
                    return Outcome(UNREACHABLE)
                await self.out.say(texts.engine_error(err.code, err.message))
        return Outcome(None, self.out.text or texts.HELP, self.state)

    async def _dispatch(self, c: DlcClient) -> None:
        key, message = split_preset(message_of(self.p.prompt))
        if key is not None:
            async with self.host.pool.acquire() as conn:
                self.preset = await presets.preset_by_key(conn, key)
            if self.preset is None:
                await self.out.say(texts.unknown_workflow(key))
                return
        intent = parse(message)
        if intent.kind == "new":
            self.state = DlcState()
            intent = Intent("content", intent.text)
        if self.state.run is None:
            await self._first(c, intent)
            return
        await self._on_run(c, intent, self.state.run)

    async def _first(self, c: DlcClient, intent: Intent) -> None:
        spec = await self.spec(intent)
        if intent.kind not in ("content", "bug") or not spec:
            await self.out.say(texts.no_project())
            return
        await self._start(c, "new-system", spec)

    async def _on_run(self, c: DlcClient, intent: Intent, run: str) -> None:
        summary = cast(Json, (await c.run(run))["run"])
        final = summary.get("state") in FINAL
        kind = intent.kind
        if kind in ("pause", "resume", "cancel"):
            await c.act(run, kind, {"reason": f"{kind} from chat"} if kind != "resume" else None)
            if kind != "resume":
                await self.out.say(f"✔ Đã gửi lệnh `{kind}` cho run `{run}`.\n")
                return
        elif kind == "retry":
            hint = {"hint": intent.text} if intent.text else {}
            self.state.run = str((await c.act(run, "retry", hint))["run"])
            await self.out.say(texts.started("retry", self.state.project or "", self.state.run))
        elif kind == "app":
            await self.out.say(texts.green(run, summary, await self._app(c, run)))
            return
        elif kind in ("content", "bug") and final:
            await self._next_flow(c, intent)
            return
        elif kind in ("content", "bug"):
            if await self._answer(c, run, intent.text) == "asked":
                return
        else:
            await self.out.say(texts.following(run))
        await self.follow(c, cast(str, self.state.run))

    async def _next_flow(self, c: DlcClient, intent: Intent) -> None:
        spec = await self.spec(intent)
        if not spec or self.state.project is None:
            await self.out.say(texts.HELP)
            return
        has_code = bool(
            cast(Json, (await c.project(self.state.project))["project"]).get("has_code")
        )
        if not has_code:
            await self._start(c, "new-system", spec)
        else:
            await self._start(c, "bug-fix" if intent.kind == "bug" else "enhancement", spec)

    async def _answer(self, c: DlcClient, run: str, message: str) -> str:
        """Run đang đỗ chờ câu hỏi → tin là câu trả lời (`answered`); không đọc được câu trả lời →
        nhắc lại câu hỏi (`asked`); run không chờ câu hỏi → `running` (theo dõi tiếp)."""
        items = await _open_questions(c, run)
        if not items:
            await self.out.say(texts.following(run))
            return "running"
        answers = answers_for(message, items)
        if not answers:
            await self.out.say(texts.questions(run, items))
            return "asked"
        res = await c.answer(run, self.who, answers)
        await self.out.say(texts.answered(int(res.get("remaining") or 0)))
        return "answered"

    # ---------- bắt đầu run (FRONTEND-INTEGRATION §5.1–5.3) ----------

    async def _preset_for(self, flow: str) -> DlcPreset | None:
        """Workflow `#key` của tin, không có thì workflow mặc định của process (Evolu Control)."""
        if self.preset is not None:
            return self.preset
        async with self.host.pool.acquire() as conn:
            return await presets.default_preset(conn, flow)

    async def _start(self, c: DlcClient, flow: str, spec: str) -> None:
        if self.preset is not None:
            flow = self.preset.process
        preset = await self._preset_for(flow)
        name = project_name(spec, str(self.p.conversation_id))
        if self.state.project is None:
            desc = f"From AI System conversation {self.p.conversation_id}"
            self.state.project = str((await c.create_project(name, desc))["id"])
        pack = await c.create_pack(_pack_body(flow, name, spec))
        body: Json = {"pack": pack, "project": self.state.project, "flow": flow, "name": name}
        body.update(_run_options(preset, self.host.cfg.human_mode))
        self.state.run = await c.start_run(body)
        key = preset.key if preset else None
        await self.out.say(texts.started(flow, self.state.project, self.state.run, key))
        await self.follow(c, self.state.run)

    async def spec(self, intent: Intent) -> str:
        return await SpecSource(self.host, self.job, self.p).text(intent.text)

    # ---------- theo dõi (FRONTEND-INTEGRATION §7) ----------

    async def follow(self, c: DlcClient, run: str) -> None:
        last: str | None = None
        merged = -1
        while True:
            summary = await self._poll(c, run)
            state = str(summary.get("state", ""))
            units = cast(dict[str, int], summary.get("unit_states") or {}).get("merged", 0)
            if state != last:
                await self.out.say(texts.state_line(state, summary))
            elif units != merged and units > 0:
                await self.out.say(texts.merged_line(summary))
            last, merged = state, units
            if await self._settled(c, run, summary):
                return
            if time.monotonic() >= self.deadline:
                await self.out.say(texts.still_running(run))
                return
            await asyncio.sleep(self.host.cfg.poll_s)

    async def _poll(self, c: DlcClient, run: str) -> Json:
        for attempt in range(1, POLL_ERRORS_MAX + 1):
            try:
                return cast(Json, (await c.run(run))["run"])
            except DlcError as err:
                if not err.retryable or attempt == POLL_ERRORS_MAX:
                    raise
                await asyncio.sleep(min(2.0**attempt, 30.0))
        raise AssertionError  # pragma: no cover

    async def _settled(self, c: DlcClient, run: str, summary: Json) -> bool:
        """Run xong, hoặc cần người (câu hỏi, hook giữ, tạm dừng) → đã nói câu cuối, True."""
        state = summary.get("state")
        if state == "green":
            await self.out.say(texts.green(run, summary, await self._app(c, run)))
            return True
        if state == "escalated":
            await self.out.say(texts.escalated(run, summary, await self._attention(c, run)))
            return True
        view = await self._attention(c, run)
        kind = (view or {}).get("kind")
        if kind == "questions":
            await self.out.say(texts.questions(run, await _open_questions(c, run)))
            return True
        if kind == "hook":
            await self.out.say(texts.attention(run, cast(Json, view)))
            return True
        if kind == "paused" or summary.get("paused"):
            await self.out.say(texts.paused(run))
            return True
        return False

    async def _attention(self, c: DlcClient, run: str) -> Json | None:
        try:
            return await c.attention(run)
        except DlcError:
            return None

    async def _app(self, c: DlcClient, run: str) -> Json | None:
        """Run xong → bật app đã triển khai (hoặc lấy app đang chạy); lỗi → None (không chặn câu
        trả lời)."""
        try:
            return await c.app(run, start=True)
        except DlcError:
            return None


async def _open_questions(c: DlcClient, run: str) -> list[Json]:
    q = await c.questions(run)
    if not q.get("parked"):
        return []
    items = cast(list[Json], q.get("questions") or [])
    return [x for x in items if x.get("state") in ("open", "held")]


def _run_options(preset: DlcPreset | None, human_mode: str | None) -> Json:
    """Tuỳ chọn run: chế độ hỏi người + lane của workflow; vắng thì `AGENT_RT_DLC_HUMAN_MODE` /
    engine tự quyết."""
    out: Json = {}
    mode = (preset.human_mode if preset else None) or human_mode
    if mode:
        out["human_mode"] = mode
    if preset and preset.lane:
        out["lane"] = preset.lane
    return out


def _pack_body(flow: str, name: str, spec: str) -> Json:
    if flow == "bug-fix":
        return {"kind": "bug", "title": name, "report": spec}
    return {"kind": "new" if flow == "new-system" else "enhance", "name": name, "spec": spec}
