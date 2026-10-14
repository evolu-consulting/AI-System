"""P-c2 · R3 · `apply/fake.py` — chỉ thị `#fake:apply=` (thuần, không DB/git)."""

from __future__ import annotations

import uuid

import pytest

from agent_runtime.apply.fake import build_report, parse
from agent_runtime.contracts.hub import SourceApplyJob

PIN = "a" * 40


def _job(test_cmd: str) -> SourceApplyJob:
    sid = str(uuid.uuid4())
    return SourceApplyJob.model_validate(
        {
            "v": 1, "type": "source.apply", "job_id": sid, "tenant_id": sid, "process_run_id": sid,
            "source": {"source_id": sid, "key": "app", "url": "https://github.com/o/r.git",
                       "branch": "main", "has_credential": False},
            "pin_sha": PIN, "branch": f"ai/{sid}/fix", "apply_mode": "pr", "push_only": False,
            "patch": {"id": sid, "name": "p.diff", "mime": "text/plain", "size": 1,
                      "sha256": "0" * 64},
            "install_cmd": None, "test_cmd": test_cmd, "write_allowlist": [], "timeout_s": 60,
        }
    )  # fmt: skip


def test_parse() -> None:
    assert parse("npm test") is None
    assert parse("x #fake:apply=conflict:a.js|b.js,rebased") == ("conflict", "a.js|b.js", True)


def test_no_directive_uses_real_flow() -> None:
    assert build_report(_job("npm test")) is None
    assert build_report(_job("#fake:apply=zzz")) is None


@pytest.mark.parametrize("kind", ["pushed", "no_changes", "conflict", "check_failed", "failed"])
def test_bodies_satisfy_invariants(kind: str) -> None:
    rep = build_report(_job(f"#fake:apply={kind}"))
    assert rep is not None
    b = rep.body()
    assert (b["head_sha"] is not None) == (b["status"] == "pushed")
    assert (b["code"] is not None) == (b["status"] == "failed")
    assert (b["target_sha"] is None) == (b["status"] == "failed")


def test_rebased_and_codes() -> None:
    b = build_report(_job("#fake:apply=pushed,rebased"))
    assert b is not None and b.rebased and b.target_sha != PIN and b.test is not None
    f = build_report(_job("#fake:apply=failed:push_rejected"))
    assert f is not None and f.code == "push_rejected"
    c = build_report(_job("#fake:apply=conflict:a.js|b.js"))
    assert c is not None and list(c.conflict_files) == ["a.js", "b.js"]
