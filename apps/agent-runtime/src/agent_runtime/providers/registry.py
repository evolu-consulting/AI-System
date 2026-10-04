"""WRK-FR-10 · spec §7 · Registry provider trong job host: `fake-cli` chỉ khi `APP_ENV` ∈
{development, test}; `claude-sub` (PY-08) mọi môi trường. PY-09 hoàn thiện `fake-cli`.
Luật khoá/môi trường ở `keys.py` (process cha dùng, không nạp SDK).
"""

from __future__ import annotations

from agent_runtime.providers.base import Provider
from agent_runtime.providers.claude.provider import KEY as _CLAUDE
from agent_runtime.providers.claude.provider import ClaudeProvider
from agent_runtime.providers.fake.provider import KEY as _FAKE
from agent_runtime.providers.fake.provider import FakeProvider
from agent_runtime.providers.keys import CLAUDE_KEY, DEV_APP_ENVS, FAKE_KEY, is_available

assert (_CLAUDE, _FAKE) == (CLAUDE_KEY, FAKE_KEY)  # khoá hai nơi phải khớp
__all__ = ["DEV_APP_ENVS", "get_provider", "is_available"]


def get_provider(key: str, app_env: str | None) -> Provider | None:
    """Provider theo `provider_key`; không có / không được phép ở `app_env` → None."""
    if not is_available(key, app_env):
        return None
    return ClaudeProvider() if key == CLAUDE_KEY else FakeProvider()
