"""H2c · WRK-FR-11 · WRK-FR-18 · R16 · R25 — luật thuần file job (plan-runtime H2c §4).

Unit khoá: `tests/acceptance/test_files_rules.py` (QW-PU, P01–P08).
"""

import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, cast
from urllib.parse import quote

JOB_FILE_NAME_MAX_BYTES = 120
ATTACH_MAX_BYTES = 20_971_520
OUT_MAX_FILES = 5
FETCH_TIMEOUT_S = 60.0
FETCH_BACKOFF_S = (1.0, 3.0)

FetchClass = Literal["ok", "retry", "unauthorized", "not_found", "http"]
OutputClass = Literal["ok", "skip", "retry", "stop"]
OutKind = Literal["file", "symlink", "dir", "other"]
OutSkip = Literal["symlink", "dir", "other", "empty", "too_large", "bad_name", "over_limit"]


_NAME_EXTRA = frozenset(" ._-")
_BAD_OUT_CHARS = frozenset(("/", "\\", "\x00"))
_SERVER_ERROR = 500
_CREATED = 201
_UNAUTHORIZED = 401
_FETCH_STATUS: dict[int, FetchClass] = {200: "ok", 401: "unauthorized", 404: "not_found"}
_OUT_STATUSES = frozenset({"done", "partial"})


@dataclass(frozen=True)
class OutEntry:
    name: str
    kind: OutKind
    size: int


def valid_job_file_name(name: str) -> bool:
    """True ⇔ UTF-8 1–120 byte, NFC, không `.`/`..`, đầu ∉ `.-`, mọi ký tự alnum hoặc ` ._-`."""
    try:
        size = len(name.encode("utf-8"))
    except UnicodeEncodeError:
        return False
    if not 1 <= size <= JOB_FILE_NAME_MAX_BYTES or name in {".", ".."} or name[0] in ".-":
        return False
    if unicodedata.normalize("NFC", name) != name:
        return False
    return all(c.isalnum() or c in _NAME_EXTRA for c in name)


def classify_fetch(status: int | None) -> FetchClass:
    """`None`/≥ 500 → retry · 200 → ok · 401 → unauthorized · 404 → not_found · khác → http."""
    if status is None or status >= _SERVER_ERROR:
        return "retry"
    return _FETCH_STATUS.get(status, "http")


def backoff(attempt: int) -> float | None:
    """0 → 1.0 · 1 → 3.0 · ≥ 2 → None (tối đa 3 lần gửi)."""
    if 0 <= attempt < len(FETCH_BACKOFF_S):
        return FETCH_BACKOFF_S[attempt]
    return None


def pick_outputs(entries: Iterable[OutEntry]) -> tuple[list[OutEntry], list[OutSkip]]:
    """Loại không-phải-file/rỗng/quá lớn/tên sai; sắp theo tên, lấy 5 đầu, phần sau `over_limit`."""
    ok: list[OutEntry] = []
    skipped: list[OutSkip] = []
    for e in entries:
        why = _out_skip(e)
        if why is None:
            ok.append(e)
        else:
            skipped.append(why)
    ok.sort(key=lambda e: e.name)
    skipped.extend("over_limit" for _ in ok[OUT_MAX_FILES:])
    return ok[:OUT_MAX_FILES], skipped


def filename_header(name: str) -> str:
    """`urllib.parse.quote(name, safe="")` (khớp `parseFilenameHeader` Hub)."""
    return quote(name, safe="")


def classify_output(status: int | None) -> OutputClass:
    """201 → ok · 400/409/413/415 → skip · 401 → stop · `None`/≥ 500 → retry · khác → skip."""
    if status is None or status >= _SERVER_ERROR:
        return "retry"
    if status == _CREATED:
        return "ok"
    return "stop" if status == _UNAUTHORIZED else "skip"


def wants_outputs(role: str, output: Mapping[str, Any] | None) -> bool:
    """`role == "agent"` ∧ `kind == "agent_result"` ∧ `result.status ∈ {done, partial}` (R25)."""
    if role != "agent" or output is None or output.get("kind") != "agent_result":
        return False
    result: object = output.get("result")
    if not isinstance(result, Mapping):
        return False
    return cast("Mapping[str, Any]", result).get("status") in _OUT_STATUSES


def _out_skip(e: OutEntry) -> OutSkip | None:
    """Lý do loại một mục `out/` theo thứ tự §4: kind → empty → too_large → bad_name."""
    if e.kind != "file":
        return e.kind
    if e.size == 0:
        return "empty"
    if e.size > ATTACH_MAX_BYTES:
        return "too_large"
    try:
        e.name.encode("utf-8")
    except UnicodeEncodeError:
        return "bad_name"
    return "bad_name" if _BAD_OUT_CHARS.intersection(e.name) else None
