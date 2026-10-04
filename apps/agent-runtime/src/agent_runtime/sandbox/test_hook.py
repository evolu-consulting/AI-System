"""WRK-BR-07 · WRK-FR-12 · hook `PreToolUse` (plan-runtime §5.2, dự phòng §13) + nhãn §5.1."""

from pathlib import Path

import pytest

from agent_runtime.sandbox.hook import SandboxPolicy, decide, make_path_guard
from agent_runtime.sandbox.paths import is_path_allowed

JOB = "c3000000-0000-4000-8000-000000000001"


@pytest.fixture
def policy(tmp_path: Path) -> SandboxPolicy:
    # Bố cục prod: work nằm dưới home (`/home/worker/work`).
    home = tmp_path / "home"
    work_root = home / "work"
    job = work_root / JOB
    (home / ".claude").mkdir(parents=True)
    job.mkdir(parents=True)
    tools = frozenset({"Read", "Write", "Glob", "Grep", "LS", "Bash"})
    return SandboxPolicy(JOB, job, (home, Path("/mnt"), work_root), tools)


def test_wrk_br_07_labels_when_work_under_home(policy: SandboxPolicy) -> None:
    home, _, work_root = policy.forbidden_roots
    roots = policy.forbidden_roots
    assert is_path_allowed(str(work_root / "x"), policy.work_dir, roots).reason == "other_job"
    assert is_path_allowed(str(home / ".claude"), policy.work_dir, roots).reason == "home"
    assert is_path_allowed("~/.claude/x", policy.work_dir, roots).reason == "home"
    assert is_path_allowed("a.txt", Path("rel"), roots).allowed is False


@pytest.mark.parametrize(
    ("tool", "tool_input", "want"),
    [
        ("Read", {"file_path": "a.txt"}, None),
        ("Read", {"file_path": "/etc/passwd"}, "path_not_allowed"),
        ("Bash", {"command": "ls"}, "tool_not_allowed"),
        ("Agent", {}, "tool_not_allowed"),
        ("mcp__x__y", {}, "tool_not_allowed"),
        ("Edit", {"file_path": "a.txt"}, "tool_not_allowed"),
        ("Glob", {"pattern": "**/*.py"}, None),
        ("Glob", {"pattern": "../../**/*.json"}, "path_not_allowed"),
        ("Glob", {"pattern": "/etc/*"}, "path_not_allowed"),
        ("Glob", {"path": "/mnt/c"}, "path_not_allowed"),
        ("Grep", {"pattern": "/api/v1", "glob": "*.ts"}, None),
        ("Grep", {"pattern": "x", "glob": "/etc/**"}, "path_not_allowed"),
        ("LS", {"dirPath": "~"}, "path_not_allowed"),
        ("LS", {"paths": ["a", "/tmp"]}, "path_not_allowed"),
        ("LS", {"path": 3}, "path_not_allowed"),
    ],
)
def test_wrk_fr_12_decide(
    policy: SandboxPolicy, tool: str, tool_input: dict[str, object], want: str | None
) -> None:
    got = decide(policy, tool, tool_input)
    assert got.reason == want
    assert got.allowed is (want is None)


async def test_wrk_br_07_guard_output_hides_path(policy: SandboxPolicy) -> None:
    guard = make_path_guard(policy)
    secret = "/home/worker/.claude/.credentials.json"
    out = await guard({"tool_name": "Read", "tool_input": {"file_path": secret}}, None, None)
    assert out == {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "path_not_allowed",
        }
    }
    assert ".credentials" not in str(out)
    assert await guard({"tool_name": "Read", "tool_input": {"file_path": "a"}}, None, None) == {}


async def test_wrk_br_07_guard_fail_closed(policy: SandboxPolicy) -> None:
    guard = make_path_guard(policy)
    bad = await guard({"tool_name": "Read", "tool_input": "x"}, None, None)
    assert bad != {}
    missing = await guard({}, None, None)
    assert missing != {}


@pytest.mark.parametrize(
    ("tool", "tool_input"),
    [
        ("Glob", {"pattern": "{..}/{..}/.claude/*"}),
        ("Glob", {"pattern": f"../{JOB}x/**"}),
        ("Glob", {"pattern": "{..,x}/**"}),
        ("Glob", {"pattern": "x/{..,y}/**/*.json"}),
        ("Glob", {"pattern": "sub/.{.}/a"}),
        ("Glob", {"pattern": "a..b/*"}),  # `..` ở bất kỳ đâu → deny (fail-closed)
        ("Glob", {"pattern": "**/*.{ts,tsx}"}),  # brace vô hại vẫn deny (ưu tiên an toàn)
        ("Grep", {"pattern": "x", "glob": "{..}/{..}/**"}),
        ("Grep", {"pattern": "x", "glob": ["*.py", "{..,a}/*"]}),
        ("LS", {"ignore_globs": ["{..}/*"]}),
    ],
)
def test_wrk_br_07_brace_and_dotdot_patterns_denied(
    policy: SandboxPolicy, tool: str, tool_input: dict[str, object]
) -> None:
    """Review H1 #3 · AC-W11: mẫu brace / `..` lọt khỏi `work/<job>` → deny.
    Xác minh lại W0/PY-02."""
    got = decide(policy, tool, tool_input)
    assert (got.allowed, got.reason, got.label) == (False, "path_not_allowed", "pattern")


def test_wrk_br_07_grep_content_regex_not_a_path(policy: SandboxPolicy) -> None:
    """`pattern` của Grep là regex nội dung (không mở rộng thành đường dẫn) → không kiểm."""
    assert decide(policy, "Grep", {"pattern": r"\.\./x|{a,b}", "glob": "*.py"}).allowed
    assert decide(policy, "Glob", {"pattern": "src/**/*.py", "path": "."}).allowed
