"""HUB-FR-129 · WRK-FR-29 · P-c2 · R3 · `FakeApplyHost` — job `source.apply` giả cho demo/UAT
(plan-runtime §5.3), song song `#fake:` của fake-cli: KHÔNG GitHub thật, không git, không sandbox.

Chỉ thị nằm trong `test_cmd` của payload (seed/prompt): `#fake:apply=<kind>[,rebased]`
- `pushed` (mặc định khi chỉ có `,rebased`) · `no_changes` (ref từ xa đã = HEAD ⇒ pushed, head=pin)
- `conflict[:a.js|b.js]` · `check_failed` · `failed[:auth|no_credential|push_rejected|network]`
Vắng chỉ thị ⇒ chạy `ApplyHost` thật (bare repo + insteadOf, test-plan T3). Chỉ dùng khi
`APP_ENV≠production` (nối ở `queue/runtime.start`). Báo cáo đi đúng đường `report.post_result`.
"""

from __future__ import annotations

import re
from hashlib import sha1
from pathlib import Path

from agent_runtime.apply.host import ApplyHost
from agent_runtime.apply.report import ApplyCode, ApplyReport
from agent_runtime.autofix.report import TestRun
from agent_runtime.autofix.rules import Failure
from agent_runtime.contracts.hub import SourceApplyJob
from agent_runtime.db import apply_sql

_DIRECTIVE = re.compile(r"#fake:apply=([a-z_]+)(?::([^\s,]*))?(,rebased)?")
_CODES: tuple[ApplyCode, ...] = ("auth", "no_credential", "push_rejected", "network")
_DEFAULT_FILES = ["src/sum.js"]


def parse(test_cmd: str) -> tuple[str, str | None, bool] | None:
    """`(kind, arg, rebased)` hoặc None khi không có chỉ thị."""
    m = _DIRECTIVE.search(test_cmd)
    if m is None:
        return None
    return m.group(1), m.group(2) or None, m.group(3) is not None


def _fake_sha(seed: str) -> str:
    return sha1(seed.encode(), usedforsecurity=False).hexdigest()


def build_report(payload: SourceApplyJob) -> ApplyReport | None:
    """Báo cáo giả theo chỉ thị; None ⇒ không chỉ thị / kind lạ (dùng luồng thật)."""
    parsed = parse(payload.test_cmd)
    if parsed is None:
        return None
    kind, arg, rebased = parsed
    pin = payload.pin_sha
    target = _fake_sha(pin + "target") if rebased else pin
    if kind == "no_changes":
        return ApplyReport("pushed", target, head_sha=pin, rebased=rebased)
    if kind == "pushed":
        test = TestRun(exit_code=0, duration_ms=1, log="1 pass") if rebased else None
        head = _fake_sha(target + payload.branch)
        return ApplyReport("pushed", target, head_sha=head, rebased=rebased, test=test)
    if kind == "conflict":
        files = arg.split("|") if arg else _DEFAULT_FILES
        return ApplyReport("conflict", target, rebased=rebased, conflict_files=files)
    if kind == "check_failed":
        fail = Failure("tests", rule="exit_code", detail="test_cmd exit 1 (fake)")
        test = TestRun(exit_code=1, duration_ms=1, log="1 fail: sum")
        return ApplyReport("check_failed", target, rebased=True, failures=[fail], test=test)
    if kind == "failed":
        code: ApplyCode = arg if arg in _CODES else "network"  # type: ignore[assignment]
        return ApplyReport("failed", None, code=code, detail="fake: failed")
    return None


class FakeApplyHost(ApplyHost):
    """`ApplyHost` thay `_run_apply`: có chỉ thị ⇒ báo cáo giả; không ⇒ luồng thật."""

    async def _run_apply(
        self, job: apply_sql.ApplyJob, payload: SourceApplyJob, job_dir: Path
    ) -> ApplyReport:
        rep = build_report(payload)
        if rep is not None:
            return rep
        return await super()._run_apply(job, payload, job_dir)
