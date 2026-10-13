"""HUB-FR-126 · HUB-FR-128 · WRK-FR-29 · HUB-BR-32 · P-c1 · Workspace tự-sửa (plan-runtime
§5.3, §5.8).

PC-R05: bản sao GHI ĐƯỢC của snapshot đã lọc (PB-R07, không `.git`) ở `work/<job>/workspace/<key>/`;
git riêng `work/<job>/git/` NGOÀI mount, chạy trên host với cấu hình cứng (`rules.git_env` +
`GIT_SAFE_ARGS`, ADR-0011 #4). Commit `base` → nhánh → (PC-R11) áp `base_patch` + commit; cuối job
commit vòng hiện tại rồi `diff --binary --no-ext-diff --no-textconv base HEAD` (cộng dồn).

Hai bước tách được (`copy_workspace` → [pha cài ở host R3] → `init_git`) vì PC-R05 commit `base`
SAU pha cài; `prepare` = cả hai (không pha cài). Trần `RUNTIME_AUTOFIX_MAX_MB/_FILES` áp lúc chép
(G12: vượt ⇒ `WorkspaceError(Failure(check="size"))`). Đồng bộ (subprocess) — host gọi qua
`asyncio.to_thread`.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from agent_runtime.autofix.rules import (
    GIT_PATH,
    GIT_SAFE_ARGS,
    DiffStats,
    Failure,
    Limits,
    clip_detail,
    git_env,
)
from agent_runtime.sources.filter import segment_secret

WORKSPACE_SUBDIR = "workspace"
GIT_SUBDIR = "git"
DIFF_FILE = "autofix.diff"  # trong job_dir, NGOÀI workspace (container không thấy)
NULL_SHA = "0" * 40  # chưa có commit (trượt trước `git init`) — vẫn khớp `^[0-9a-f]{40}$`
GIT_TIMEOUT_S = 300
_MIB = 1024 * 1024
_KEY_RE = re.compile(r"^[a-z0-9-]{1,32}$")
_BRANCH_RE = re.compile(r"^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$")
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
# Tên git bỏ qua/từ chối khi `add` (protectNTFS/HFS): `.git` mọi hoa-thường + tên ngắn NTFS.
_GIT_NAME_RE = re.compile(r"^(\.git|git~\d+)$", re.IGNORECASE)


@dataclass(frozen=True)
class CopyCaps:
    """Trần bản sao (PC-R04) — mặc định = `RUNTIME_AUTOFIX_MAX_MB=200` / `_MAX_FILES=20000`."""

    max_files: int = 20_000
    max_bytes: int = 200 * _MIB


class GitError(Exception):
    """git trả mã ≠ 0 / hết giờ. `stderr` đã cắt, chưa che — dùng `clip_detail` trước khi gửi."""

    def __init__(self, op: str, stderr: str) -> None:
        super().__init__(f"git {op} failed")
        self.op = op
        self.stderr = stderr


class WorkspaceError(Exception):
    """Trượt lúc dựng workspace ⇒ host báo `check_failed` với `failure` (không chạy agent)."""

    def __init__(self, failure: Failure, base_sha: str = NULL_SHA) -> None:
        super().__init__(f"workspace {failure.check}: {failure.rule or ''}")
        self.failure = failure
        self.base_sha = base_sha


def _git_bin() -> str:
    return shutil.which("git", path=GIT_PATH) or "git"


def run_git(git_dir: Path, ws_dir: Path, args: list[str], stdin: bytes | None = None) -> bytes:
    """`git <SAFE_ARGS> <args>` với env cứng (không kế thừa env host), cwd = workspace."""
    try:
        proc = subprocess.run(  # noqa: S603 — mảng đối số, không shell
            [_git_bin(), *GIT_SAFE_ARGS, *args],
            input=stdin,
            capture_output=True,
            env=git_env(git_dir, ws_dir),
            cwd=ws_dir,
            timeout=GIT_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired as err:
        raise GitError(args[0], "timeout") from err
    if proc.returncode != 0:
        raise GitError(args[0], proc.stderr.decode("utf-8", "replace")[-2000:])
    return proc.stdout


# ---------- chép snapshot (trần G12) ----------


class _Count:
    def __init__(self, caps: CopyCaps) -> None:
        self.caps = caps
        self.files = 0
        self.bytes = 0

    def add(self, size: int) -> None:
        self.files += 1
        self.bytes += size
        if self.files > self.caps.max_files:
            detail = f"> {self.caps.max_files} file (RUNTIME_AUTOFIX_MAX_FILES)"
            raise WorkspaceError(Failure("size", rule="autofix_max_files", detail=detail))
        if self.bytes > self.caps.max_bytes:
            detail = f"> {self.caps.max_bytes} bytes (RUNTIME_AUTOFIX_MAX_MB)"
            raise WorkspaceError(Failure("size", rule="autofix_max_bytes", detail=detail))


def _copy_tree(src: Path, dst: Path, count: _Count) -> None:
    dst.mkdir(mode=0o755, exist_ok=True)
    for entry in os.scandir(src):
        if segment_secret(entry.name):
            continue  # phòng thủ: snapshot đã lọc PB-R07 (không `.git`)
        s, d = Path(entry.path), dst / entry.name
        if entry.is_dir(follow_symlinks=False):
            _copy_tree(s, d, count)
        elif entry.is_file(follow_symlinks=False):
            st = entry.stat(follow_symlinks=False)
            count.add(st.st_size)
            shutil.copyfile(s, d, follow_symlinks=False)
            os.chmod(d, 0o755 if st.st_mode & 0o111 else 0o644)


def ws_path(job_dir: Path, key: str) -> Path:
    if not _KEY_RE.match(key):
        raise ValueError("workspace key không hợp lệ")
    return job_dir / WORKSPACE_SUBDIR / key


def copy_workspace(job_dir: Path, snapshot: Path, key: str, caps: CopyCaps) -> Path:
    """Chép snapshot (chỉ-đọc) → `job_dir/workspace/<key>/` ghi được. Vượt trần ⇒ xoá bản dở +
    `WorkspaceError(size)`."""
    ws_dir = ws_path(job_dir, key)
    if ws_dir.exists():
        shutil.rmtree(ws_dir)
    ws_dir.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    try:
        _copy_tree(snapshot, ws_dir, _Count(caps))
    except BaseException:
        shutil.rmtree(ws_dir, ignore_errors=True)
        raise
    return ws_dir


def git_entries(ws_dir: Path) -> list[str]:
    """Đường dẫn tương đối của mọi mục tên `.git` (mọi hoa-thường, cả file) trong workspace — git bỏ
    qua/từ chối chúng khi `add` nên phải bắt riêng (plan-runtime §5.3, PB-R07). Không theo
    symlink."""
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(ws_dir, followlinks=False):
        rel = Path(dirpath).relative_to(ws_dir).as_posix()
        prefix = "" if rel == "." else rel + "/"
        out.extend(prefix + n for n in (*dirnames, *filenames) if _GIT_NAME_RE.match(n))
        dirnames[:] = [d for d in dirnames if not _GIT_NAME_RE.match(d)]
    return sorted(out)


def dir_bytes(path: Path) -> int:
    """Tổng kích thước biểu kiến (lstat, không theo symlink) — `du` workspace (ADR-0011 #3)."""
    total = 0
    for dirpath, _, filenames in os.walk(path, followlinks=False):
        for name in filenames:
            try:
                total += os.lstat(Path(dirpath, name)).st_size
            except OSError:
                continue
    return total


# ---------- git ----------


def _parse_numstat(raw: bytes) -> tuple[list[str], int, int]:
    """`--numstat -z --no-renames`: `ins\\tdel\\tpath\\0`; nhị phân = `-\\t-`."""
    paths: list[str] = []
    ins = dels = 0
    for rec in raw.split(b"\0"):
        if not rec:
            continue
        a, d, path = rec.split(b"\t", 2)
        paths.append(path.decode("utf-8", "replace"))
        ins += int(a) if a.isdigit() else 0
        dels += int(d) if d.isdigit() else 0
    return paths, ins, dels


@dataclass(frozen=True)
class Workspace:
    job_dir: Path
    ws_dir: Path
    git_dir: Path
    base_sha: str
    branch: str

    def git(self, args: list[str], stdin: bytes | None = None) -> bytes:
        return run_git(self.git_dir, self.ws_dir, args, stdin)

    def ws_bytes(self) -> int:
        return dir_bytes(self.ws_dir)

    def git_entries(self) -> list[str]:
        return git_entries(self.ws_dir)

    def head(self) -> str:
        return self.git(["rev-parse", "HEAD"]).decode().strip()

    def commit(self, message: str = "autofix: round") -> str:
        """`add -A` + commit nếu có thay đổi (không commit rỗng) ⇒ SHA HEAD."""
        self.git(["add", "-A"])
        try:
            self.git(["diff", "--cached", "--quiet"])
        except GitError:
            self.git(["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", message])
        return self.head()

    def changed_paths(self, head: str = "HEAD") -> list[str]:
        raw = self.git(["diff", "--numstat", "-z", "--no-renames", self.base_sha, head])
        return _parse_numstat(raw)[0]

    def diff(self, max_bytes: int = Limits().max_diff_bytes) -> tuple[str, DiffStats, str]:
        """Commit vòng hiện tại rồi diff `base..HEAD` ⇒ (diff, stats, head_sha). Diff ghi ra file
        ngoài workspace; trả tối đa `max_bytes + 1` byte (vượt trần thì `check_size` trượt trước
        khi dùng nội dung) — `stats.bytes` luôn là kích thước thật."""
        head = self.commit()
        raw = self.git(["diff", "--numstat", "-z", "--no-renames", self.base_sha, head])
        paths, ins, dels = _parse_numstat(raw)
        out = self.job_dir / DIFF_FILE
        args = ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-color"]
        args += ["--no-renames", f"--output={out}", self.base_sha, head]
        self.git(args)
        size = out.stat().st_size
        with out.open("rb") as fh:
            data = fh.read(max_bytes + 1)
        out.unlink(missing_ok=True)
        stats = DiffStats(files=len(paths), insertions=ins, deletions=dels, bytes=size)
        return data.decode("utf-8", "replace"), stats, head


def _init_repo(job_dir: Path, ws_dir: Path, branch: str) -> Workspace:
    git_dir = job_dir / GIT_SUBDIR
    if git_dir.exists():
        shutil.rmtree(git_dir)
    git_dir.mkdir(mode=0o700, parents=True)
    run_git(git_dir, ws_dir, ["init", "-q", "--template=", f"--initial-branch={branch}"])
    probe = Workspace(job_dir, ws_dir, git_dir, NULL_SHA, branch)
    probe.git(["add", "-A"])
    probe.git(["commit", "-q", "--allow-empty", "--no-verify", "--no-gpg-sign", "-m", "base"])
    base = probe.head()
    if not _SHA_RE.match(base):
        raise GitError("rev-parse", "SHA base không hợp lệ")
    return Workspace(job_dir, ws_dir, git_dir, base, branch)


def init_git(job_dir: Path, ws_dir: Path, branch: str, base_patch: Path | None) -> Workspace:
    """`git init` cứng + commit `base` trên nhánh `branch` → (có `base_patch`) `apply --binary
    --index` + commit "rounds 1..k-1" (PC-R11). Áp lỗi ⇒ `WorkspaceError(apply_patch)`.
    Gọi SAU pha cài (PC-R05). `.git` xuất hiện trong workspace (pha cài) ⇒
    `WorkspaceError(install)`.
    """
    if not _BRANCH_RE.match(branch):
        raise ValueError("branch không hợp lệ")
    bad = git_entries(ws_dir)
    if bad:
        detail = "`.git` trong workspace sau pha cài (PB-R07)"
        raise WorkspaceError(Failure("install", path=bad[0], rule="forbidden_name", detail=detail))
    ws = _init_repo(job_dir, ws_dir, branch)
    if base_patch is None:
        return ws
    try:
        ws.git(["apply", "--binary", "--index", "--whitespace=nowarn", "--", str(base_patch)])
    except GitError as err:
        failure = Failure("apply_patch", rule="git_apply", detail=clip_detail(err.stderr))
        raise WorkspaceError(failure, ws.base_sha) from err
    ws.git(["commit", "-q", "--allow-empty", "--no-verify", "--no-gpg-sign", "-m", "rounds"])
    return ws


def default_branch(stage_key: str) -> str:
    """Nhánh khi host không truyền (test): `ai/<uuid 0>/<stage_key>` — khớp regex contract."""
    return f"ai/00000000-0000-0000-0000-000000000000/{stage_key}"


def prepare(  # noqa: PLR0913
    job_dir: Path,
    snapshot: Path,
    stage_key: str,
    base_patch: Path | None,
    *,
    branch: str | None = None,
    caps: CopyCaps | None = None,
) -> Workspace:
    """plan-runtime §5.8: chép snapshot → `workspace/<stage_key>` → git cứng + `base` → áp
    `base_patch`. Không pha cài (host R3 dùng `copy_workspace` + `init_git` khi có
    `install_cmd`)."""
    ws_dir = copy_workspace(job_dir, snapshot, stage_key, caps or CopyCaps())
    return init_git(job_dir, ws_dir, branch or default_branch(stage_key), base_patch)
