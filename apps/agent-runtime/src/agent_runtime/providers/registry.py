"""WRK-FR-10 · spec §7 · Registry provider trong job host: `fake-cli` chỉ khi `APP_ENV` ∈
{development, test}. Chỗ cắm: PY-08 thêm `claude-sub`, PY-09 hoàn thiện `fake-cli`.
"""

from __future__ import annotations

from agent_runtime.providers.base import Provider
from agent_runtime.providers.fake.provider import KEY as FAKE_KEY
from agent_runtime.providers.fake.provider import FakeProvider

DEV_APP_ENVS = frozenset({"development", "test"})


def get_provider(key: str, app_env: str | None) -> Provider | None:
    """Provider theo `provider_key`; không có / không được phép ở `app_env` → None."""
    # TODO(WRK-FR-10): PY-08 — `claude-sub`.
    if key == FAKE_KEY and app_env in DEV_APP_ENVS:
        return FakeProvider()
    return None
