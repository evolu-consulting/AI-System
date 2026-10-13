"""HUB-BR-32 · HUB-BR-33 · WRK-FR-28 · WRK-FR-29 · WRK-BR-08 · P-c1 · luật thuần
Runtime (plan §4 Runtime
`autofix/rules.py`, §5.2–§5.4; ADR-0011 #1–#4) · test-plan P-c §3 P01–P16.

Cô lập: argv container (`--network none`, cap-drop, read-only, non-root, trần, chỉ mount
`/workspace`, env tối thiểu không kế thừa host); kiểm diff PC-R08 (đường dẫn → kích thước → bí mật);
che log; git cứng; đường dẫn `ws_*` tương đối. Không DB/HTTP/container.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.acceptance.pc._pc import HOST_WS, JOB, checks, fget, flag_value, rules, spec

AWS = "AKIAQCQCQCQCQCQCQCQC"
SECRETS = {
    "aws": AWS,
    "pem": "-----BEGIN RSA PRIVATE KEY-----",
    "ghp": "ghp_" + "a1B2" * 9,
    "gh_pat": "github_pat_" + "a1_B" * 16,
    "glpat": "glpat-" + "a1B2c" * 4,
    "slack": "xoxb-" + "1234567890ab",
    "openai": "sk-" + "a1B2" * 8,
    "anthropic": "sk-ant-" + "a1B2_" * 4,
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYy10ZXN0In0.c2lnbmF0dXJlLXFjLXRlc3Q",
    "assign": 'password = "qcQcQcQcQcQc12"',
}


def _diff(path: str, added: str, *, removed: str = "", context: str = "const a = 1;") -> str:
    minus = f"-{removed}\n" if removed else ""
    return (
        f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n"
        f"@@ -1,2 +1,3 @@\n {context}\n{minus}+{added}\n const b = 2;\n"
    )


# ---------- P01–P05 · argv container (ADR-0011 #3, plan §5.2) ----------


def test_hub_br_33_p01_agent_argv_isolated() -> None:
    """HUB-BR-33 · WRK-BR-08 · P01 · agent: --network none, --cap-drop ALL, no-new-privileges,
    --read-only, --user 1000:1000, trần cpu/mem(=swap)/pids, tmpfs /tmp, nhãn
    ai.autofix + ai.job."""
    argv: list[str] = rules().container_args(spec(), phase="agent")
    assert flag_value(argv, "--network") == ["none"]
    assert flag_value(argv, "--cap-drop") == ["ALL"]
    assert "no-new-privileges" in flag_value(argv, "--security-opt")
    assert "--read-only" in argv
    assert flag_value(argv, "--user") == ["1000:1000"]
    assert flag_value(argv, "--cpus") == ["2"] or flag_value(argv, "--cpus") == ["2.0"]
    assert flag_value(argv, "--memory") == ["2048m"]
    assert flag_value(argv, "--memory-swap") == ["2048m"]
    assert flag_value(argv, "--pids-limit") == ["512"]
    assert any(v.startswith("/tmp:") for v in flag_value(argv, "--tmpfs"))
    labels = flag_value(argv, "--label")
    assert "ai.autofix=1" in labels
    assert f"ai.job={JOB}" in labels


def test_hub_br_32_p02_only_workspace_mounted() -> None:
    """HUB-BR-32 · ADR-0011 #4 · P02 · chỉ MỘT mount `<host_ws>:/workspace:rw`; không `--mount`,
    không socket docker, không mount `sources/`/`git/`; -w /workspace; không
    --privileged/host ns."""
    argv: list[str] = rules().container_args(spec(), phase="agent")
    assert flag_value(argv, "-v") + flag_value(argv, "--volume") == [f"{HOST_WS}:/workspace:rw"]
    assert flag_value(argv, "--mount") == []
    assert flag_value(argv, "-w") == ["/workspace"]
    joined = " ".join(argv)
    for bad in ("--privileged", "docker.sock", "/sources", "/git:", "--pid=host", "--ipc=host"):
        assert bad not in joined
    assert "host" not in flag_value(argv, "--network") + flag_value(argv, "--pid")


def test_hub_br_33_p03_env_minimal_no_host_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """HUB-BR-33 · spec §6 "Lộ secret" · P03 · env container chỉ HOME=/tmp, CI=1, LANG=C.UTF-8 —
    không kế thừa biến host (token/secret)."""
    monkeypatch.setenv("GITHUB_TOKEN", "qc-ghtoken-Zx9Pq7Lm")
    monkeypatch.setenv("AGENT_RT_HUB_TOKEN", "qc-hubtoken-Zx9Pq7Lm")
    for phase in ("prep", "agent", "test"):
        argv: list[str] = rules().container_args(spec(), phase=phase)
        envs = flag_value(argv, "-e") + flag_value(argv, "--env")
        assert sorted(envs) == ["CI=1", "HOME=/tmp", "LANG=C.UTF-8"], phase
        assert "Zx9Pq7Lm" not in " ".join(argv)
        assert "--env-file" not in argv


def test_hub_br_33_p04_test_phase_no_network_new_name() -> None:
    """HUB-BR-33 · PC-R08(4) · P04 · test: container MỚI (tên `aif-<job>-test`),
    vẫn --network none."""
    agent: list[str] = rules().container_args(spec(), phase="agent")
    test: list[str] = rules().container_args(spec(), phase="test")
    assert flag_value(agent, "--name") == [f"aif-{JOB}"]
    assert flag_value(test, "--name") == [f"aif-{JOB}-test"]
    assert flag_value(test, "--network") == ["none"]


def test_q2_p05_prep_phase_has_network_but_same_hardening() -> None:
    """Q2 · PC-R15 · ADR-0011 #2 · P05 · prep (install_cmd) có mạng (không
    `--network none`) nhưng giữ
    cap-drop, read-only, non-root, trần."""
    argv: list[str] = rules().container_args(spec(), phase="prep")
    assert flag_value(argv, "--network") != ["none"]
    assert flag_value(argv, "--cap-drop") == ["ALL"]
    assert "--read-only" in argv
    assert flag_value(argv, "--user") == ["1000:1000"]
    assert flag_value(argv, "--pids-limit") == ["512"]


# ---------- P06–P09 · kiểm đường dẫn + kích thước (PC-R08 1–2) ----------


@pytest.mark.parametrize(
    "path",
    [
        ".git/config",
        "sub/.git/HEAD",
        ".env",
        "config/.env.local",
        "keys/id_rsa.pub",
        "certs/server.PEM",
        "deploy/.ssh/known_hosts",
        ".npmrc",
        "app/credentials.json",
        "SECRETS.yaml",
    ],
)
def test_wrk_fr_29_p06_forbidden_basename_beats_allowlist(path: str) -> None:
    """WRK-FR-29 · PC-R08(1) · PB-R07 · P06 · tên cấm (mọi độ sâu, không phân biệt hoa-thường) ⇒ lỗi
    `paths` kể cả allowlist `**`."""
    for allow in ([], ["**"]):
        got = rules().check_paths([path], allow)
        assert checks(got) == ["paths"], (path, allow)
        assert fget(got[0], "path") == path


def test_wrk_fr_29_p07_ci_files_need_explicit_allowlist() -> None:
    """WRK-FR-29 · PC-R08(1) · P07 · `.github/workflows/**`, `.gitlab-ci.yml` cấm
    trừ khi allowlist ghi
    rõ; `**` không đủ; `.gitignore` (≠ `.git`) được."""
    cp = rules().check_paths
    wf = ".github/workflows/ci.yml"
    assert checks(cp([wf], [])) == ["paths"]
    assert checks(cp([wf], ["**"])) == ["paths"]
    assert cp([wf], [".github/workflows/**"]) == []
    assert checks(cp([".gitlab-ci.yml"], [])) == ["paths"]
    assert cp([".gitlab-ci.yml"], [".gitlab-ci.yml"]) == []
    assert cp([".gitignore", "src/a.ts"], []) == []


def test_wrk_fr_29_p08_write_allowlist() -> None:
    """WRK-FR-29 · PC-R08(1) · P08 · allowlist rỗng = mọi đường dẫn; `src/**` ⇒
    `docs/a.md` lỗi, mỗi file
    một lỗi `paths`."""
    cp = rules().check_paths
    assert cp(["docs/a.md", "src/a.ts"], []) == []
    got = cp(["src/a.ts", "docs/a.md", "README.md"], ["src/**"])
    assert checks(got) == ["paths", "paths"]
    assert sorted(str(fget(f, "path")) for f in got) == ["README.md", "docs/a.md"]


def test_wrk_fr_29_p09_size_limits() -> None:
    """WRK-FR-29 · PC-R08(2) · P09 · diff ≤ 2 MiB, ≤ 300 file, workspace ≤ 4 GiB
    (biên đúng = đạt)."""
    r = rules()
    lim = r.Limits()
    gib4 = 4 * 1024**3

    def st(files: int, size: int) -> object:
        return r.DiffStats(files=files, insertions=1, deletions=0, bytes=size)

    assert r.check_size(st(300, 2_097_152), gib4, lim) == []
    assert checks(r.check_size(st(301, 10), 10, lim)) == ["size"]
    assert checks(r.check_size(st(1, 2_097_153), 10, lim)) == ["size"]
    assert checks(r.check_size(st(1, 10), gib4 + 1, lim)) == ["size"]


# ---------- P10–P12 · bí mật + che log (PC-R08 3, PC-R12) ----------


@pytest.mark.parametrize(("name", "value"), list(SECRETS.items()))
def test_wrk_fr_29_p10_secret_on_added_line(name: str, value: str) -> None:
    """WRK-FR-29 · PC-R08(3) · P10 · dòng THÊM khớp mẫu plan §5.4 ⇒ `secrets` với
    path + số dòng (file
    mới) + rule ≤ 64; detail/rule KHÔNG chứa giá trị."""
    got = rules().scan_secrets(_diff("src/cfg.ts", f"const k = {value!r};"))
    assert checks(got) == ["secrets"], name
    assert (fget(got[0], "path"), fget(got[0], "line")) == ("src/cfg.ts", 2)
    rule = str(fget(got[0], "rule") or "")
    assert 0 < len(rule) <= 64
    assert value not in f"{fget(got[0], 'detail')}{rule}"


def test_wrk_fr_29_p11_secret_only_added_lines() -> None:
    """WRK-FR-29 · PC-R08(3) · P11 · dòng XOÁ / ngữ cảnh chứa bí mật ⇒ không lỗi;
    gán ngắn (< 12) ⇒ không;
    thêm file tên cấm (`.env`) ⇒ lỗi."""
    ss = rules().scan_secrets
    assert ss(_diff("src/a.ts", "const x = 1;", removed=f"const k = '{AWS}';")) == []
    assert ss(_diff("src/a.ts", "const x = 1;", context=f"// {AWS}")) == []
    assert ss(_diff("src/a.ts", 'password = "short"')) == []
    env = (
        "diff --git a/.env b/.env\nnew file mode 100644\n"
        "--- /dev/null\n+++ b/.env\n@@ -0,0 +1 @@\n+A=1\n"
    )
    assert checks(ss(env)) == ["secrets"]


def test_hub_fr_130_p12_redact() -> None:
    """HUB-FR-130 · PC-R12 · P12 · redact thay khớp mẫu bằng `[REDACTED]`; chữ thường giữ nguyên."""
    rd = rules().redact
    for v in SECRETS.values():
        out = rd(f"log: {v} end")
        assert "[REDACTED]" in out
        assert v not in out
    assert rd("12 pass, 0 fail") == "12 pass, 0 fail"


# ---------- P13–P16 · git cứng, đường dẫn ws, cắt lệnh ----------


def test_hub_br_33_p13_git_env_hardened(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """HUB-BR-33 · ADR-0011 #4 · P13 · git_env: GIT_DIR/GIT_WORK_TREE ngoài mount, không config hệ
    thống/global, không prompt; không kế thừa biến host."""
    monkeypatch.setenv("GITHUB_TOKEN", "qc-ghtoken-Zx9Pq7Lm")
    gd, wt = tmp_path / "git", tmp_path / "workspace" / "app-repo"
    env: dict[str, str] = rules().git_env(gd, wt)
    want = {
        "GIT_DIR": str(gd),
        "GIT_WORK_TREE": str(wt),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PAGER": "cat",
    }
    assert {k: env.get(k) for k in want} == want
    assert "GITHUB_TOKEN" not in env
    assert "Zx9Pq7Lm" not in " ".join(env.values())


def test_hub_br_33_p14_git_safe_args() -> None:
    """HUB-BR-33 · ADR-0011 #4 · P14 · GIT_SAFE_ARGS tắt hooks, fsmonitor, diff
    ngoài, attributes."""
    args: list[str] = list(rules().GIT_SAFE_ARGS)
    pairs = {args[i + 1] for i, a in enumerate(args[:-1]) if a == "-c"}
    for need in (
        "core.hooksPath=/dev/null",
        "core.fsmonitor=false",
        "diff.external=",
        "core.attributesFile=/dev/null",
    ):
        assert need in pairs


@pytest.mark.parametrize(
    ("rel", "ok"),
    [
        ("src/a.py", True),
        ("a b/c.txt", True),
        ("deep/x/y/z.ts", True),
        ("/etc/passwd", False),
        ("../x", False),
        ("a/../../x", False),
        ("a/..", False),
        ("", False),
        ("a\x00b", False),
    ],
)
def test_hub_br_32_p15_ws_rel_ok(rel: str, ok: bool) -> None:
    """HUB-BR-32 · WRK-FR-28 · P15 · đường dẫn ws_*: tương đối, không `..`, không
    tuyệt đối, không NUL."""
    assert rules().ws_rel_ok(rel) is ok


def test_hub_fr_130_p16_truncate_cmd() -> None:
    """HUB-FR-130 · PC-R12 · P16 · truncate_cmd ≤ 500; lệnh ngắn giữ nguyên."""
    tc = rules().truncate_cmd
    assert tc("bun test") == "bun test"
    assert len(tc("x" * 600)) <= 500
