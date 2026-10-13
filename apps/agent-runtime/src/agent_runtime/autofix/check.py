"""WRK-FR-29 · HUB-BR-33 · P-c1 · PC-R08 kiểm diff bằng chương trình (plan-runtime §5.8).

Thứ tự, dừng ở nhóm trượt đầu: (0) mục `.git` trong workspace ⇒ `paths` (git bỏ qua chúng nên diff
không thấy — plan-runtime §5.3) · (1) đường dẫn `rules.check_paths` · (2) kích thước
`rules.check_size` (workspace quá trần ⇒ trượt TRƯỚC khi `git add` để không băm hàng GB) · (3)
bí mật
`rules.scan_secrets`. Bước (4) test chạy trong container MỚI ở host (R3). Trượt ⇒ `diff=None`
(không lưu diff, PC-R08); `failures` ≤ 50 (contract `AutofixReport.failures`).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agent_runtime.autofix.rules import (
    DiffStats,
    Failure,
    Limits,
    check_paths,
    check_size,
    clip_detail,
    scan_secrets,
)
from agent_runtime.autofix.workspace import GitError, Workspace

AUTOFIX_FAILURES_MAX = 50

Status = Literal["ok", "no_changes", "check_failed"]


@dataclass(frozen=True)
class CheckResult:
    failures: list[Failure]
    diff: str | None
    stats: DiffStats | None
    head_sha: str

    @property
    def status(self) -> Status:
        """Trạng thái trước bước test: trượt ⇒ `check_failed`; diff rỗng ⇒ `no_changes` (PC-R09)."""
        if self.failures:
            return "check_failed"
        return "ok" if self.diff else "no_changes"


def _failed(failures: list[Failure], head_sha: str, stats: DiffStats | None = None) -> CheckResult:
    return CheckResult(failures[:AUTOFIX_FAILURES_MAX], None, stats, head_sha)


def run_checks(ws: Workspace, allowlist: list[str], lim: Limits) -> CheckResult:
    """PC-R08 (1)–(3) trên workspace sau khi agent xong (container agent đã xoá)."""
    bad = ws.git_entries()
    if bad:
        detail = "`.git` trong workspace (PB-R07)"
        fs = [Failure("paths", path=p[:1024], rule="forbidden_name", detail=detail) for p in bad]
        return _failed(fs, ws.base_sha)
    ws_bytes = ws.ws_bytes()
    early = check_size(DiffStats(0, 0, 0, 0), ws_bytes, lim)
    if early:
        return _failed(early, ws.base_sha)
    try:
        diff, stats, head = ws.diff(lim.max_diff_bytes)
        changed = ws.changed_paths(head)
    except GitError as err:
        return _failed([Failure("paths", rule="git", detail=clip_detail(err.stderr))], ws.base_sha)
    groups: list[Callable[[], list[Failure]]] = [
        lambda: check_paths(changed, allowlist),
        lambda: check_size(stats, ws_bytes, lim),
        lambda: scan_secrets(diff),
    ]
    for group in groups:
        failures = group()
        if failures:
            return _failed(failures, head, stats)
    return CheckResult([], diff, stats, head)
