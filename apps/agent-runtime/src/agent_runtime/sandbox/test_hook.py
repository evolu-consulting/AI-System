"""WRK-BR-07 · WRK-FR-12 · hook `PreToolUse` (plan-runtime §5.2, dự phòng §13) + nhãn §5.1."""

from dataclasses import replace
from pathlib import Path

import pytest

from agent_runtime.sandbox.hook import SandboxPolicy, decide, deny_output, make_path_guard
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
        # review H1 v2 N3: escape / lớp ký tự / wildcard khớp `..`
        ("Glob", {"pattern": r"\.\./\.\./.claude/*"}),
        ("Glob", {"pattern": "[.][.]/[.][.]/.claude/*"}),
        ("Glob", {"pattern": ".[.]/x/*"}),
        ("Glob", {"pattern": ".?/.?/.claude/*"}),
        ("Glob", {"pattern": ".*/x/*"}),
        ("Glob", {"pattern": "?./x/*"}),
        ("Glob", {"pattern": "sub/??/*.json"}),
        ("Grep", {"pattern": "x", "glob": "[.][.]/**"}),
    ],
)
def test_wrk_br_07_brace_and_dotdot_patterns_denied(
    policy: SandboxPolicy, tool: str, tool_input: dict[str, object]
) -> None:
    """Review H1 #3 · AC-W11: mẫu brace / `..` lọt khỏi `work/<job>` → deny (spike PY-02 #3: Glob
    có mở rộng brace + lớp ký tự)."""
    got = decide(policy, tool, tool_input)
    assert (got.allowed, got.reason, got.label) == (False, "path_not_allowed", "pattern")


def test_wrk_br_07_grep_content_regex_not_a_path(policy: SandboxPolicy) -> None:
    """`pattern` của Grep là regex nội dung (không mở rộng thành đường dẫn) → không kiểm."""
    assert decide(policy, "Grep", {"pattern": r"\.\./x|{a,b}", "glob": "*.py"}).allowed
    assert decide(policy, "Glob", {"pattern": "src/**/*.py", "path": "."}).allowed


def test_wrk_br_07_structured_output_only_for_agent(policy: SandboxPolicy) -> None:
    """S2 (spike PY-02 #5): CLI gọi hook cho `StructuredOutput` — agent (có `output_format`) cho
    phép, Orchestrator/không `output_format` deny; tool khác ngoài `tools` vẫn deny."""
    data = {"status": "done", "text": "/home/x ../y"}
    assert not decide(policy, "StructuredOutput", data).allowed
    agent = replace(policy, tools=frozenset(), structured_output=True)
    assert decide(agent, "StructuredOutput", data).allowed
    assert decide(agent, "Read", {"file_path": "a.txt"}).reason == "tool_not_allowed"


MCP_TOOL = "mcp__hub__check-invoice"


@pytest.mark.parametrize(
    ("tool", "tool_input", "want"),
    [
        (MCP_TOOL, {"path": "/etc/passwd", "glob": "{..}/**"}, None),  # không kiểm path
        (MCP_TOOL, {}, None),
        ("mcp__hub__create-trello-card", {}, "tool_not_allowed"),  # ∉ `payload.mcp.tools`
        ("mcp__other__check-invoice", {}, "tool_not_allowed"),
        ("mcp__other__x", {}, "tool_not_allowed"),
        ("ListMcpResourcesTool", {}, "tool_not_allowed"),
        ("ReadMcpResourceTool", {"uri": "x"}, "tool_not_allowed"),
        ("Read", {"file_path": "/etc/passwd"}, "path_not_allowed"),  # luật H1 giữ nguyên
    ],
)
def test_wrk_fr_13_decide_mcp_tools(
    policy: SandboxPolicy, tool: str, tool_input: dict[str, object], want: str | None
) -> None:
    """H2a §4.3 · R19: `mcp_tools` → allow không kiểm path; `mcp__*` khác / tool MCP phụ → deny."""
    mcp = replace(policy, mcp_tools=frozenset({MCP_TOOL}))
    got = decide(mcp, tool, tool_input)
    assert got.reason == want
    assert got.allowed is (want is None)


