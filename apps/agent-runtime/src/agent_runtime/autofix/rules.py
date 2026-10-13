"""HUB-BR-32 · HUB-BR-33 · WRK-FR-28 · WRK-FR-29 · WRK-BR-08 · P-c1 · Luật thuần Runtime tự-sửa
(plan §4 Runtime, plan-runtime §5.2–§5.4; ADR-0011 #1–#4). Không I/O, không subprocess.

- `container_args`: argv `run` cho docker/podman — `--network none` (`prep`: mạng `aif-prep`),
  cap-drop ALL, no-new-privileges, rootfs read-only, user 1000, trần cpu/mem/pids/tmpfs/ulimit,
  chỉ mount `/workspace`, env container cố định (không kế thừa host).
- `check_paths` (+ `gitscan.check_link_modes`) → `check_size` → `gitscan.scan_blob` (PC-R08 1–3;
  `scan_secrets` theo diff giữ cho tương thích); `redact` che log (PC-R12).
- `git_env` + `GIT_SAFE_ARGS`: git chạy ngoài container với cấu hình cứng (ADR-0011 #4).
- `ws_rel_ok`: đường dẫn tool `ws_*` tương đối, không thoát workspace.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from agent_runtime.sources.filter import compile_allowlist, is_secret

Phase = Literal["prep", "agent", "test"]
Engine = Literal["docker", "podman"]

SANDBOX_UID = 1000  # uid:gid tiến trình trong container (ảnh sandbox: user `sandbox`)
UID_GID = f"{SANDBOX_UID}:{SANDBOX_UID}"
WORKSPACE = "/workspace"
CONTAINER_ENV = ("HOME=/tmp", "CI=1", "LANG=C.UTF-8")
LABEL_AUTOFIX = "ai.autofix=1"
NAME_PREFIX = "aif-"
REDACTED = "[REDACTED]"
CMD_MAX = 500
DETAIL_MAX = 500
GIT_AUTHOR = ("ai-autofix", "noreply@local")
GIT_PATH = "/usr/local/bin:/usr/bin:/bin"
PREP_NETWORK = "aif-prep"
NOFILE = 8192
# `$GIT_DIR/info/attributes` (ưu tiên cao nhất, git 2.39 chưa có `--attr-source`): vô hiệu
# `.gitattributes` trong cây (`-diff`/`binary` giấu dòng thêm, `filter`/`eol`/encoding đổi blob).
GIT_INFO_ATTRIBUTES = "* !diff !merge !text !eol !ident !filter !working-tree-encoding\n"


GIT_SAFE_ARGS: list[str] = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.symlinks=true",
    "-c",
    "diff.external=",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "protocol.allow=never",
    "-c",
    "core.quotePath=false",
]


@dataclass(frozen=True)
class SandboxSpec:
    job_id: str
    image: str
    host_workspace: str
    engine: Engine = "docker"
    cpus: float = 2.0
    memory_mb: int = 2048
    pids: int = 512
    tmp_mb: int = 256
    disk_mb: int = 4096  # `RUNTIME_SANDBOX_DISK_MB` ⇒ `--ulimit fsize` (trần MỘT file)


@dataclass(frozen=True)
class DiffStats:
    files: int
    insertions: int
    deletions: int
    bytes: int


@dataclass(frozen=True)
class Limits:
    max_diff_bytes: int = 2_097_152
    max_files: int = 300
    max_ws_bytes: int = 4 * 1024**3


@dataclass(frozen=True)
class Failure:
    """Map 1-1 contract `AutofixFailure` — KHÔNG mang giá trị bí mật."""

    check: str
    path: str | None = None
    line: int | None = None
    rule: str | None = None
    detail: str = ""


def container_name(job_id: str, phase: Phase) -> str:
    """`aif-<job>` (agent) · `aif-<job>-test` · `aif-<job>-prep` (ADR-0011 #5)."""
    return NAME_PREFIX + job_id + ("" if phase == "agent" else f"-{phase}")


def container_args(spec: SandboxSpec, *, phase: Phase) -> list[str]:
    """argv sau tên CLI (`docker`/`podman`): `run -d … <image> sleep infinity` (plan-runtime §5.2).

    `prep` (pha cài `install_cmd`, Q2) giữ mọi hàng rào trừ `--network none`: dùng mạng riêng
    `aif-prep` (docker: `enable_icc=false` — `OciCli` tạo idempotent), không bridge mặc định."""
    argv = ["run", "-d", "--name", container_name(spec.job_id, phase)]
    argv += ["--label", LABEL_AUTOFIX, "--label", f"ai.job={spec.job_id}"]
    argv += ["--network", PREP_NETWORK if phase == "prep" else "none"]
    mem = f"{spec.memory_mb}m"
    argv += ["--cpus", f"{spec.cpus:g}", "--memory", mem, "--memory-swap", mem]
    argv += ["--pids-limit", str(spec.pids), "--read-only"]
    fsize = spec.disk_mb * 1024 * 1024  # byte (setrlimit RLIMIT_FSIZE)
    argv += ["--ulimit", f"fsize={fsize}:{fsize}", "--ulimit", f"nofile={NOFILE}:{NOFILE}"]
    argv += ["--ulimit", "core=0:0"]
    argv += ["--tmpfs", f"/tmp:rw,exec,size={spec.tmp_mb}m"]
    argv += ["--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", UID_GID]
    if spec.engine == "podman":
        argv += ["--userns", "keep-id"]
    for kv in CONTAINER_ENV:
        argv += ["-e", kv]
    argv += ["-v", f"{spec.host_workspace}:{WORKSPACE}:rw", "-w", WORKSPACE]
    return [*argv, spec.image, "sleep", "infinity"]


# ---------- PC-R08(1) · đường dẫn ----------

_CI_EXACT = ".gitlab-ci.yml"
_CI_DIR = ".github/workflows/"


def _is_ci(path: str) -> bool:
    return path.startswith(_CI_DIR) or path.lower() == _CI_EXACT


def _ci_explicit(path: str, allowlist: list[str]) -> bool:
    """CI chỉ được khi allowlist ghi rõ: mẫu bắt đầu bằng tiền tố CI và khớp (`**` không đủ)."""
    explicit = [g for g in allowlist if g.startswith((_CI_DIR, _CI_EXACT))]
    return any(p.match(path) for p in compile_allowlist(explicit))


def path_failure(path: str, rule: str, detail: str) -> Failure:
    return Failure(check="paths", path=path[:1024], rule=rule, detail=detail)


_GIT_META = frozenset({".gitattributes", ".gitmodules"})


def _is_git_meta(path: str) -> bool:
    return path.rsplit("/", 1)[-1] in _GIT_META


def _meta_explicit(path: str, allowlist: list[str]) -> bool:
    """`.gitattributes`/`.gitmodules` chỉ được khi một mẫu allowlist nêu đúng tên đó."""
    explicit = [g for g in allowlist if g.rsplit("/", 1)[-1] in _GIT_META]
    return any(p.match(path) for p in compile_allowlist(explicit))


def check_paths(changed: list[str], allowlist: list[str]) -> list[Failure]:
    """PB-R07 tên cấm (mọi độ sâu) thắng allowlist; CI và `.gitattributes`/`.gitmodules` cần ghi
    rõ; allowlist rỗng = mọi đường."""
    patterns = compile_allowlist(allowlist)
    out: list[Failure] = []
    for path in changed:
        if is_secret(path):
            out.append(path_failure(path, "forbidden_name", "tên file/thư mục cấm (PB-R07)"))
        elif _is_ci(path):
            if not _ci_explicit(path, allowlist):
                out.append(path_failure(path, "ci_file", "file CI cần ghi rõ trong allowlist"))
        elif _is_git_meta(path):
            if not _meta_explicit(path, allowlist):
                out.append(path_failure(path, "git_meta", "file cấu hình git cần ghi rõ"))
        elif patterns and not any(p.match(path) for p in patterns):
            out.append(path_failure(path, "not_allowed", "ngoài allowlist ghi"))
    return out


# ---------- PC-R08(2) · kích thước ----------


def check_size(stats: DiffStats, ws_bytes: int, lim: Limits) -> list[Failure]:
    """Biên đúng = đạt."""
    out: list[Failure] = []
    if stats.files > lim.max_files:
        out.append(Failure("size", rule="diff_files", detail=f"{stats.files} > {lim.max_files}"))
    if stats.bytes > lim.max_diff_bytes:
        msg = f"{stats.bytes} > {lim.max_diff_bytes} bytes"
        out.append(Failure("size", rule="diff_bytes", detail=msg))
    if ws_bytes > lim.max_ws_bytes:
        msg = f"{ws_bytes} > {lim.max_ws_bytes} bytes"
        out.append(Failure("size", rule="workspace_bytes", detail=msg))
    return out


# ---------- PC-R08(3) · bí mật + PC-R12 che log ----------

SECRET_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    (
        "private_key",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|PuTTY-User-Key-File-\d+:"),
    ),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("github_pat", re.compile(r"github_pat_[A-Za-z0-9_]{60,}")),
    ("gitlab_pat", re.compile(r"glpat-[A-Za-z0-9_-]{20,}")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai_key", re.compile(r"sk-[A-Za-z0-9]{32,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    (
        "secret_assignment",
        re.compile(
            r"(?i)(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"\s]{12,}['\"]"
        ),
    ),
)
_PEM_BLOCK = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
)
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
_DIFF_GIT = re.compile(r"^diff --git a/(.+) b/(.+)$")


def secret_rule(text: str) -> str | None:
    """Tên luật đầu tiên khớp (không trả giá trị)."""
    for name, pat in SECRET_RULES:
        if pat.search(text):
            return name
    return None


@dataclass
class _Cursor:
    path: str | None = None
    line: int = 0
    in_hunk: bool = False
    named: bool = False  # đã xét tên file cấm


def _header(raw: str, cur: _Cursor, out: list[Failure]) -> None:
    m = _DIFF_GIT.match(raw)
    if m:
        cur.path, cur.in_hunk, cur.named = m.group(2), False, False
        return
    if raw.startswith("+++ "):
        target = raw[4:]
        if target != "/dev/null":
            cur.path = target[2:] if target.startswith("b/") else target
            if not cur.named and is_secret(cur.path):
                msg = "thêm/sửa file tên cấm (PB-R07)"
                out.append(Failure("secrets", path=cur.path, rule="forbidden_name", detail=msg))
        cur.named = True


def _hunk_line(raw: str, cur: _Cursor, out: list[Failure]) -> None:
    if raw.startswith("+"):
        rule = secret_rule(raw[1:])
        if rule is not None:
            detail = f"khớp mẫu bí mật `{rule}`"
            out.append(Failure("secrets", path=cur.path, line=cur.line, rule=rule, detail=detail))
        cur.line += 1
    elif raw.startswith(" ") or raw == "":
        cur.line += 1
    elif not raw.startswith(("-", "\\")):
        cur.in_hunk = False  # hết hunk (vd dòng `diff --git`, `GIT binary patch`)


def scan_secrets(diff: str) -> list[Failure]:
    """Chỉ dòng THÊM (`+`) trong hunk; file mới/sửa có tên cấm ⇒ lỗi. `line` = số dòng file mới."""
    out: list[Failure] = []
    cur = _Cursor()
    for raw in diff.split("\n"):
        hunk = _HUNK.match(raw)
        if hunk:
            cur.in_hunk, cur.line = True, int(hunk.group(1))
            continue
        if cur.in_hunk:
            _hunk_line(raw, cur, out)
            if cur.in_hunk:
                continue
        _header(raw, cur, out)
    return out


def redact(text: str) -> str:
    """Thay mọi khớp mẫu bí mật (+ khối PEM đủ) bằng `[REDACTED]`."""
    text = _PEM_BLOCK.sub(REDACTED, text)
    for _, pat in SECRET_RULES:
        text = pat.sub(REDACTED, text)
    return text


# ---------- git cứng (ADR-0011 #4) · đường dẫn ws · cắt lệnh ----------


def git_env(git_dir: Path, work_tree: Path) -> dict[str, str]:
    """Env đầy đủ cho git trên host — KHÔNG kế thừa biến host (token/secret)."""
    name, email = GIT_AUTHOR
    return {
        "PATH": GIT_PATH,
        "LANG": "C.UTF-8",
        "GIT_DIR": str(git_dir),
        "GIT_WORK_TREE": str(work_tree),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PAGER": "cat",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_AUTHOR_NAME": name,
        "GIT_AUTHOR_EMAIL": email,
        "GIT_COMMITTER_NAME": name,
        "GIT_COMMITTER_EMAIL": email,
    }


def ws_rel_ok(rel: str) -> bool:
    """Tương đối, không rỗng, không NUL, không `..`, không tuyệt đối (kể cả `\\`), ≤ 1024."""
    if not rel or len(rel) > 1024 or "\x00" in rel or rel.startswith(("/", "\\")):
        return False
    return ".." not in rel.replace("\\", "/").split("/")


def truncate_cmd(cmd: str) -> str:
    return cmd if len(cmd) <= CMD_MAX else cmd[: CMD_MAX - 1] + "…"


def clip_detail(text: str) -> str:
    """`detail` ≤ 500 (contract) sau khi che bí mật."""
    text = redact(text)
    return text if len(text) <= DETAIL_MAX else text[: DETAIL_MAX - 1] + "…"
