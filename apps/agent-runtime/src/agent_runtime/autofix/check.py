"""WRK-FR-29 · HUB-BR-33 · P-c1 · PC-R08 kiểm diff bằng chương trình (plan-runtime §5.8).

Thứ tự, dừng ở nhóm trượt đầu: (0) mục `.git` trong workspace ⇒ `paths` (git bỏ qua chúng nên diff
không thấy — plan-runtime §5.3) · (1) đường dẫn `rules.check_paths` · (2) kích thước
`rules.check_size` (workspace quá trần ⇒ trượt TRƯỚC khi `git add` để không băm hàng GB) · (3)
bí mật `gitscan.scan_blob` trên NỘI DUNG blob mọi đường đổi (không theo diff: diff nhị phân/base85
giấu dòng thêm), blob quá `SCAN_BLOB_MAX`/tổng `SCAN_TOTAL_MAX` ⇒ `unscannable`. Bước (4) test
chạy trong container MỚI ở host (R3). Trượt ⇒ `diff=None` (không lưu diff, PC-R08); `failures`
≤ 50 (contract `AutofixReport.failures`).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agent_runtime.autofix.gitscan import (
    REGULAR_MODES,
    SCAN_BLOB_MAX,
    SCAN_TOTAL_MAX,
    RawChange,
    check_link_modes,
    scan_blob,
    unscannable,
)
from agent_runtime.autofix.rules import (
    DiffStats,
    Failure,
    Limits,
    check_paths,
    check_size,
    clip_detail,
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


_NULL = "0" * 40


def scan_changes(ws: Workspace, changes: list[RawChange]) -> list[Failure]:
    """PC-R08(3): đọc blob mới (+ blob base để chỉ báo dòng mới) của mọi file thường đổi."""
    files = [c for c in changes if c.status != "D" and c.new_mode in REGULAR_MODES]
    bases = [c.old_sha for c in files if c.old_mode in REGULAR_MODES and c.old_sha != _NULL]
    sizes = ws.blob_sizes(sorted({c.new_sha for c in files} | set(bases)))
    out: list[Failure] = []
    want: set[str] = set()
    total = 0
    for c in files:
        size = sizes.get(c.new_sha, SCAN_BLOB_MAX + 1)
        total += size
        if size > SCAN_BLOB_MAX or total > SCAN_TOTAL_MAX:
            out.append(unscannable(c.path, size))
            continue
        want.add(c.new_sha)
        if c.old_sha in sizes and sizes[c.old_sha] <= SCAN_BLOB_MAX:
            want.add(c.old_sha)
    data = ws.blobs(sorted(want))
    for c in files:
        if c.new_sha in data:
            out += scan_blob(c.path, data[c.new_sha], data.get(c.old_sha))
    return out


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
        changes = ws.raw_changes(head)
    except GitError as err:
        return _failed([_git_failure(err)], ws.base_sha)
    changed = [c.path for c in changes]
    groups: list[Callable[[], list[Failure]]] = [
        lambda: check_paths(changed, allowlist) + check_link_modes(changes),
        lambda: check_size(stats, ws_bytes, lim),
        lambda: scan_changes(ws, changes),
    ]
    for group in groups:
        try:
            failures = group()
        except GitError as err:
            failures = [_git_failure(err)]
        if failures:
            return _failed(failures, head, stats)
    return CheckResult([], diff, stats, head)


def _git_failure(err: GitError) -> Failure:
    return Failure("paths", rule="git", detail=clip_detail(err.stderr))
