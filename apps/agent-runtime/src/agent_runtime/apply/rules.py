"""HUB-BR-34 · HUB-BR-30 · HUB-BR-14 · WRK-FR-29 · ADR-0011 #4 · P-c2 · luật thuần Runtime cho job
`source.apply` (plan §4 "Runtime `apply/rules.py`"; test-plan P-c2 §4 P01–P07).

Không DB/HTTP/git — chỉ chuỗi. Dùng bởi `apply/host.py` (R2) và `sources/git_driver.py`:
- `push_refspec`  — chỉ cho đẩy nhánh trong không gian `ai/<run>/<stage>` (PC2-R06);
- `mirror_key`    — mirror riêng theo nguồn khi có khoá (PC2-R12);
- `auth_env`      — khoá chỉ vào git qua env `GIT_CONFIG_*` (PC2-R11), không argv/URL/file;
- `redact_auth`   — che `Authorization`/token trước khi log hay báo cáo (PC2-R11);
- `classify_push_error`, `conflict_files`, `needs_retest` — phân loại kết quả Áp (PC2-R04/R05/R08).
"""

from __future__ import annotations

import base64
import re
from hashlib import sha256
from typing import Literal

# PC2-R06: chỉ `ai/<run uuid>/<stage_key>`; `<stage_key>` thường, không ký tự lạ/`..`/khoảng trắng.
_BRANCH_RE = re.compile(r"ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}")

# PC2-R11/HUB-BR-30: che bí mật trong chuỗi lỗi/log.
_RE_AUTH_HEADER = re.compile(r"(?i)(authorization:\s*)(\S+)(\s+\S+)?")
_RE_SCHEME = re.compile(r"(?i)\b(basic|bearer)\s+[A-Za-z0-9+/=_.\-]+")
_RE_USERINFO = re.compile(r"//([^/@\s:]+):([^@\s/]+)@")

# XY trạng thái `git status --porcelain` của file chưa merge (xung đột).
_UNMERGED = frozenset({"DD", "AU", "UD", "UA", "DU", "AA", "UU"})
_RE_APPLIED_CONFLICT = re.compile(r"Applied patch to '([^']+)' with conflicts")
_MAX_CONFLICT_FILES = 50

PushError = Literal["auth", "push_rejected", "network"]


def push_refspec(branch: str) -> str:
    """`+HEAD:refs/heads/<branch>`; cưỡng bức (`+`) chỉ hợp lệ trong `ai/<run>/<stage>` (PC2-R06).

    `branch` ngoài `^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$` ⇒ `ValueError` (không bao giờ đẩy nhánh mặc
    định, `--all`, `--mirror`, tag).
    """
    if not _BRANCH_RE.fullmatch(branch):
        raise ValueError("refspec ngoài không gian ai/<run>/<stage>")
    return f"+HEAD:refs/heads/{branch}"


def mirror_key(url: str, source_id: str, has_credential: bool) -> str:
    """PC2-R12: nguồn có khoá ⇒ mirror riêng `src-<source_id>` (không chung theo URL giữa tenant);
    không khoá ⇒ `sha256(url)` như P-b (dùng lại mirror công khai)."""
    if has_credential:
        return f"src-{source_id}"
    return sha256(url.encode()).hexdigest()


def auth_env(base: dict[str, str], origin: str, username: str, token: str) -> dict[str, str]:
    """PC2-R11: nối thêm một cặp `GIT_CONFIG_*` cho `http.<origin>/.extraHeader` = `Authorization:
    Basic <b64(username:token)>` vào `GIT_CONFIG_COUNT` sẵn có (giữ nguyên các cặp C6 insteadOf).

    Trả dict MỚI (không sửa `base`). Token chỉ nằm trong giá trị extraHeader dạng base64, không ở
    khoá nào, không qua argv/URL/file.
    """
    env = dict(base)
    raw_count = env.get("GIT_CONFIG_COUNT", "0")
    count = int(raw_count) if raw_count.isdigit() else 0
    b64 = base64.b64encode(f"{username}:{token}".encode()).decode()
    env[f"GIT_CONFIG_KEY_{count}"] = f"http.{origin}/.extraHeader"
    env[f"GIT_CONFIG_VALUE_{count}"] = f"Authorization: Basic {b64}"
    env["GIT_CONFIG_COUNT"] = str(count + 1)
    return env


def redact_auth(text: str) -> str:
    """PC2-R11/HUB-BR-30: che `Authorization: …`, `Basic/Bearer …`, `<user>:<token>@` trong URL —
    dùng trước mọi log/exception/báo cáo để token git không bao giờ rò ra ngoài."""

    def _header(m: re.Match[str]) -> str:
        return f"{m.group(1)}{m.group(2)} ***" if m.group(3) else f"{m.group(1)}***"

    out = _RE_AUTH_HEADER.sub(_header, text)
    out = _RE_SCHEME.sub(lambda m: f"{m.group(1)} ***", out)
    return _RE_USERINFO.sub(r"//\1:***@", out)


def classify_push_error(exit_code: int, stderr: str) -> PushError:
    """PC2-R08/WRK-FR-29: 401/403/Authentication failed/could not read Username ⇒ `auth`;
    rejected/protected branch/pre-receive hook declined ⇒ `push_rejected`; còn lại ⇒ `network`."""
    low = stderr.lower()
    if (
        "authentication failed" in low
        or "could not read username" in low
        or re.search(r"\b(401|403)\b", stderr) is not None
    ):
        return "auth"
    if "rejected" in low or "protected branch" in low or "pre-receive hook declined" in low:
        return "push_rejected"
    return "network"


def conflict_files(stderr: str, status_porcelain: str) -> list[str]:
    """PC2-R04/E4: file xung đột sau `git apply --3way` — gộp `stderr` ("Applied patch to '…' with
    conflicts") và `git status --porcelain` (XY chưa merge). Đường dẫn tương đối, không trùng, ≤ 50.
    """
    seen: list[str] = []

    def _add(path: str) -> None:
        rel = path.strip().lstrip("/")
        if rel and rel not in seen:
            seen.append(rel)

    for m in _RE_APPLIED_CONFLICT.finditer(stderr):
        _add(m.group(1))
    for line in status_porcelain.splitlines():
        if len(line) >= 4 and line[:2] in _UNMERGED:
            _add(line[3:])
    return seen[:_MAX_CONFLICT_FILES]


def needs_retest(pin_sha: str, target_sha: str) -> bool:
    """PC2-R05: `target` của nhánh ≠ pin đã kiểm ở P-c1 ⇒ phải kiểm lại (rebase)."""
    return pin_sha != target_sha
