"""HUB-FR-129 · WRK-FR-29 · HUB-BR-34 · PC2-R04 · R06 · R11 · P-c2 · git cứng cho job
`source.apply` (plan-runtime §5.2 bước 2–4, 6): clone work repo từ mirror cục bộ → checkout
`target` → `git apply --3way --index --binary` → commit `ai-autofix` → push refspec `ai/` (hoặc
`ls-remote` bỏ qua nếu ref từ xa đã = HEAD).

`GIT_DIR = work/<job>/repo/.git` ngoài mọi mount. Ops cục bộ (clone/checkout/apply/commit/diff) cho
phép `file` (mirror là đường dẫn cục bộ tin cậy); ops từ xa (ls-remote/push) đi qua `git_env` chuẩn
(production chỉ `https`; test C6 insteadOf `https:file`) + khoá qua `GIT_CONFIG_*` extraHeader.
stderr git có thể lẫn khoá ⇒ luôn `redact_auth` trước khi dùng/log/báo cáo (PC2-R11).
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from agent_runtime.apply import rules
from agent_runtime.sources import git_driver
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.git_driver import GitAuth

CLONE_TIMEOUT_S = 120
PUSH_TIMEOUT_S = 120
_OP_TIMEOUT_S = 120
_SHA_RE = __import__("re").compile(r"^[0-9a-f]{40}$")


class GitWorkError(Exception):
    """Lỗi git cục bộ không mong đợi (clone/checkout/commit). Message chung — stderr đã che."""


@dataclass(frozen=True)
class ApplyOutcome:
    """Kết quả `git apply --3way`: sạch (`ok`) hoặc xung đột (danh sách file chưa merge)."""

    ok: bool
    conflict_files: list[str] = field(default_factory=list[str])


@dataclass(frozen=True)
class PushOutcome:
    ok: bool
    code: rules.PushError | None = None
    detail: str | None = None


def _origin(url: str) -> str:
    """`scheme://host[:port]` cho khoá `http.<origin>/.extraHeader` (= `git_driver._origin`)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port and parts.port != 443:
        return f"{parts.scheme}://{host}:{parts.port}"
    return f"{parts.scheme}://{host}"


def _local_env(cfg: SourceConfig) -> dict[str, str]:
    """Ops cục bộ (mirror là path tin cậy): cho phép `file` kể cả production."""
    env = git_driver.git_env(cfg)
    env["GIT_ALLOW_PROTOCOL"] = "https:file"
    return env


