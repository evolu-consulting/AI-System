"""WRK-FR-10 · spec §7 · Registry provider trong job host: `fake-cli` chỉ khi `APP_ENV` ∈
{development, test}; `claude-sub` (PY-08) mọi môi trường. PY-09 hoàn thiện `fake-cli`.
"""

from __future__ import annotations

from agent_runtime.providers.base import Provider
from agent_runtime.providers.claude.provider import KEY as CLAUDE_KEY
from agent_runtime.providers.claude.provider import ClaudeProvider
from agent_runtime.providers.fake.provider import KEY as FAKE_KEY
from agent_runtime.providers.fake.provider import FakeProvider

DEV_APP_ENVS = frozenset({"development", "test"})


def get_provider(key: str, app_env: str | None) -> Provider | None:
    """Provider theo `provider_key`; không có / không được phép ở `app_env` → None."""
    if key == CLAUDE_KEY:
        return ClaudeProvider()
    if key == FAKE_KEY and app_env in DEV_APP_ENVS:
        return FakeProvider()
    return None
