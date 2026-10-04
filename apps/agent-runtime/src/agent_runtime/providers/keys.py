"""WRK-FR-10 · spec §7 · Khoá provider có implementation + môi trường được phép — nhẹ, không import
SDK (process cha lọc `AGENT_RT_PROVIDERS` mà không nạp `claude_agent_sdk` ~5 s; review H1 #8).
"""

CLAUDE_KEY = "claude-sub"
FAKE_KEY = "fake-cli"
DEV_APP_ENVS = frozenset({"development", "test"})


def is_available(key: str, app_env: str | None) -> bool:
    """`key` có implementation và được phép ở `app_env` (không dựng provider)."""
    return key == CLAUDE_KEY or (key == FAKE_KEY and app_env in DEV_APP_ENVS)