def _run(args: list[str], env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(  # noqa: S603 — execFile mảng, không shell
        ["git", *args], env=env, capture_output=True, timeout=timeout, check=False
    )


def _stderr(proc: subprocess.CompletedProcess[bytes]) -> str:
    return rules.redact_auth(proc.stderr.decode("utf-8", "replace"))


def clone_checkout(  # noqa: PLR0913
    cfg: SourceConfig, mirror: Path, repo: Path, target: str, branch: str
) -> None:
    """`clone --no-checkout --no-hardlinks <mirror> <repo>` → `checkout -B <branch> <target>`."""
    env = _local_env(cfg)
    clone = _run(
        ["clone", "--no-checkout", "--no-hardlinks", "--quiet", str(mirror), str(repo)],
        env,
        CLONE_TIMEOUT_S,
    )
    if clone.returncode != 0:
        raise GitWorkError("clone mirror thất bại")
    co = _run(["-C", str(repo), "checkout", "-q", "-B", branch, target], env, _OP_TIMEOUT_S)
    if co.returncode != 0:
        raise GitWorkError("checkout target thất bại")


def apply_patch(cfg: SourceConfig, repo: Path, patch: Path) -> ApplyOutcome:
    """`git apply --3way --index --binary`; xung đột ⇒ `ApplyOutcome(ok=False, conflict_files)`
    (gộp stderr "Applied patch … with conflicts" + `status --porcelain` chưa merge, PC2-R04)."""
    env = _local_env(cfg)
    res = _run(
        ["-C", str(repo), "apply", "--3way", "--index", "--binary", str(patch)], env, _OP_TIMEOUT_S
    )
    if res.returncode == 0:
        return ApplyOutcome(ok=True)
    porcelain = _run(["-C", str(repo), "status", "--porcelain"], env, _OP_TIMEOUT_S)
    files = rules.conflict_files(_stderr(res), porcelain.stdout.decode("utf-8", "replace"))
    return ApplyOutcome(ok=False, conflict_files=files)


def commit(cfg: SourceConfig, repo: Path, branch: str) -> str:
    """Commit tác giả `ai-autofix` (thông điệp cố định, không chữ tự do) ⇒ SHA HEAD."""
    env = _local_env(cfg)
    args = [
        "-C", str(repo),
        "-c", "user.name=ai-autofix", "-c", "user.email=ai-autofix@local",
        "commit", "-q", "--no-verify", "--no-gpg-sign", "-m", f"ai-autofix: {branch}",
    ]  # fmt: skip
    if _run(args, env, _OP_TIMEOUT_S).returncode != 0:
        raise GitWorkError("commit thất bại")
    return rev_parse(cfg, repo, "HEAD")


def rev_parse(cfg: SourceConfig, repo: Path, ref: str) -> str:
    res = _run(["-C", str(repo), "rev-parse", ref], _local_env(cfg), _OP_TIMEOUT_S)
    sha = res.stdout.decode("ascii", "replace").strip()
    if res.returncode != 0 or not _SHA_RE.match(sha):
        raise GitWorkError("rev-parse thất bại")
    return sha


def diff_patch(  # noqa: PLR0913
    cfg: SourceConfig, repo: Path, target: str, head: str, out: Path
) -> None:
    """`git diff --full-index --binary <target> <head>` → file (bản vá retest, base = target)."""
    res = _run(
        ["-C", str(repo), "diff", "--full-index", "--binary", "--no-color", target, head],
        _local_env(cfg),
        _OP_TIMEOUT_S,
    )
    if res.returncode != 0:
        raise GitWorkError("diff target..HEAD thất bại")
    out.write_bytes(res.stdout)


def ls_remote(  # noqa: PLR0913
    cfg: SourceConfig, repo: Path, url: str, branch: str, auth: GitAuth | None
) -> str | None:
    """SHA của `refs/heads/<branch>` từ remote (khoá qua extraHeader); không có ⇒ None."""
    env = git_driver.git_env(cfg, auth, _origin(url))
    res = _run(["-C", str(repo), "ls-remote", url, f"refs/heads/{branch}"], env, _OP_TIMEOUT_S)
    if res.returncode != 0:
        return None
    first = res.stdout.decode("utf-8", "replace").split("\t", 1)
    sha = first[0].strip()
    return sha if _SHA_RE.match(sha) else None


def push(  # noqa: PLR0913
    cfg: SourceConfig, repo: Path, url: str, branch: str, auth: GitAuth | None
) -> PushOutcome:
    """Push CHỈ `push_refspec(branch)` (cưỡng bức trong `ai/<run>/<stage>`, PC2-R06). Lỗi ⇒ phân
    loại `classify_push_error` + detail đã che. Nhánh ngoài `ai/` ⇒ `ValueError` (host từ chối)."""
    refspec = rules.push_refspec(branch)  # ValueError nếu nhánh ngoài không gian ai/
    env = git_driver.git_env(cfg, auth, _origin(url))
    res = _run(["-C", str(repo), "push", url, refspec], env, PUSH_TIMEOUT_S)
    if res.returncode == 0:
        return PushOutcome(ok=True)
    stderr = _stderr(res)
    return PushOutcome(
        ok=False, code=rules.classify_push_error(res.returncode, stderr), detail=stderr
    )
