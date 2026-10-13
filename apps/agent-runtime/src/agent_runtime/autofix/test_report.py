"""HUB-FR-128 · HUB-FR-130 · PC-R08/R12 · P-c1 · test đơn vị `autofix/report.py`."""

from __future__ import annotations

import json

import httpx2

from agent_runtime.autofix import report as rp
from agent_runtime.autofix.check import CheckResult
from agent_runtime.autofix.rules import DiffStats, Failure

SHA_B = "b" * 40
SHA_H = "c" * 40
BRANCH = "ai/0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f/fix-bug"
AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"
META = rp.ReportMeta(branch=BRANCH, base_sha=SHA_B)
STATS = DiffStats(files=1, insertions=2, deletions=0, bytes=10)


def _ok(diff: str = "diff --git a/x b/x\n") -> CheckResult:
    return CheckResult([], diff, STATS, SHA_H)


def test_hub_fr_128_ok_report() -> None:
    body = rp.build_report(META, _ok(), rp.TestRun(0, 12, "pass"))
    assert body["status"] == "ok"
    assert body["diff"] and body["diff_stats"] == vars(STATS)
    assert body["test"] == {"exit_code": 0, "duration_ms": 12, "log_tail": "pass"}
    assert (body["base_sha"], body["head_sha"], body["failures"]) == (SHA_B, SHA_H, [])


def test_wrk_fr_29_test_fail_drops_diff() -> None:
    body = rp.build_report(META, _ok(), rp.TestRun(1, 5, f"key={AKIA}"))
    assert body["status"] == "check_failed"
    assert body["diff"] is None and body["diff_stats"] is None
    assert body["failures"][0]["check"] == "tests"
    assert AKIA not in json.dumps(body)
    timeout = rp.build_report(META, _ok(), rp.TestRun(None, 5, ""))
    assert timeout["failures"][0]["rule"] == "timeout"


def test_hub_fr_128_pc_r09_no_changes() -> None:
    body = rp.build_report(META, CheckResult([], "", DiffStats(0, 0, 0, 0), SHA_B))
    assert (body["status"], body["diff"], body["diff_stats"], body["test"]) == (
        "no_changes",
        None,
        None,
        None,
    )


def test_wrk_fr_29_pre_check_failure_no_check() -> None:
    meta = rp.ReportMeta(BRANCH, failures=(Failure("size", rule="autofix_max_files"),))
    body = rp.build_report(meta, None)
    assert body["status"] == "check_failed"
    assert body["base_sha"] == body["head_sha"] == "0" * 40
    assert body["failures"] == [{"check": "size", "rule": "autofix_max_files", "detail": ""}]


def test_hub_fr_130_commands_redacted_capped() -> None:
    cmds = [rp.Command("exec", f"echo {AKIA} " + "x" * 600, 3, 0)] * 301
    body = rp.build_report(META, _ok(), None, cmds)
    assert len(body["commands"]) == rp.COMMANDS_MAX
    first = body["commands"][0]
    assert AKIA not in first["arg"] and len(first["arg"]) == 500
    assert first["exit_code"] == 0
    tail = rp.build_report(META, _ok(), rp.TestRun(0, 1, "y" * 70_000))["test"]["log_tail"]
    assert len(tail) == rp.LOG_TAIL_MAX


def _target() -> rp.HubTarget:
    return rp.HubTarget("http://hub.local", "job-1", "tok")


async def _post(handler: object) -> tuple[bool, list[float]]:
    slept: list[float] = []

    async def sleep(s: float) -> None:
        slept.append(s)

    transport = httpx2.MockTransport(handler)  # pyright: ignore[reportArgumentType]
    ok = await rp.post_result(_target(), {"status": "ok"}, transport, sleep)
    return ok, slept


async def test_hub_fr_128_post_created_and_auth() -> None:
    seen: list[httpx2.Request] = []

    def handler(req: httpx2.Request) -> httpx2.Response:
        seen.append(req)
        return httpx2.Response(201, json={"id": "x"})

    ok, slept = await _post(handler)
    assert ok and slept == []
    assert seen[0].url.path == "/internal/jobs/job-1/autofix-result"
    assert seen[0].headers["Authorization"] == "Bearer tok"


async def test_hub_fr_128_post_exists_is_success_other_409_not() -> None:
    def exists(_: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(409, json={"error": {"code": "AUTOFIX_RESULT_EXISTS"}})

    def unexpected(_: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(409, json={"error": {"code": "AUTOFIX_NOT_EXPECTED"}})

    assert (await _post(exists))[0] is True
    assert await _post(unexpected) == (False, [])


async def test_hub_fr_128_post_retry_then_ok_and_give_up() -> None:
    calls = {"n": 0}

    def flaky(_: httpx2.Request) -> httpx2.Response:
        calls["n"] += 1
        return httpx2.Response(503 if calls["n"] < 3 else 201)

    assert await _post(flaky) == (True, [1.0, 2.0])

    def down(req: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down", request=req)

    assert await _post(down) == (False, [1.0, 2.0, 4.0])
