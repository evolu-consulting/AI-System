"""H2a-RT1 · P4 · token claim (`plan-runtime` §3.3 bước 0, §7 unit): 43 ký tự base64url, hash 32
byte = vector `hashJobToken` TS (`apps/hub-api/src/lib/job-token.test.ts`)."""

import re

import pytest

from agent_runtime.db.jobs_sql import ClaimedJob, new_token, token_hash

VECTORS = [
    (
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a",
    ),
    (
        "test_job-token-vector_0123456789_abcdefghij",
        "612aac117a8936eada56e1dfb1a962d6c062699c16440affb607229af893ff22",
    ),
]


@pytest.mark.parametrize(("token", "hexdigest"), VECTORS)
def test_hub_fr_50_token_hash_vector(token: str, hexdigest: str) -> None:
    assert token_hash(token).hex() == hexdigest


def test_hub_fr_50_new_token_shape_and_hash() -> None:
    tokens = set[str]()
    for _ in range(50):
        token, digest = new_token()
        assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
        assert digest == token_hash(token) and len(digest) == 32
        tokens.add(token)
    assert len(tokens) == 50


def test_hub_fr_50_claimed_job_repr_hides_token() -> None:
    job = ClaimedJob(id="j", payload={}, token="SECRET_TOKEN_VALUE")
    assert "SECRET_TOKEN_VALUE" not in repr(job)
