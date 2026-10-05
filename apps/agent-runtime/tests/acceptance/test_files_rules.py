"""P01–P08 · P25 · luật thuần file job H2c (WRK-FR-11, WRK-FR-18, WRK-BR-07) — unit, QW-PU.

Chữ ký: `plan-runtime` H2c §4 (`runtimes/cli/files/rules.py`), §3.2 (`fetch_attachments`,
`FilesCall`, `FetchFailed`); bảng ca: `test-plan-py.md` §1 (P01–P08) + P25 vế gọi thẳng
(AC-08 tên có `..` — F15/L4: Hub không thể gửi, contract cấm ⇒ dựng tay `model_construct`).

Import trong thân test (`importlib`, như `test_dify_rules.py`): trước PY-01/PY-02 mỗi ca đỏ riêng
ở `NotImplementedError` của stub PY-00, không làm hỏng collect cả file. Không DB/Redis/mạng.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import os
import time
import urllib.parse
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx2
import pytest

MAX = 20_971_520
# Đầu ra `safeName(displayName(x))` của bảng R07 Hub (`tests/acceptance/H2c/rules/attachment-name`).
HUB_SAFE_NAMES = (
    "passwd.txt",
    "b.txt",
    "gnp.exe.txt",
    "CON_.txt",
    "env.md",
    "_-x.md",
    "Hoá đơn tháng 9.pdf",
    "a_b_c.csv",
    "file",
    "a" * 116 + ".pdf",
)
NAME_OK = (
    "a.pdf",
    "Hoá đơn tháng 9.pdf",
    "CON_.txt",
    "_-x.md",
    "a-2.pdf",
    "ạ" * 40,  # 120 byte UTF-8 (U+1EA1 = 3 byte)
    "a" * 120,
)
NAME_BAD = (
    "",
    ".",
    "..",
    ".env",
    "-x",
    "../x",
    "a/b",
    "a\\b",
    "a\x00b",
    "a\nb",
    "á.txt",  # NFD của "á.txt"
    "ạ" * 41,  # 123 byte
    "a" * 121,
    "a<b>.md",
    "a\udcff",  # surrogate lẻ — không mã hoá UTF-8 được
)


def _rules() -> ModuleType:
    return importlib.import_module("agent_runtime.runtimes.cli.files.rules")


def _fetch() -> ModuleType:
    return importlib.import_module("agent_runtime.runtimes.cli.files.fetch")


def _entry(name: str, kind: str = "file", size: int = 10) -> Any:
    return _rules().OutEntry(name=name, kind=kind, size=size)


# P01 · WRK-FR-11 · WRK-BR-07 ---------------------------------------------------------------
@pytest.mark.parametrize("name", NAME_OK + HUB_SAFE_NAMES)
def test_wrk_fr_11_p01_valid_job_file_name_true(name: str) -> None:
    assert _rules().valid_job_file_name(name) is True


@pytest.mark.parametrize("name", NAME_BAD)
def test_wrk_br_07_p01_valid_job_file_name_false(name: str) -> None:
    assert _rules().valid_job_file_name(name) is False


# P02 · WRK-FR-11 ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("status", "want"),
    [
        (None, "retry"),
        (200, "ok"),
        (401, "unauthorized"),
        (404, "not_found"),
        (500, "retry"),
        (502, "retry"),
        (503, "retry"),
        (400, "http"),
        (403, "http"),
        (409, "http"),
        (302, "http"),
    ],
)
def test_wrk_fr_11_p02_classify_fetch(status: int | None, want: str) -> None:
    assert _rules().classify_fetch(status) == want


# P03 · WRK-FR-11 ---------------------------------------------------------------------------
@pytest.mark.parametrize(("attempt", "want"), [(0, 1.0), (1, 3.0), (2, None), (3, None)])
def test_wrk_fr_11_p03_backoff(attempt: int, want: float | None) -> None:
    assert _rules().backoff(attempt) == want


def test_wrk_fr_11_p03_fetch_timing_constants() -> None:
    r = _rules()
    assert r.FETCH_BACKOFF_S == (1.0, 3.0)
    assert r.FETCH_TIMEOUT_S == 60.0


# P04 · WRK-FR-11 ---------------------------------------------------------------------------
def test_wrk_fr_11_p04_constants_match_contract() -> None:
    r = _rules()
    assert (r.JOB_FILE_NAME_MAX_BYTES, r.ATTACH_MAX_BYTES, r.OUT_MAX_FILES) == (120, MAX, 5)
    hub = importlib.import_module("agent_runtime.contracts.hub")
    props = hub.JobAttachment.model_json_schema()["properties"]
    assert props["name"]["maxLength"] == r.JOB_FILE_NAME_MAX_BYTES
    assert props["size"]["maximum"] == r.ATTACH_MAX_BYTES
    for const, want in (
        ("JOB_FILE_NAME_MAX", r.JOB_FILE_NAME_MAX_BYTES),
        ("ATTACH_MAX_BYTES", r.ATTACH_MAX_BYTES),
        ("JOB_OUTPUTS_MAX", r.OUT_MAX_FILES),
    ):
        if hasattr(hub, const):  # contract chỉ khi sinh hằng
            assert getattr(hub, const) == want


# P05 · WRK-FR-18 ---------------------------------------------------------------------------
def test_wrk_fr_18_p05_pick_outputs_skip_reasons() -> None:
    entries = [
        _entry("l.md", "symlink"),
        _entry("d", "dir"),
        _entry("fifo", "other"),
        _entry("e.md", size=0),
        _entry("big.md", size=MAX + 1),
        _entry("a/b"),
        _entry("a\\b"),
        _entry("a\x00b"),
        _entry("a\udcff"),
    ]
    picked, skipped = _rules().pick_outputs(entries)
    assert picked == []
    assert Counter(skipped) == Counter(
        {"symlink": 1, "dir": 1, "other": 1, "empty": 1, "too_large": 1, "bad_name": 4}
    )


def test_wrk_fr_18_p05_pick_outputs_skip_order() -> None:
    # Thứ tự loại: kind → empty → too_large → bad_name (mỗi mục một lý do).
    entries = [
        _entry("x", "symlink", size=0),
        _entry("dir/", "dir", size=MAX + 1),
        _entry("a/0", size=0),
        _entry("a/big", size=MAX + 1),
    ]
    _, skipped = _rules().pick_outputs(entries)
    assert Counter(skipped) == Counter({"symlink": 1, "dir": 1, "empty": 1, "too_large": 1})


def test_wrk_fr_18_p05_pick_outputs_limit_and_order() -> None:
    entries = [_entry(n, size=i + 1) for i, n in enumerate("gfedcba")]
    picked, skipped = _rules().pick_outputs(entries)
    assert [e.name for e in picked] == ["a", "b", "c", "d", "e"]
    assert {e.name: e.size for e in picked} == {"a": 7, "b": 6, "c": 5, "d": 4, "e": 3}
    assert skipped == ["over_limit", "over_limit"]


def test_wrk_fr_18_p05_pick_outputs_code_point_sort_and_max_size() -> None:
    picked, skipped = _rules().pick_outputs([_entry("a.md"), _entry("B.md", size=MAX)])
    assert picked == [_entry("B.md", size=MAX), _entry("a.md")]  # "B" < "a"
    assert skipped == []


def test_wrk_fr_18_p05_pick_outputs_empty() -> None:
    assert _rules().pick_outputs([]) == ([], [])


# P06 · WRK-FR-18 ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("name", "want"),
    [
        ("report.md", "report.md"),
        ("Báo cáo.md", "B%C3%A1o%20c%C3%A1o.md"),
        ("a/b", "a%2Fb"),
        ("%", "%25"),
    ],
)
def test_wrk_fr_18_p06_filename_header(name: str, want: str) -> None:
    assert _rules().filename_header(name) == want


@pytest.mark.parametrize("name", HUB_SAFE_NAMES + ("ạ" * 40, "a\tb", "日本.txt"))
def test_wrk_fr_18_p06_filename_header_ascii_roundtrip(name: str) -> None:
    h = _rules().filename_header(name)
    assert all(0x20 <= ord(c) <= 0x7E for c in h)
    assert urllib.parse.unquote(h, errors="strict") == name


# P07 · WRK-FR-18 ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("status", "want"),
    [
        (201, "ok"),
        (400, "skip"),
        (409, "skip"),
        (413, "skip"),
        (415, "skip"),
        (401, "stop"),
        (None, "retry"),
        (500, "retry"),
        (503, "retry"),
        (200, "skip"),
        (404, "skip"),
        (422, "skip"),
    ],
)
def test_wrk_fr_18_p07_classify_output(status: int | None, want: str) -> None:
    assert _rules().classify_output(status) == want


# P08 · WRK-FR-18 ---------------------------------------------------------------------------
def _result(status: str, kind: str = "agent_result") -> dict[str, Any]:
    return {"kind": kind, "result": {"status": status}}


@pytest.mark.parametrize(
    ("role", "output", "want"),
    [
        ("agent", _result("done"), True),
        ("agent", _result("partial"), True),
        ("agent", _result("need_input"), False),
        ("orchestrator", _result("done"), False),
        ("agent", None, False),
        ("agent", _result("done", kind="orchestrator_result"), False),
    ],
)
def test_wrk_fr_18_p08_wants_outputs(role: str, output: dict[str, Any] | None, want: bool) -> None:
    assert _rules().wants_outputs(role, output) is want


# P25 · AC-08 vế tên `..` / symlink đặt sẵn — gọi thẳng `fetch_attachments` (F15, L4, B9) -----
BODY = b"hello pdf"
HUB = "http://hub.test"


@dataclass(frozen=True)
class _Job:
    id: str
    token: str


def _att(name: str, body: bytes = BODY) -> Any:
    hub = importlib.import_module("agent_runtime.contracts.hub")
    # `model_construct`: bỏ kiểm contract (contract cấm `..`/`/` — Hub không gửi được, F15).
    return hub.JobAttachment.model_construct(
        id=uuid.uuid4(),
        name=name,
        mime="application/pdf",
        size=len(body),
        sha256=hashlib.sha256(body).hexdigest(),
    )


def _call(seen: list[httpx2.Request]) -> Any:
    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(200, content=BODY)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    return _fetch().FilesCall(
        client=client,
        hub_url=HUB,
        job=_Job(id=str(uuid.uuid4()), token="t" * 43),
        deadline=time.monotonic() + 30,
        stop=asyncio.Event(),
    )


def _dest(tmp_path: Path) -> Path:
    dest = tmp_path / "work" / "attachments"
    dest.mkdir(parents=True, mode=0o700)
    return dest


async def test_wrk_br_07_p25_ac08_dotdot_name_bad_name_no_get(tmp_path: Path) -> None:
    f = _fetch()
    dest = _dest(tmp_path)
    seen: list[httpx2.Request] = []
    item = _att("../x")
    res = await f.fetch_attachments(_call(seen), [item], dest)
    assert isinstance(res, f.FetchFailed)
    assert res.why == "bad_name"
    assert res.attachment_id in (None, str(item.id))
    assert seen == []
    assert list(dest.iterdir()) == []
    assert not (tmp_path / "work" / "x").exists()


async def test_wrk_br_07_p25_ac08_bad_name_after_ok_clears_dest(tmp_path: Path) -> None:
    f = _fetch()
    dest = _dest(tmp_path)
    seen: list[httpx2.Request] = []
    res = await f.fetch_attachments(_call(seen), [_att("a.pdf"), _att("../x")], dest)
    assert isinstance(res, f.FetchFailed) and res.why == "bad_name"
    assert len(seen) == 1  # chỉ a.pdf, tuần tự theo payload
    assert list(dest.iterdir()) == []  # file đã tải bị xoá sau FetchFailed


async def test_wrk_br_07_p25_ac08_preplaced_symlink_exists(tmp_path: Path) -> None:
    f = _fetch()
    dest = _dest(tmp_path)
    victim = tmp_path / "victim"
    victim.write_bytes(b"keep")
    os.symlink(victim, dest / "a.pdf")
    seen: list[httpx2.Request] = []
    res = await f.fetch_attachments(_call(seen), [_att("a.pdf")], dest)
    assert isinstance(res, f.FetchFailed) and res.why == "exists"
    assert victim.read_bytes() == b"keep"
    assert seen == []  # O_EXCL|O_NOFOLLOW trước GET (§3.2 bước 2)
