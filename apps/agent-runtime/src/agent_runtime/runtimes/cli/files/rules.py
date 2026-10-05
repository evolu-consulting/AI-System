"""H2c · WRK-FR-11 · WRK-FR-18 · R16 · R25 — luật thuần file job (plan-runtime H2c §4).

Stub PY-00: chữ ký + hằng; thân ném `NotImplementedError` tới PY-01 (qc viết unit trước —
`tests/acceptance/test_files_rules.py`).
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

JOB_FILE_NAME_MAX_BYTES = 120
ATTACH_MAX_BYTES = 20_971_520
OUT_MAX_FILES = 5
FETCH_TIMEOUT_S = 60.0
FETCH_BACKOFF_S = (1.0, 3.0)

FetchClass = Literal["ok", "retry", "unauthorized", "not_found", "http"]
OutputClass = Literal["ok", "skip", "retry", "stop"]
OutKind = Literal["file", "symlink", "dir", "other"]
OutSkip = Literal["symlink", "dir", "other", "empty", "too_large", "bad_name", "over_limit"]


@dataclass(frozen=True)
class OutEntry:
    name: str
    kind: OutKind
    size: int


def valid_job_file_name(name: str) -> bool:
    """True ⇔ UTF-8 1–120 byte, NFC, không `.`/`..`, đầu ∉ `.-`, mọi ký tự alnum hoặc ` ._-`."""
    raise NotImplementedError


def classify_fetch(status: int | None) -> FetchClass:
    """`None`/≥ 500 → retry · 200 → ok · 401 → unauthorized · 404 → not_found · khác → http."""
    raise NotImplementedError


def backoff(attempt: int) -> float | None:
    """0 → 1.0 · 1 → 3.0 · ≥ 2 → None (tối đa 3 lần gửi)."""
    raise NotImplementedError


def pick_outputs(entries: Iterable[OutEntry]) -> tuple[list[OutEntry], list[OutSkip]]:
    """Loại không-phải-file/rỗng/quá lớn/tên sai; sắp theo tên, lấy 5 đầu, phần sau `over_limit`."""
    raise NotImplementedError


def filename_header(name: str) -> str:
    """`urllib.parse.quote(name, safe="")` (khớp `parseFilenameHeader` Hub)."""
    raise NotImplementedError


def classify_output(status: int | None) -> OutputClass:
    """201 → ok · 400/409/413/415 → skip · 401 → stop · `None`/≥ 500 → retry · khác → skip."""
    raise NotImplementedError


def wants_outputs(role: str, output: Mapping[str, Any] | None) -> bool:
    """`role == "agent"` ∧ `kind == "agent_result"` ∧ `result.status ∈ {done, partial}` (R25)."""
    raise NotImplementedError
