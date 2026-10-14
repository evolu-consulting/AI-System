"""HUB-BR-34 · HUB-BR-30 · HUB-BR-14 · WRK-FR-29 · ADR-0011 #4 · P-c2 · luật thuần Runtime (plan §4
Runtime `apply/rules.py`) · test-plan P-c2 §4 P01–P07.

Refspec chỉ trong không gian `ai/<run>/<stage>` (PC2-R06); mirror riêng theo nguồn khi có khoá
(PC2-R12); khoá chỉ qua env `GIT_CONFIG_*` (PC2-R11) và bị che trong log (`redact_auth`); phân loại
lỗi push; danh sách file xung đột; cần chạy lại test khi rebase (PC2-R05). Không DB/HTTP/git.
Module nạp trong thân ca (`importlib`) ⇒ vắng ⇒ mỗi ca đỏ riêng ở `ModuleNotFoundError`.
"""

from __future__ import annotations

import base64
import hashlib
import importlib
from types import ModuleType

import pytest

RUN = "c2c20000-0000-4000-8000-000000000001"
SRC = "c2c20000-0000-4000-8000-000000000002"
URL = "https://github.com/pc2-test/app-repo.git"
TOKEN = "qc-pc2-tok-rt-Zx9Pq7Lm"
SHA_A = "a" * 40
SHA_B = "b" * 40


def rules() -> ModuleType:
    return importlib.import_module("agent_runtime.apply.rules")


# ---------- P01 · refspec ----------


@pytest.mark.parametrize("key", ["fix", "a", "fix-2", "x" * 32])
def test_hub_br_34_p01_push_refspec_ai_namespace(key: str) -> None:
    """HUB-BR-34 · PC2-R06 · P01 · `+HEAD:refs/heads/ai/<run>/<stage>` (cưỡng bức chỉ trong ai/)."""
    assert rules().push_refspec(f"ai/{RUN}/{key}") == f"+HEAD:refs/heads/ai/{RUN}/{key}"


@pytest.mark.parametrize(
    "branch",
    [
        "main",
        "refs/heads/main",
        "ai/xyz/fix",
        f"ai/{RUN}/Fix",
        f"ai/{RUN}/a/b",
        f"ai/{RUN}/../main",
        f"ai/{RUN}/fix:main",
        f"ai/{RUN}/fix main",
        f"ai/{RUN}/{'x' * 33}",
        "--all",
        "--mirror",
        "",
        f" ai/{RUN}/fix",
    ],
)
def test_hub_br_34_p01b_push_refspec_rejects(branch: str) -> None:
    """HUB-BR-34 · PC2-R06 · P01b · ngoài `^ai/<uuid>/[a-z0-9-]{1,32}$` ⇒ ValueError."""
    with pytest.raises(ValueError):
        rules().push_refspec(branch)


# ---------- P02 · mirror ----------


def test_hub_br_14_p02_mirror_key_per_source_when_credential() -> None:
    """HUB-BR-14 · PC2-R12 · P02 · có khoá ⇒ `src-<source_id>` (không chung theo URL); không khoá
    ⇒ sha256(url) như P-b."""
    m = rules()
    other = "c2c20000-0000-4000-8000-000000000003"
    assert m.mirror_key(URL, SRC, True) == f"src-{SRC}"
    assert m.mirror_key(URL, other, True) != m.mirror_key(URL, SRC, True)
    assert m.mirror_key(URL, SRC, False) == hashlib.sha256(URL.encode()).hexdigest()
    assert m.mirror_key(URL, other, False) == m.mirror_key(URL, SRC, False)


# ---------- P03 · auth_env ----------


