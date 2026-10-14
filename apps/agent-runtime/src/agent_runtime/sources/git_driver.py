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
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from agent_runtime.apply import rules
from agent_runtime.sources.config import SourceConfig
from agent_runtime.sources.errors import SourceError

CLONE_TIMEOUT_S = 120
_GIT_TIMEOUT_S = 120
_SHA_RE = __import__("re").compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class GitAuth:
    """PC2-R11: khoá nguồn giữ trong bộ nhớ Runtime, vào git chỉ qua env `GIT_CONFIG_*`.

    `username` = `x-access-token` (github) / `oauth2` (host khác); `token` = PAT. Không bao giờ qua
    argv/URL/file, không vào `work/<job>/`, log, báo cáo (`__repr__` che).
    """

    username: str
    token: str

    def __repr__(self) -> str:  # không rò token nếu lọt vào traceback/log
        return f"GitAuth(username={self.username!r}, token='***')"


def _origin(url: str) -> str:
    """`scheme://host[:port]` cho khoá `http.<origin>/.extraHeader` (PC2-R11)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if parts.port and parts.port != 443:
        return f"{parts.scheme}://{host}:{parts.port}"
    return f"{parts.scheme}://{host}"


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


def git_env(
    cfg: SourceConfig, auth: GitAuth | None = None, origin: str | None = None
) -> dict[str, str]:
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
    if auth is not None and origin is not None:
        # PC2-R11: khoá vào git chỉ qua `GIT_CONFIG_*` extraHeader (nối sau cặp C6 insteadOf).
        env = rules.auth_env(env, origin, auth.username, auth.token)
    return env


def _run_git(  # noqa: PLR0913
    cfg: SourceConfig,
    args: list[str],
    timeout: int = _GIT_TIMEOUT_S,
    auth: GitAuth | None = None,
    origin: str | None = None,
) -> str:
    try:
        proc = subprocess.run(  # noqa: S603 — execFile mảng, không shell
            ["git", *args],
            env=git_env(cfg, auth, origin),
            capture_output=True,
            timeout=timeout,
            check=False,
            text=True,
        )
    except subprocess.TimeoutExpired as err:
        raise SourceError("SOURCE_UNRESOLVABLE", "git quá hạn") from err
    if proc.returncode != 0:
        # PC2-R11: không bao giờ đưa stderr thô (có thể lẫn khoá) vào thông báo lỗi.
        raise SourceError("SOURCE_UNRESOLVABLE", "git thất bại")
    return proc.stdout


def mirror_path(
    cfg: SourceConfig, url: str, source_id: str = "", has_credential: bool = False
) -> Path:
    # PC2-R12: nguồn có khoá ⇒ mirror riêng theo `source_id`; không khoá ⇒ `sha256(url)` như P-b.
    return cfg.mirrors_dir / rules.mirror_key(url, source_id, has_credential)


@contextlib.contextmanager
def _mirror_lock(cfg: SourceConfig, key: str) -> Generator[None, None, None]:
    cfg.mirrors_dir.mkdir(parents=True, exist_ok=True)
    lock = cfg.mirrors_dir / f"{key}.lock"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _clone_mirror(cfg: SourceConfig, url: str, dest: Path, auth: GitAuth | None) -> None:
    tmp = dest.parent / f".bld-{os.urandom(8).hex()}"
    origin = _origin(url)
    try:
        _run_git(
            cfg,
            ["clone", "--mirror", "--quiet", url, str(tmp)],
            timeout=CLONE_TIMEOUT_S,
            auth=auth,
            origin=origin,
        )
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)


def ensure_mirror_fresh(  # noqa: PLR0913
    cfg: SourceConfig,
    url: str,
    source_id: str = "",
    has_credential: bool = False,
    auth: GitAuth | None = None,
) -> Path:
    """Resolve (check): clone nếu thiếu, else fetch — để bắt được HEAD mới nhất của branch. Nguồn có
    khoá ⇒ mirror riêng + fetch/clone kèm `auth` (PC2-R11/R12)."""
    validate_git_url(url, cfg)
    dest = mirror_path(cfg, url, source_id, has_credential)
    origin = _origin(url)
    with _mirror_lock(cfg, rules.mirror_key(url, source_id, has_credential)):
        if dest.exists():
            _run_git(
                cfg, ["-C", str(dest), "fetch", "--quiet", "--prune"], auth=auth, origin=origin
            )
        else:
            _clone_mirror(cfg, url, dest, auth)
    return dest


def ensure_sha(  # noqa: PLR0913
    cfg: SourceConfig,
    url: str,
    sha: str,
    source_id: str = "",
    has_credential: bool = False,
    auth: GitAuth | None = None,
) -> Path:
    """Stage (mount theo pin): bảo đảm `sha` có trong mirror; thiếu ⇒ clone/fetch; vẫn thiếu ⇒ lỗi."""  # noqa: E501
    validate_git_url(url, cfg)
    if not _SHA_RE.match(sha):
        raise SourceError("SOURCE_UNRESOLVABLE", "sha không hợp lệ")
    dest = mirror_path(cfg, url, source_id, has_credential)
    origin = _origin(url)
    with _mirror_lock(cfg, rules.mirror_key(url, source_id, has_credential)):
        if not dest.exists():
            _clone_mirror(cfg, url, dest, auth)
        if not _has_commit(cfg, dest, sha):
            with contextlib.suppress(SourceError):
                _run_git(
                    cfg, ["-C", str(dest), "fetch", "--quiet", "--prune"], auth=auth, origin=origin
                )
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
