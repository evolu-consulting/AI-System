"""WRK-FR-29 · HUB-BR-33 · P-c1 · test đơn vị `autofix/rules.py` (ngoài ca khoá P01–P16)."""

from __future__ import annotations

from agent_runtime.autofix import rules as r


def _spec(**kw: object) -> r.SandboxSpec:
    base: dict[str, object] = {"job_id": "j1", "image": "img:1", "host_workspace": "/w/j1/ws/a"}
    base.update(kw)
    return r.SandboxSpec(**base)  # pyright: ignore[reportArgumentType]


def test_wrk_fr_28_container_name_and_argv_tail() -> None:
    argv = r.container_args(_spec(), phase="prep")
    assert argv[:4] == ["run", "-d", "--name", "aif-j1-prep"]
    assert argv[-3:] == ["img:1", "sleep", "infinity"]
    assert "--userns" not in argv


def test_wrk_fr_28_podman_keep_id() -> None:
    argv = r.container_args(_spec(engine="podman", cpus=1.5), phase="agent")
    i = argv.index("--userns")
    assert argv[i + 1] == "keep-id"
    assert argv[argv.index("--cpus") + 1] == "1.5"


def test_wrk_fr_29_ci_root_only_and_glob_explicit() -> None:
    wf = ".github/workflows/a.yml"
    assert [f.rule for f in r.check_paths([wf], [".github/**"])] == ["ci_file"]
    assert r.check_paths([wf], [".github/workflows/*.yml"]) == []
    assert [f.rule for f in r.check_paths([".github/workflows/a.yml"], ["src/**"])] == ["ci_file"]
    assert r.check_paths([".github/CODEOWNERS"], []) == []


def test_wrk_fr_29_size_multiple_failures() -> None:
    st = r.DiffStats(files=301, insertions=0, deletions=0, bytes=3_000_000)
    got = r.check_size(st, 0, r.Limits())
    assert [f.rule for f in got] == ["diff_files", "diff_bytes"]


def test_wrk_fr_29_scan_multi_file_line_numbers() -> None:
    diff = (
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10,3 +10,3 @@\n x\n-old\n+new\n y\n"
        "diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n"
        "@@ -0,0 +1,2 @@\n+ok\n+k = AKIAQCQCQCQCQCQCQCQC\n"
    )
    got = r.scan_secrets(diff)
    assert [(f.path, f.line, f.rule) for f in got] == [("b.ts", 2, "aws_access_key")]


def test_wrk_fr_29_scan_deleted_secret_file_ok() -> None:
    diff = "diff --git a/.env b/.env\ndeleted file mode 100644\n--- a/.env\n+++ /dev/null\n"
    diff += "@@ -1 +0,0 @@\n-A=1\n"
    assert r.scan_secrets(diff) == []


def test_hub_fr_130_redact_pem_block_and_clip() -> None:
    pem = "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----"
    assert r.redact(f"x {pem} y") == "x [REDACTED] y"
    long = "AKIAQCQCQCQCQCQCQCQC " + "z" * 900
    out = r.clip_detail(long)
    assert len(out) <= 500
    assert "AKIA" not in out


def test_hub_br_33_git_env_no_inherit_and_author() -> None:
    from pathlib import Path

    env = r.git_env(Path("/g"), Path("/w"))
    assert env["GIT_AUTHOR_NAME"] == "ai-autofix"
    assert env["GIT_COMMITTER_EMAIL"] == "noreply@local"
    assert "HOME" not in env
    assert "protocol.allow=never" in r.GIT_SAFE_ARGS


def test_hub_br_32_ws_rel_backslash() -> None:
    assert r.ws_rel_ok("a\\..\\..\\x") is False
    assert r.ws_rel_ok("\\x") is False
    assert r.ws_rel_ok("x" * 1025) is False
