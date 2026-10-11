"""P-b · PF-S2 · PB-R19 · HUB-BR-30 · SSRF-safe git (execFile mảng, không shell).

Kiểm URL **logic** TRƯỚC khi gọi git: chỉ `https`, host ∈ allowlist, port 443, không userinfo;
cấm `file://`/`ext::`/`git://`/`http://`. Branch không mở đầu `-`. `GIT_TERMINAL_PROMPT=0` (không
treo hỏi mật khẩu). Chặn DNS trả IP nội bộ (bỏ khi `test_mode`). Mirror bare (`--mirror`) khoá
`flock`; clone/fetch timeout 120 s. `GIT_CONFIG_*` của C6 chỉ truyền khi `runtime_env!=production`.
"""

from __future__ import annotations

import contextlib
import fcntl
import ipaddress
import os
import shutil
import socket
import subprocess
from collections.abc import Generator
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit

from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError

CLONE_TIMEOUT_S = 120
_GIT_TIMEOUT_S = 120
_SHA_RE = __import__("re").compile(r"^[0-9a-f]{40}$")


def validate_git_url(url: str, cfg: SourceConfig) -> str:
    """Trả host hợp lệ hoặc ném `SourceError`. PB-R19."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise SourceError("SOURCE_HOST_NOT_ALLOWED", "chỉ chấp nhận https")
    if parts.username or parts.password or "@" in parts.netloc:
        raise SourceError("SOURCE_HOST_NOT_ALLOWED", "URL không được chứa thông tin đăng nhập")
    host = parts.hostname
    if not host:
        raise SourceError("SOURCE_HOST_NOT_ALLOWED", "thiếu host")
    if parts.port not in (None, 443):
        raise SourceError("SOURCE_HOST_NOT_ALLOWED", "chỉ cổng 443")
    if host.lower() not in cfg.git_hosts:
        raise SourceError("SOURCE_HOST_NOT_ALLOWED", "host không thuộc allowlist")
    if not cfg.test_mode:
        _reject_internal_ip(host)
    return host


def _reject_internal_ip(host: str) -> None:
    """DNS trả IP nội bộ (loopback/private/link-local) ⇒ từ chối (SSRF)."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError as err:
        raise SourceError("SOURCE_UNRESOLVABLE", "không phân giải được host") from err
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise SourceError("SOURCE_HOST_NOT_ALLOWED", "host trỏ IP nội bộ")


def validate_branch(branch: str) -> str:
    if not branch or branch.startswith("-"):
        raise SourceError("SOURCE_UNRESOLVABLE", "branch không hợp lệ")
    return branch


def git_env(cfg: SourceConfig) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "LANG": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        # Production: chỉ https. Test (insteadOf C6): thêm `file` cho fixture đã rewrite.
        "GIT_ALLOW_PROTOCOL": "https:file" if cfg.git_config_env else "https",
    }
    env.update(cfg.git_config_env)
    return env


def _run_git(cfg: SourceConfig, args: list[str], timeout: int = _GIT_TIMEOUT_S) -> str:
    try:
        proc = subprocess.run(  # noqa: S603 — execFile mảng, không shell
            ["git", *args],
            env=git_env(cfg),
            capture_output=True,
            timeout=timeout,
            check=False,
            text=True,
        )
    except subprocess.TimeoutExpired as err:
        raise SourceError("SOURCE_UNRESOLVABLE", "git quá hạn") from err
    if proc.returncode != 0:
        raise SourceError("SOURCE_UNRESOLVABLE", "git thất bại")
    return proc.stdout


def mirror_path(cfg: SourceConfig, url: str) -> Path:
    return cfg.mirrors_dir / sha256(url.encode()).hexdigest()


@contextlib.contextmanager
def _mirror_lock(cfg: SourceConfig, url: str) -> Generator[None, None, None]:
    cfg.mirrors_dir.mkdir(parents=True, exist_ok=True)
    lock = cfg.mirrors_dir / f"{sha256(url.encode()).hexdigest()}.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _clone_mirror(cfg: SourceConfig, url: str, dest: Path) -> None:
    tmp = dest.parent / f".bld-{os.urandom(8).hex()}"
    try:
        _run_git(cfg, ["clone", "--mirror", "--quiet", url, str(tmp)], timeout=CLONE_TIMEOUT_S)
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)


def ensure_mirror_fresh(cfg: SourceConfig, url: str) -> Path:
    """Resolve (check): clone nếu thiếu, else fetch — để bắt được HEAD mới nhất của branch."""
    validate_git_url(url, cfg)
    dest = mirror_path(cfg, url)
    with _mirror_lock(cfg, url):
        if dest.exists():
            _run_git(cfg, ["-C", str(dest), "fetch", "--quiet", "--prune"])
        else:
            _clone_mirror(cfg, url, dest)
    return dest


def ensure_sha(cfg: SourceConfig, url: str, sha: str) -> Path:
    """Stage (mount theo pin): bảo đảm `sha` có trong mirror; thiếu ⇒ clone/fetch; vẫn thiếu ⇒ lỗi."""  # noqa: E501
    validate_git_url(url, cfg)
    if not _SHA_RE.match(sha):
        raise SourceError("SOURCE_UNRESOLVABLE", "sha không hợp lệ")
    dest = mirror_path(cfg, url)
    with _mirror_lock(cfg, url):
        if not dest.exists():
            _clone_mirror(cfg, url, dest)
        if not _has_commit(cfg, dest, sha):
            with contextlib.suppress(SourceError):
                _run_git(cfg, ["-C", str(dest), "fetch", "--quiet", "--prune"])
        if not _has_commit(cfg, dest, sha):
            raise SourceError("SOURCE_UNRESOLVABLE", "sha không còn trong repo")
    return dest


def _has_commit(cfg: SourceConfig, mirror: Path, sha: str) -> bool:
    try:
        _run_git(cfg, ["-C", str(mirror), "cat-file", "-e", f"{sha}^{{commit}}"], timeout=30)
    except SourceError:
        return False
    return True


def resolve_sha(cfg: SourceConfig, mirror: Path, branch: str) -> str:
    validate_branch(branch)
    out = _run_git(cfg, ["-C", str(mirror), "rev-parse", f"refs/heads/{branch}"], timeout=30)
    sha = out.strip()
    if not _SHA_RE.match(sha):
        raise SourceError("SOURCE_UNRESOLVABLE", "không phân giải được branch")
    return sha


def archive_proc(cfg: SourceConfig, mirror: Path, sha: str) -> subprocess.Popen[bytes]:
    """`git archive --format=tar <sha>` (stdout tar stream) — người gọi đọc + đóng."""
    return subprocess.Popen(  # noqa: S603 — execFile mảng
        ["git", "-C", str(mirror), "archive", "--format=tar", sha],
        env=git_env(cfg),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