def test_hub_br_30_p03_auth_env_appends_extra_header() -> None:
    """HUB-BR-30 · PC2-R11 · P03 · nối thêm cặp `http.<origin>/.extraHeader` = `Authorization:
    Basic b64(user:token)` vào `GIT_CONFIG_COUNT` sẵn có (giữ cặp C6); không sửa `base`; token chỉ ở
    giá trị extraHeader (dạng base64), không ở khoá nào."""
    base = {
        "PATH": "/usr/bin",
        "GIT_CONFIG_COUNT": "2",
        "GIT_CONFIG_KEY_0": "url.file:///fx/.insteadOf",
        "GIT_CONFIG_VALUE_0": "https://github.com/pc2-test/",
        "GIT_CONFIG_KEY_1": "protocol.file.allow",
        "GIT_CONFIG_VALUE_1": "always",
    }
    snap = dict(base)
    env = rules().auth_env(base, "https://github.com", "x-access-token", TOKEN)
    assert base == snap
    b64 = base64.b64encode(f"x-access-token:{TOKEN}".encode()).decode()
    assert env["GIT_CONFIG_COUNT"] == "3"
    assert env["GIT_CONFIG_KEY_2"] == "http.https://github.com/.extraHeader"
    assert env["GIT_CONFIG_VALUE_2"] == f"Authorization: Basic {b64}"
    for k in ("PATH", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1"):
        assert env[k] == base[k]
    assert not any(TOKEN in k or TOKEN in v for k, v in env.items())


def test_hub_br_30_p03b_auth_env_without_count() -> None:
    """HUB-BR-30 · P03b · không có `GIT_CONFIG_COUNT` ⇒ COUNT=1, cặp 0 là extraHeader."""
    env = rules().auth_env({}, "https://github.com", "oauth2", TOKEN)
    assert env["GIT_CONFIG_COUNT"] == "1"
    assert env["GIT_CONFIG_KEY_0"] == "http.https://github.com/.extraHeader"
    assert env["GIT_CONFIG_VALUE_0"].startswith("Authorization: Basic ")


# ---------- P04 · redact ----------


@pytest.mark.parametrize(
    "text",
    [
        "fatal: header Authorization: Basic eC1hY2Nlc3MtdG9rZW46cWM=",
        "> Authorization: Bearer qc-pc2-tok-rt-Zx9Pq7Lm",
        "fatal: 'https://x-access-token:qc-pc2-tok-rt-Zx9Pq7Lm@github.com/a/b.git/'",
        "trace: Basic eC1hY2Nlc3MtdG9rZW46cWM=",
    ],
)
def test_hub_br_30_p04_redact_auth(text: str) -> None:
    """HUB-BR-30 · PC2-R11 · P04 · che `Authorization: …`, `Basic …`, `x-access-token:…@`."""
    out = rules().redact_auth(text)
    for secret in (TOKEN, "eC1hY2Nlc3MtdG9rZW46cWM="):
        assert secret not in out


# ---------- P05 · phân loại lỗi push ----------


@pytest.mark.parametrize(
    ("stderr", "want"),
    [
        ("remote: Permission to pc2-test/app-repo.git denied.\nfatal: ... 403", "auth"),
        ("fatal: Authentication failed for 'https://github.com/pc2-test/app-repo.git/'", "auth"),
        ("fatal: could not read Username for 'https://github.com': prompts disabled", "auth"),
        ("error: The requested URL returned error: 401", "auth"),
        (" ! [remote rejected] HEAD -> ai/x/fix (pre-receive hook declined)", "push_rejected"),
        (" ! [rejected] HEAD -> ai/x/fix (protected branch hook declined)", "push_rejected"),
        ("error: failed to push some refs\n ! [rejected]", "push_rejected"),
        ("fatal: unable to access: Could not resolve host: github.com", "network"),
        ("fatal: the remote end hung up unexpectedly", "network"),
    ],
)
def test_wrk_fr_29_p05_classify_push_error(stderr: str, want: str) -> None:
    """WRK-FR-29 · PC2-R08 · P05 · 401/403/Authentication/Username ⇒ auth; rejected/protected/
    pre-receive ⇒ push_rejected; còn lại ⇒ network."""
    assert rules().classify_push_error(128, stderr) == want


# ---------- P06 · file xung đột ----------


def test_wrk_fr_29_p06_conflict_files() -> None:
    """WRK-FR-29 · E4 · P06 · từ stderr `git apply --3way` + `status --porcelain`: có file xung đột,
    đường dẫn tương đối, không trùng, ≤ 50."""
    stderr = (
        "error: patch failed: src/sum.js:1\n"
        "Falling back to three-way merge...\n"
        "Applied patch to 'src/sum.js' with conflicts.\n"
        "U src/sum.js\n"
    )
    porcelain = "UU src/sum.js\nM  src/other.js\n"
    got: list[str] = rules().conflict_files(stderr, porcelain)
    assert "src/sum.js" in got
    assert len(got) == len(set(got))
    assert all(not p.startswith("/") for p in got)
    many = "".join(f"UU src/f{i}.js\n" for i in range(60))
    assert len(rules().conflict_files("", many)) <= 50


# ---------- P07 · retest ----------


def test_wrk_fr_29_p07_needs_retest() -> None:
    """WRK-FR-29 · PC2-R05 · P07 · target ≠ pin ⇒ True; bằng ⇒ False."""
    m = rules()
    assert m.needs_retest(SHA_A, SHA_B) is True
    assert m.needs_retest(SHA_A, SHA_A) is False
