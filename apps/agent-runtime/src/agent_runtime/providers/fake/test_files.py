"""H2c · WRK-FR-11 · WRK-FR-18 · WRK-BR-07 · R19 — chỉ thị file `fake-cli` (plan-runtime H2c §6):
`#fake:files`, `#fake:out*`, `#fake:write` (hook thật, PL9)."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

from agent_runtime.providers.base import ProviderEvent, ProviderJob
from agent_runtime.providers.fake.files import NO_FILES, out_names
from agent_runtime.providers.fake.test_provider import agent_text, make_job, run

WRITE_TOOLS = ["Read", "Write"]


def _run(job: ProviderJob) -> list[ProviderEvent]:
    """Đồng bộ (thao tác đĩa trong test không chặn event loop — ruff ASYNC240)."""
    return asyncio.run(run(job))


def test_wrk_fr_11_files_lines_sorted(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:files")
    att = Path(job.work_dir, "attachments")
    att.mkdir()
    (att / "b.md").write_bytes(b"bb")
    (att / "Hoá đơn.pdf").write_bytes(b"%PDF")
    (att / "sub").mkdir()
    (att / "l.md").symlink_to(att / "b.md")
    want = "\n".join(
        f"{n}:{hashlib.sha256(b).hexdigest()}"
        for n, b in (("Hoá đơn.pdf", b"%PDF"), ("b.md", b"bb"))
    )
    assert agent_text(_run(job)) == want


def test_wrk_fr_11_files_none(tmp_path: Path) -> None:
    assert agent_text(_run(make_job(tmp_path, "#fake:files"))) == NO_FILES
    job = make_job(tmp_path, "#fake:files")
    Path(job.work_dir, "attachments").mkdir()
    assert agent_text(_run(job)) == NO_FILES


def test_wrk_fr_18_out_files_size_link(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:out=a.md,b/c.md,d.md #fake:out-link=x.md")
    out = Path(job.work_dir, "out")
    out.mkdir()
    _run(job)
    assert sorted(p.name for p in out.iterdir()) == ["a.md", "d.md", "x.md"]
    assert (out / "a.md").read_text() == "fake output a.md\n"
    assert (out / "x.md").is_symlink()
    sized = make_job(tmp_path / "s", "#fake:out=e.md #fake:out-size=3")
    Path(sized.work_dir, "out").mkdir()
    _run(sized)
    assert Path(sized.work_dir, "out", "e.md").read_bytes() == b"aaa"


def test_wrk_fr_18_out_without_dir_noop(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:out=a.md")
    _run(job)
    assert not Path(job.work_dir, "out").exists()


def test_wrk_fr_18_out_names_limit() -> None:
    assert out_names(",".join(f"f{i}.md" for i in range(12))) == [f"f{i}.md" for i in range(10)]
    assert out_names("a\\b,..,,ok") == ["ok"]


def test_wrk_br_07_write_via_hook(tmp_path: Path) -> None:
    job = make_job(tmp_path, "#fake:write=out/a.md", allowed_tools=WRITE_TOOLS)
    Path(job.work_dir, "out").mkdir()
    assert agent_text(_run(job)) == "written"
    assert Path(job.work_dir, "out", "a.md").read_text() == "fake write\n"
    root = make_job(tmp_path / "r", "#fake:write=a.md", allowed_tools=WRITE_TOOLS)
    Path(root.work_dir, "out").mkdir()
    assert agent_text(_run(root)) == "denied:path_not_allowed"
    assert not Path(root.work_dir, "a.md").exists()
    ro = make_job(tmp_path / "t", "#fake:write=out/a.md")
    assert agent_text(_run(ro)) == "denied:tool_not_allowed"
