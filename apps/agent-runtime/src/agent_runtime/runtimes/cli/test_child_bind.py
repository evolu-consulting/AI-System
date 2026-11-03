"""CR-114 review (fix114-warm) · WRK-BR-02 — host `--warm` gắn job phải bỏ cache `tempfile` đã
lấy trước bind (TMPDIR chung `work/.warm`) ⇒ file tạm của job nằm trong thư mục tạm của job."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from agent_runtime.runtimes.cli.child import bind_warm
from agent_runtime.runtimes.cli.protocol import ChildRequest, WarmBind
from agent_runtime.runtimes.cli.test_runner import payload


def test_cr114_bind_resets_cached_tempdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shared = tmp_path / ".warm" / ".tmp"
    shared.mkdir(parents=True)
    monkeypatch.setenv("TMPDIR", str(shared))
    monkeypatch.setattr(tempfile, "tempdir", None)
    assert tempfile.gettempdir() == str(shared)  # import trước bind đã cache thư mục chung
    monkeypatch.chdir(tmp_path)
    p = payload()
    work = tmp_path / str(p.job_id)
    (work / ".tmp").mkdir(parents=True)
    bind = WarmBind(stderr_path=str(tmp_path / "err.log"), env={"TMPDIR": str(work / ".tmp")})
    req = ChildRequest(
        job_id=str(p.job_id), payload=p, work_dir=str(work), forbidden_roots=[], warm=bind
    )
    saved = os.dup(2)  # bind `dup2` stderr → log job; trả lại cho pytest
    try:
        assert bind_warm(req)
    finally:
        os.dup2(saved, 2)
        os.close(saved)
    assert tempfile.gettempdir() == str(work / ".tmp")
    with tempfile.NamedTemporaryFile() as f:
        assert Path(f.name).parent == work / ".tmp"