async def test_wrk_fr_13_guard_mcp_allow_is_empty(policy: SandboxPolicy) -> None:
    """Spike S5: allow = `{}` (không `permissionDecision:"allow"` vượt `allowed_tools`); không
    `mcp_tools` (H1) → `mcp__hub__*` deny."""
    allowed = make_path_guard(replace(policy, mcp_tools=frozenset({MCP_TOOL})))
    assert await allowed({"tool_name": MCP_TOOL, "tool_input": {"x": 1}}, None, None) == {}
    h1 = await make_path_guard(policy)({"tool_name": MCP_TOOL, "tool_input": {}}, None, None)
    assert h1 == deny_output("tool_not_allowed")


@pytest.mark.parametrize(
    ("target", "label"),
    [
        ("out/a.md", None),
        ("out/../out/b.md", None),
        ("attachments/x.md", "write_scope"),
        ("a.md", "write_scope"),
        ("out/sub/a.md", "write_scope"),
        ("out", "write_scope"),
        ("../x.md", "other_job"),
        ("/tmp/x.md", "outside"),
    ],
)
def test_wrk_br_07_write_only_directly_in_out(
    policy: SandboxPolicy, target: str, label: str | None
) -> None:
    """H2c PL9: `Write` chỉ khi `dirname(realpath(p)) == realpath(work/out)`."""
    (policy.work_dir / "out").mkdir()
    got = decide(policy, "Write", {"file_path": target, "content": "x"})
    assert got.allowed is (label is None)
    assert got.label == label
    if label is not None:
        assert got.reason == "path_not_allowed"


def test_wrk_br_07_write_symlink_and_missing_path(policy: SandboxPolicy, tmp_path: Path) -> None:
    """PL9: symlink trong `out/` trỏ ra ngoài / vào thư mục khác của job → deny; `Write` không
    đường dẫn → deny (fail-closed); không `Write` trong `tools` → `tool_not_allowed`."""
    out = policy.work_dir / "out"
    out.mkdir()
    (policy.work_dir / "attachments").mkdir()
    victim = tmp_path / "victim"
    victim.write_text("v")
    (out / "l.md").symlink_to(victim)
    (out / "in.md").symlink_to(policy.work_dir / "attachments" / "a.pdf")
    assert decide(policy, "Write", {"file_path": "out/l.md"}).allowed is False
    assert decide(policy, "Write", {"file_path": "out/in.md"}).label == "write_scope"
    assert decide(policy, "Write", {"content": "x"}).label == "write_scope"
    read_only = replace(policy, tools=frozenset({"Read", "Grep"}))
    assert decide(read_only, "Write", {"file_path": "out/a.md"}).reason == "tool_not_allowed"


def test_wrk_br_07_write_out_must_be_real_same_dir(policy: SandboxPolicy) -> None:
    """Review H2c v1 #6: `out/` symlink (kể cả trong job) / vắng / khác `out_id` ⇒ `write_scope`."""
    elsewhere = policy.work_dir / "alt"
    elsewhere.mkdir()
    out = policy.work_dir / "out"
    assert decide(policy, "Write", {"file_path": "out/a.md"}).label == "write_scope"  # vắng
    out.symlink_to(elsewhere, target_is_directory=True)
    assert decide(policy, "Write", {"file_path": "out/a.md"}).label == "write_scope"
    out.unlink()
    out.mkdir()
    st = out.lstat()
    same = replace(policy, out_id=(st.st_dev, st.st_ino))
    assert decide(same, "Write", {"file_path": "out/a.md"}).allowed is True
    other = replace(policy, out_id=(st.st_dev, st.st_ino + 1))
    assert decide(other, "Write", {"file_path": "out/a.md"}).label == "write_scope"
